import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ClipboardCheck,
  Download,
  FileSpreadsheet,
  Plus,
  RefreshCw,
  Upload,
} from 'lucide-react';
import {
  getListPaymentSchedulesQueryKey,
  getListProcurementRecordsQueryKey,
  useAdvanceProcurementStatus,
  useCreatePaymentSchedule,
  useCreateProcurementRecord,
  useDualSignoff,
  useListPaymentSchedules,
  useListProcurementRecords,
  useMarkPaid,
  useResolveVariance,
  useSubmitInvoice,
  useSubmitProcurementReview,
  type PaymentSchedule,
  type ProcurementRecord,
} from '@workspace/api-client-react';
import { toast } from 'sonner';
import { useVendorSubmissions, type VendorSubmission } from '@/hooks/use-integrations';
import { exportBudget, useImportBudget } from '@/hooks/use-budget';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

// ---------------------------------------------------------------------------
// Identity + reference data (live Supabase profiles / vendors / budget lines)
// ---------------------------------------------------------------------------
const ACTOR = {
  HEAD: '7937447c-090e-4248-885b-0798763e5994', // Leah Chan · SUPER_ADMIN
  DEPUTY: '11b50e41-88e6-4297-bdba-6c76caf641ec', // Marcus Wong · DEPUTY_HEAD_OF_IT
  TEAM_LEAD: '57198c98-3a7b-4e16-b072-5c4c9dd31ffe', // Priya Nair · TEAM_LEAD
  FINANCE: '0ebb310c-b241-48b0-9254-7b78f7634676', // Siti Halim · FINANCE_AUDITOR
};

const VENDOR_OPTIONS = [
  { id: '20000000-0000-0000-0000-000000000001', name: 'Cerebrum Cloud Pte Ltd', region: 'MY', currency: 'MYR' },
  { id: '20000000-0000-0000-0000-000000000002', name: 'NexaNet HK Limited', region: 'HK', currency: 'HKD' },
  { id: '20000000-0000-0000-0000-000000000003', name: 'Greenline Data Services', region: 'CN', currency: 'CNY' },
  { id: '20000000-0000-0000-0000-000000000004', name: 'Meridian Hardware Distrib', region: 'ID', currency: 'IDR' },
  { id: '20000000-0000-0000-0000-000000000005', name: 'Skybridge Security Pte Ltd', region: 'MY', currency: 'MYR' },
  { id: '20000000-0000-0000-0000-000000000006', name: 'PacificWorks Telecom', region: 'HK', currency: 'HKD' },
];
const VENDOR_BY_ID = Object.fromEntries(VENDOR_OPTIONS.map(v => [v.id, v]));

const BUDGET_OPTIONS = [
  { id: '40000000-0000-0000-0000-000000000001', label: 'HARDWARE · Server/Storage/Network refresh' },
  { id: '40000000-0000-0000-0000-000000000002', label: 'SOFTWARE · SaaS licences / subscriptions' },
  { id: '40000000-0000-0000-0000-000000000003', label: 'DATA · Data platform / analytics' },
  { id: '40000000-0000-0000-0000-000000000004', label: 'SERVICES · Professional services / support' },
];

const REGIONS = ['HK', 'CN', 'MY', 'ID'];
const CURRENCIES = ['HKD', 'CNY', 'MYR', 'IDR', 'SGD', 'USD'];

// Ordered PR/PO lifecycle used for the "advance to next" action.
const NEXT_STATUS: Record<string, string> = {
  PR_DRAFT: 'PR_APPROVED',
  PR_APPROVED: 'PO_ISSUED',
  PO_ISSUED: 'MILESTONE_RECEIVED',
  MILESTONE_RECEIVED: 'INVOICE_PENDING',
  INVOICE_PENDING: 'PAYMENT_APPROVED',
  PAYMENT_APPROVED: 'PAID',
};

// ---------------------------------------------------------------------------
// Small local formatting helpers (mirrors App.tsx presentation)
// ---------------------------------------------------------------------------
function formatMoney(value?: number, currency = 'HKD') {
  return typeof value === 'number'
    ? new Intl.NumberFormat('en-HK', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)
    : '—';
}

function formatDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function tone(status = '') {
  const s = status.toLowerCase();
  if (s.includes('match') || s.includes('approved') || s.includes('paid') || s.includes('active')) return 'status-positive';
  if (s.includes('variance') || s.includes('block') || s.includes('reject') || s.includes('failed')) return 'status-critical';
  if (s.includes('pending') || s.includes('review') || s.includes('draft')) return 'status-warning';
  return 'status-neutral';
}

function Pill({ value, testId }: { value: string; testId?: string }) {
  return <span className={`status-pill ${tone(value)}`} data-testid={testId}>{value || '—'}</span>;
}

function LoadingRows({ count = 4 }: { count?: number }) {
  return <div className="space-y-2" aria-label="Loading">
    {Array.from({ length: count }).map((_, i) => <div className="skeleton-row" key={i} />)}
  </div>;
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-state">
    <span className="empty-icon"><ClipboardCheck size={18} /></span>
    <div><strong>{title}</strong><p>{detail}</p></div>
  </div>;
}

function ErrorState({ onRetry, label = 'Signal unavailable' }: { onRetry: () => void; label?: string }) {
  return <div className="error-state">
    <AlertCircle size={18} />
    <div><strong>{label}</strong><p>We could not reach the procurement feed.</p></div>
    <button className="button button-quiet" onClick={onRetry}><RefreshCw size={14} /> Retry</button>
  </div>;
}

const FIELD_CLASS = 'flex flex-col gap-1.5';

// ---------------------------------------------------------------------------
// Create PR dialog
// ---------------------------------------------------------------------------
function CreatePrDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const create = useCreateProcurementRecord();
  const client = useQueryClient();
  const [vendorId, setVendorId] = useState('');
  const [region, setRegion] = useState('HK');
  const [currency, setCurrency] = useState('HKD');
  const [projectCode, setProjectCode] = useState('');
  const [budgetLineId, setBudgetLineId] = useState('');
  const [localAmount, setLocalAmount] = useState('');
  const [fxRate, setFxRate] = useState('1');
  const [paymentTerms, setPaymentTerms] = useState('MILESTONE 3:4:3');
  const [expectedSettlementMonth, setExpectedSettlementMonth] = useState('');

  const localAmountNum = parseFloat(localAmount) || 0;
  const fxRateNum = parseFloat(fxRate) || 1;
  const isLocalHkd = currency === 'HKD';
  const hkdAmount = isLocalHkd ? localAmountNum : Math.round(localAmountNum * fxRateNum);
  const tier = hkdAmount > 500_000 ? 'L3' : hkdAmount > 100_000 ? 'L2' : 'L1';

  const pickVendor = (id: string) => {
    const v = VENDOR_BY_ID[id];
    setVendorId(id);
    setRegion(v?.region ?? 'HK');
    setCurrency(v?.currency ?? 'HKD');
    setFxRate(v && v.currency !== 'HKD' ? (v.currency === 'CNY' ? '1.20' : v.currency === 'MYR' ? '1.80' : v.currency === 'IDR' ? '2060' : '1.35') : '1');
  };

  const submit = () => {
    if (!vendorId || !budgetLineId || !projectCode.trim() || !localAmountNum) {
      toast.error('Vendor, budget line, project code and amount are required');
      return;
    }
    create.mutate(
      {
        data: {
          vendorId,
          budgetLineId,
          region: region as 'HK' | 'CN' | 'MY' | 'ID',
          localCurrency: currency,
          localAmount: localAmountNum,
          hkdAmount,
          fxRate: fxRateNum,
          projectCode: projectCode.trim(),
          paymentTerms: paymentTerms || undefined,
          expectedSettlementMonth: expectedSettlementMonth || undefined,
          createdBy: ACTOR.TEAM_LEAD,
          level1Approver: ACTOR.TEAM_LEAD,
          level2Approver: hkdAmount > 100_000 ? ACTOR.DEPUTY : undefined,
          level3Approver: hkdAmount > 500_000 ? ACTOR.HEAD : undefined,
        },
      },
      {
        onSuccess: (record) => {
          void client.invalidateQueries({ queryKey: getListProcurementRecordsQueryKey() });
          toast.success(`PR created · ${record.prNumber}`);
          onOpenChange(false);
          setVendorId(''); setProjectCode(''); setBudgetLineId(''); setLocalAmount(''); setExpectedSettlementMonth('');
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to create PR'),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New purchase requisition</DialogTitle>
          <DialogDescription>Create a PR_DRAFT record and route it into the tiered approval workflow.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className={FIELD_CLASS}>
            <Label>Vendor</Label>
            <Select value={vendorId} onValueChange={pickVendor}>
              <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
              <SelectContent>{VENDOR_OPTIONS.map(v => <SelectItem value={v.id} key={v.id}>{v.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className={FIELD_CLASS}>
              <Label>Region</Label>
              <Select value={region} onValueChange={setRegion}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{REGIONS.map(r => <SelectItem value={r} key={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className={FIELD_CLASS}>
              <Label>Local currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CURRENCIES.map(c => <SelectItem value={c} key={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className={FIELD_CLASS}>
            <Label>Budget line</Label>
            <Select value={budgetLineId} onValueChange={setBudgetLineId}>
              <SelectTrigger><SelectValue placeholder="Select budget line" /></SelectTrigger>
              <SelectContent>{BUDGET_OPTIONS.map(b => <SelectItem value={b.id} key={b.id}>{b.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className={FIELD_CLASS}>
            <Label>Project code</Label>
            <Input value={projectCode} onChange={e => setProjectCode(e.target.value)} placeholder="e.g. INFRA-2026-01" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className={FIELD_CLASS}>
              <Label>Local amount</Label>
              <Input type="number" value={localAmount} onChange={e => setLocalAmount(e.target.value)} placeholder="0" />
            </div>
            <div className={FIELD_CLASS}>
              <Label>{currency === 'HKD' ? 'FX rate (HKD)' : `FX rate (→ HKD)`}</Label>
              <Input type="number" value={fxRate} onChange={e => setFxRate(e.target.value)} placeholder="1" />
            </div>
          </div>
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">HKD equivalent</span>
              <strong>{formatMoney(hkdAmount, 'HKD')}</strong>
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="text-muted-foreground">Approval tier</span>
              <Pill value={tier} />
            </div>
          </div>
          <div className={FIELD_CLASS}>
            <Label>Payment terms (optional)</Label>
            <Input value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)} />
          </div>
          <div className={FIELD_CLASS}>
            <Label>Expected settlement month (optional, YYYY-MM)</Label>
            <Input value={expectedSettlementMonth} onChange={e => setExpectedSettlementMonth(e.target.value)} placeholder="2026-10" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create PR'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Payment schedule workflow row actions
// ---------------------------------------------------------------------------
function ScheduleRow({ schedule, onChanged }: { schedule: PaymentSchedule; onChanged: () => void }) {
  const client = useQueryClient();
  const invoice = useSubmitInvoice();
  const variance = useResolveVariance();
  const signoff = useDualSignoff();
  const pay = useMarkPaid();

  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoiceAmount, setInvoiceAmount] = useState(String(schedule.amount ?? 0));
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [varianceOpen, setVarianceOpen] = useState(false);
  const [varianceNotes, setVarianceNotes] = useState('');
  const [signoffOpen, setSignoffOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [paymentRef, setPaymentRef] = useState('');

  const invalidate = () => void client.invalidateQueries({ queryKey: getListPaymentSchedulesQueryKey(schedule.procurementId) });

  const amount = schedule.amount ?? 0;
  const needsSignoff = amount > 250_000 && !schedule.dualSignoffAt;
  const paid = Boolean(schedule.paidAt);

  return (
    <div className="table-row procurement-row" data-testid={`row-schedule-${schedule.id}`}>
      <span><b className="font-mono">{schedule.isMilestonePayment ? `M${schedule.milestoneNumber ?? ''}` : 'Invoice'}</b>
        <small>{schedule.milestoneDescription || 'Payment'}</small></span>
      <span className="font-mono">{formatDate(schedule.dueDate)}</span>
      <span><b>{formatMoney(amount, 'HKD')}</b>
        <small>{schedule.invoiceNumber ? `Inv ${schedule.invoiceNumber}` : 'No invoice'}</small></span>
      <span><Pill value={schedule.threeWayMatch || (paid ? 'PAID' : 'PENDING')} testId={`status-tw-${schedule.id}`} />
        {schedule.isVarianceDetected && <small className="table-subtext">{schedule.varianceType} {formatMoney(schedule.varianceAmount, 'HKD')}</small>}</span>
      <span>{schedule.dualSignoffAt ? <Pill value="Sign-off" /> : schedule.isVarianceDetected ? <Pill value="Blocked" /> : paid ? <Pill value="Paid" /> : <Pill value="Open" />}</span>
      <span className="schedule-actions">
        {!schedule.invoiceNumber && !paid && (
          <Button size="sm" variant="outline" onClick={() => { setInvoiceAmount(String(amount)); setInvoiceNumber(''); setInvoiceOpen(true); }}>Invoice</Button>
        )}
        {schedule.isVarianceDetected && (
          <Button size="sm" variant="outline" onClick={() => { setVarianceNotes(''); setVarianceOpen(true); }}>Resolve variance</Button>
        )}
        {needsSignoff && (
          <Button size="sm" variant="outline" onClick={() => setSignoffOpen(true)}>Dual sign-off</Button>
        )}
        {schedule.invoiceNumber && !paid && !schedule.isVarianceDetected && (
          <Button size="sm" onClick={() => { setPaymentRef(''); setPayOpen(true); }}>Mark paid</Button>
        )}
      </span>

      <Dialog open={invoiceOpen} onOpenChange={setInvoiceOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Submit invoice</DialogTitle>
            <DialogDescription>Triggers the three-way match against this milestone.</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className={FIELD_CLASS}><Label>Invoice amount (HKD)</Label>
              <Input type="number" value={invoiceAmount} onChange={e => setInvoiceAmount(e.target.value)} /></div>
            <div className={FIELD_CLASS}><Label>Invoice number</Label>
              <Input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} placeholder="INV-…" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInvoiceOpen(false)}>Cancel</Button>
            <Button disabled={invoice.isPending || !invoiceNumber.trim() || !(parseFloat(invoiceAmount) > 0)}
              onClick={() => invoice.mutate({ id: schedule.id, data: { invoiceAmount: parseFloat(invoiceAmount), invoiceNumber: invoiceNumber.trim() } }, {
                onSuccess: (s) => { toast.success(s.threeWayMatch === 'MATCHED' ? 'Invoice matched' : 'Invoice submitted'); invalidate(); onChanged(); setInvoiceOpen(false); },
                onError: (e) => toast.error(e instanceof Error ? e.message : 'Invoice submission failed'),
              })}>{invoice.isPending ? 'Submitting…' : 'Submit invoice'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={varianceOpen} onOpenChange={setVarianceOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Resolve variance</DialogTitle>
            <DialogDescription>Finance resolution record; consult legal where required.</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className={FIELD_CLASS}><Label>Resolution notes</Label>
              <Textarea value={varianceNotes} onChange={e => setVarianceNotes(e.target.value)} placeholder="Reason and authority" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVarianceOpen(false)}>Cancel</Button>
            <Button disabled={variance.isPending || !varianceNotes.trim()}
              onClick={() => variance.mutate({ id: schedule.id, data: { resolvedBy: ACTOR.FINANCE, resolutionNotes: varianceNotes.trim(), requireLegalConsultation: varianceNotes.toLowerCase().includes('legal') } }, {
                onSuccess: () => { toast.success('Variance resolved'); invalidate(); onChanged(); setVarianceOpen(false); },
                onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not resolve variance'),
              })}>{variance.isPending ? 'Resolving…' : 'Resolve'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={signoffOpen} onOpenChange={setSignoffOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Dual sign-off</DialogTitle>
            <DialogDescription>Payments above HKD 250,000 require Head of IT + Finance Auditor.</DialogDescription></DialogHeader>
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm grid gap-1">
            <div className="flex justify-between"><span className="text-muted-foreground">Head of IT</span><b>Leah Chan</b></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Finance Auditor</span><b>Siti Halim</b></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSignoffOpen(false)}>Cancel</Button>
            <Button disabled={signoff.isPending}
              onClick={() => signoff.mutate({ id: schedule.id, data: { headId: ACTOR.HEAD, financeId: ACTOR.FINANCE } }, {
                onSuccess: () => { toast.success('Dual sign-off recorded'); invalidate(); onChanged(); setSignoffOpen(false); },
                onError: (e) => toast.error(e instanceof Error ? e.message : 'Sign-off failed'),
              })}>{signoff.isPending ? 'Recording…' : 'Apply sign-off'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Mark payment as paid</DialogTitle>
            <DialogDescription>Records the paid amount and reference; updates budget paid balance.</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className={FIELD_CLASS}><Label>Payment reference</Label>
              <Input value={paymentRef} onChange={e => setPaymentRef(e.target.value)} placeholder="WIRE-…" /></div>
            <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Amount</span><strong>{formatMoney(amount, 'HKD')}</strong></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>Cancel</Button>
            <Button disabled={pay.isPending || !paymentRef.trim()}
              onClick={() => pay.mutate({ id: schedule.id, data: { paidAmount: amount, paymentReference: paymentRef.trim(), paidBy: ACTOR.FINANCE } }, {
                onSuccess: () => { toast.success('Payment recorded'); invalidate(); onChanged(); setPayOpen(false); },
                onError: (e) => toast.error(e instanceof Error ? e.message : 'Payment failed'),
              })}>{pay.isPending ? 'Recording…' : 'Mark paid'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Procurement detail dialog (status gates + payment milestones)
// ---------------------------------------------------------------------------
function ProcurementDetailDialog({ record, onOpenChange }: { record: ProcurementRecord | null; onOpenChange: (v: boolean) => void }) {
  const client = useQueryClient();
  const advance = useAdvanceProcurementStatus();
  const review = useSubmitProcurementReview();
  const createSchedule = useCreatePaymentSchedule();

  const schedulesQuery = useListPaymentSchedules(
    record?.id ?? '',
    { query: { queryKey: getListPaymentSchedulesQueryKey(record?.id ?? ''), enabled: Boolean(record?.id), refetchInterval: 30000 } },
  );
  const schedules = (schedulesQuery.data as PaymentSchedule[] | undefined) ?? [];

  const [addMilestoneOpen, setAddMilestoneOpen] = useState(false);
  const [msAmount, setMsAmount] = useState('');
  const [msDue, setMsDue] = useState('');
  const [msDesc, setMsDesc] = useState('');

  if (!record) return null;

  const hkd = record.hkdAmount ?? 0;
  const needsReviews = hkd > 100_000;
  const next = NEXT_STATUS[record.status];
  const invalidateProc = () => void client.invalidateQueries({ queryKey: getListProcurementRecordsQueryKey() });

  const doAdvance = () => {
    if (!next) return;
    advance.mutate({ id: record.id, data: { toStatus: next as 'PR_APPROVED', actorId: ACTOR.HEAD } }, {
      onSuccess: () => { toast.success(`Moved to ${next}`); invalidateProc(); },
      onError: (e) => toast.error(e instanceof Error ? e.message : 'Transition failed'),
    });
  };

  const doReview = (reviewType: 'legal' | 'security') => {
    review.mutate({ id: record.id, data: { reviewType, decision: 'APPROVED', reviewerId: ACTOR.DEPUTY } }, {
      onSuccess: () => { toast.success(`${reviewType} review approved`); invalidateProc(); },
      onError: (e) => toast.error(e instanceof Error ? e.message : 'Review failed'),
    });
  };

  const addMilestone = () => {
    const amt = parseFloat(msAmount);
    if (!(amt > 0) || !msDue) { toast.error('Milestone amount and due date are required'); return; }
    createSchedule.mutate({ id: record.id, data: { dueDate: msDue, amount: amt, isMilestonePayment: true, milestoneNumber: schedules.length + 1, milestoneDescription: msDesc.trim() || `Milestone ${schedules.length + 1}` } }, {
      onSuccess: () => { toast.success('Milestone added'); void client.invalidateQueries({ queryKey: getListPaymentSchedulesQueryKey(record.id) }); setAddMilestoneOpen(false); setMsAmount(''); setMsDue(''); setMsDesc(''); },
      onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not add milestone'),
    });
  };

  return (
    <Dialog open={Boolean(record)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{record.prNumber} <span className="font-normal text-muted-foreground">· {record.vendor}</span></DialogTitle>
          <DialogDescription>{record.poNumber || 'PO not yet issued'} · {record.region} · {formatMoney(hkd, 'HKD')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 sm:grid-cols-3 text-sm">
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2"><span className="text-muted-foreground block">State</span><Pill value={record.status} testId={`status-detail-${record.id}`} /></div>
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2"><span className="text-muted-foreground block">Three-way match</span><Pill value={record.match} testId={`status-detail-match-${record.id}`} /></div>
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2"><span className="text-muted-foreground block">Approval tier</span><Pill value={hkd > 500_000 ? 'L3' : hkd > 100_000 ? 'L2' : 'L1'} /></div>
        </div>

        {(record.status === 'PR_DRAFT' || record.status === 'PR_APPROVED') && (
          <div className="flex flex-wrap gap-2">
            {next && <Button onClick={doAdvance} disabled={advance.isPending}>{advance.isPending ? 'Updating…' : `Advance to ${next}`}</Button>}
            {needsReviews && (
              <>
                <Button variant="outline" onClick={() => doReview('legal')} disabled={review.isPending}>Approve legal review</Button>
                <Button variant="outline" onClick={() => doReview('security')} disabled={review.isPending}>Approve security review</Button>
              </>
            )}
            {needsReviews && <span className="self-center text-xs text-muted-foreground">Legal + security review required above HKD 100,000</span>}
          </div>
        )}

        <div className="mt-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Payment schedules</h3>
            <Button size="sm" variant="outline" disabled={schedulesQuery.isLoading} onClick={() => setAddMilestoneOpen(true)}><Plus size={14} /> Add milestone</Button>
          </div>
          {schedulesQuery.isLoading ? <LoadingRows count={2} /> : schedules.length ? (
            <div className="procurement-table mt-2">
              <div className="table-head procurement-head"><span>Milestone</span><span>Due</span><span>Amount</span><span>Match</span><span>Gate</span><span /></div>
              {schedules.map(s => <ScheduleRow key={s.id} schedule={s} onChanged={() => void client.invalidateQueries({ queryKey: getListProcurementRecordsQueryKey() })} />)}
            </div>
          ) : <EmptyState title="No payment schedules" detail="Add a milestone to start the payment workflow." />}
        </div>

        <Dialog open={addMilestoneOpen} onOpenChange={setAddMilestoneOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>Add milestone</DialogTitle>
              <DialogDescription>Standard 3:4:3 structure; amounts must fit within the PO total.</DialogDescription></DialogHeader>
            <div className="grid gap-4 py-2">
              <div className={FIELD_CLASS}><Label>Amount (HKD)</Label>
                <Input type="number" value={msAmount} onChange={e => setMsAmount(e.target.value)} /></div>
              <div className={FIELD_CLASS}><Label>Due date</Label>
                <Input type="date" value={msDue} onChange={e => setMsDue(e.target.value)} /></div>
              <div className={FIELD_CLASS}><Label>Description (optional)</Label>
                <Input value={msDesc} onChange={e => setMsDesc(e.target.value)} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddMilestoneOpen(false)}>Cancel</Button>
              <Button disabled={createSchedule.isPending} onClick={addMilestone}>{createSchedule.isPending ? 'Adding…' : 'Add milestone'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Procurement control surface
// ---------------------------------------------------------------------------
export function ProcurementPage() {
  const query = useListProcurementRecords({ query: { queryKey: getListProcurementRecordsQueryKey(), refetchInterval: 30000 } });
  const client = useQueryClient();
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const records = (query.data as ProcurementRecord[] | undefined) ?? [];
  const statuses = ['All', ...Array.from(new Set(records.map(r => r.status).filter(Boolean)))];
  const filtered = records.filter(r => `${r.vendor} ${r.prNumber} ${r.poNumber} ${r.region}`.toLowerCase().includes(search.toLowerCase()) && (filter === 'All' || r.status === filter));
  const varianceCount = records.filter(r => r.match.toLowerCase().includes('variance') || r.match.toLowerCase().includes('blocked')).length;
  const detail = records.find(r => r.id === detailId) ?? null;

  const markLocalDone = () => void client.invalidateQueries({ queryKey: getListProcurementRecordsQueryKey() });

  return <div className="page-stack">
    <div className="mini-metrics">
      <div className="mini-metric"><span>Open records</span><strong>{formatNumberShort(records.length)}</strong></div>
      <div className="mini-metric mini-amber"><span>Pending review</span><strong>{formatNumberShort(records.filter(r => r.status.toLowerCase().includes('pending') || r.status.toLowerCase().includes('draft')).length)}</strong></div>
      <div className="mini-metric mini-coral"><span>Variance flags</span><strong>{formatNumberShort(varianceCount)}</strong></div>
      <div className="mini-metric mini-teal"><span>In workflow</span><strong>{formatMoney(records.reduce((sum, r) => sum + (r.hkdAmount || 0), 0))}</strong></div>
    </div>
    <section className="panel">
      <div className="toolbar-inner">
        <div className="flex items-center justify-between w-full gap-2">
          <div className="search-field"><span className="sr-only">Search</span><svg className="lucide" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search vendor, PR, PO" data-testid="input-search-procurement" /></div>
          <Button size="sm" onClick={() => setCreateOpen(true)}><Plus size={14} /> New PR</Button>
        </div>
        <div className="segmented">{statuses.map(value => <button className={filter === value ? 'segment-active' : ''} onClick={() => setFilter(value)} key={value} data-testid={`button-filter-${value.toLowerCase().replace(/\s+/g, '-')}`}>{value}</button>)}</div>
      </div>
      <BudgetImportExportBlock />
      {query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : query.isLoading ? <LoadingRows count={5} /> : !filtered.length ? <EmptyState title={records.length ? 'No matching records' : 'No procurement records'} detail={records.length ? 'Try a different vendor, reference, or status.' : 'Create a purchase requisition to start the workflow.'} /> : <div className="procurement-table">
        <div className="table-head procurement-head"><span>Reference</span><span>Vendor</span><span>Region</span><span>Amount</span><span>Match</span><span>State</span><span /></div>
        {filtered.map(record => <div className="table-row procurement-row" key={record.id} data-testid={`row-procurement-${record.id}`}>
          <span><b className="font-mono">{record.prNumber}</b><small className="font-mono">{record.poNumber || 'PO pending'}</small></span>
          <span><b>{record.vendor}</b><small>Created {formatDate(record.createdAt)}</small></span>
          <span>{record.region}</span>
          <span><b>{formatMoney(record.amount, record.currency)}</b><small>{formatMoney(record.hkdAmount, 'HKD')} equivalent</small></span>
          <span><Pill value={record.match} testId={`status-match-${record.id}`} /></span>
          <span><Pill value={record.status} testId={`status-procurement-${record.id}`} /></span>
          <span><Button size="sm" variant="outline" onClick={() => setDetailId(record.id)}>Manage</Button></span>
        </div>)}
      </div>}
    </section>
    <VendorSubmissions />
    <CreatePrDialog open={createOpen} onOpenChange={setCreateOpen} />
    <ProcurementDetailDialog record={detail} onOpenChange={(v) => { if (!v) { setDetailId(null); markLocalDone(); } }} />
  </div>;
}

function formatNumberShort(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

// ---------------------------------------------------------------------------
// Vendor API submissions panel (kept for continuity)
// ---------------------------------------------------------------------------
function VendorSubmissions() {
  const vendorQuery = useVendorSubmissions();
  const rows = vendorQuery.data?.submissions ?? [];
  return (
    <section className="panel animate-in">
      <div className="section-heading"><div><span className="eyebrow">Vendor API</span><h2>Incoming submissions</h2></div><span className="muted-label">Source: {vendorQuery.data?.source ?? '…'}</span></div>
      {vendorQuery.isLoading ? <LoadingRows count={3} /> : rows.length ? <div className="activity-table">
        <div className="table-head"><span>Type</span><span>PO</span><span>Amount</span><span>Vendor</span><span>Submitted</span></div>
        {rows.map((s: VendorSubmission, i: number) => <div className="table-row" key={`${s.poNumber}-${i}`}><span><Pill value={s.type} /></span><span className="font-mono"><b>{s.poNumber}</b></span><span><b>{formatMoney(s.amount, 'HKD')}</b></span><span className="font-mono">{s.vendorId}</span><span className="muted-label">{s.submittedAt}</span></div>)}
      </div> : <EmptyState title="No submissions" detail="The vendor API feed will appear here when connected." />}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Budget import / export toolbar
// ---------------------------------------------------------------------------
function BudgetImportExportBlock() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState<'csv' | 'xlsx' | null>(null);
  const importMutation = useImportBudget();

  const handleExport = async (format: 'csv' | 'xlsx') => {
    try {
      setExporting(format);
      await exportBudget(format);
      toast.success(`Exported budget lines (${format.toUpperCase()})`);
    } catch {
      toast.error('Budget export failed');
    } finally {
      setExporting(null);
    }
  };

  const onImportFile = (file: File | null) => {
    if (!file) return;
    importMutation.mutate(file, {
      onSuccess: (res) => {
        toast.success(`Imported ${res.inserted} new, ${res.updated} updated (${res.skipped} skipped)`);
      },
      onError: (err) => {
        toast.error(`Import failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      },
    });
  };

  return (
    <div className="toolbar-inner export-toolbar">
      <div><span className="eyebrow">Budget</span><h2 className="panel-title">Import / export budget lines</h2></div>
      <div className="export-actions">
        <button className="button button-quiet" onClick={() => void handleExport('csv')} disabled={exporting !== null || importMutation.isPending} data-testid="button-export-budget-csv">{exporting === 'csv' ? 'Preparing...' : 'CSV'}<Download size={14} /></button>
        <button className="button button-quiet" onClick={() => void handleExport('xlsx')} disabled={exporting !== null || importMutation.isPending} data-testid="button-export-budget-xlsx">{exporting === 'xlsx' ? 'Preparing...' : 'Excel'}<FileSpreadsheet size={14} /></button>
        <button className="button button-primary" onClick={() => fileInputRef.current?.click()} disabled={importMutation.isPending} data-testid="button-import-budget">{importMutation.isPending ? 'Importing...' : 'Import budget'}<Upload size={14} /></button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => { onImportFile(e.target.files?.[0] ?? null); e.target.value = ''; }}
        />
      </div>
    </div>
  );
}
