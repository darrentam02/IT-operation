import { useRef, useState } from 'react';
import { FileText, UploadCloud, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { VendorMilestone, VendorClient, InvoiceResult } from '@/lib/api/vendor-client';

interface Props {
  milestone: VendorMilestone;
  client: VendorClient;
  onComplete: () => Promise<void> | void;
  onClose: () => void;
}
function formatMoney(value?: number, currency = 'HKD') {
  return typeof value === 'number'
    ? new Intl.NumberFormat('en-HK', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)
    : '-';
}

export function VendorInvoiceUploadModal({ milestone, client, onClose, onComplete }: Props) {
  const [tab, setTab] = useState<'pdf' | 'manual'>('pdf');
  const [file, setFile] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceAmount, setInvoiceAmount] = useState('');
  const [lineTotal, setLineTotal] = useState('');
  const [shipping, setShipping] = useState('');
  const [tax, setTax] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<InvoiceResult | null>(null);
  const dropRef = useRef<HTMLInputElement>(null);
  const onFile = (f: File | null) => {
    if (!f) return;
    if (!/\.pdf$/i.test(f.name)) {
      toast.error('Only PDF invoices are supported for OCR');
      return;
    }
    setFile(f);
    setReading(true);
    const reader = new FileReader();
    reader.onload = () => {
      setInvoiceNumber('');
      setInvoiceAmount('');
      setReading(false);
    };
    reader.onerror = () => {
      setReading(false);
      toast.error('Could not read the PDF file');
    };
    reader.readAsDataURL(f);
  };
  const submit = async () => {
    const amount = Number(invoiceAmount);
    if (!invoiceNumber || !Number.isFinite(amount) || amount <= 0) {
      toast.error('A valid invoice number and amount are required');
      return;
    }
    const shippingAmount = Number(shipping) || 0;
    const taxAmount = Number(tax) || 0;
    const varianceAmount = shippingAmount + taxAmount;
    setSubmitting(true);
    try {
      const res = await client.submitInvoice({
        scheduleId: milestone.id,
        invoiceNumber,
        invoiceAmount: amount,
        varianceAmount,
        currency: 'HKD',
        invoiceDate: new Date().toISOString().slice(0, 10),
        ocrInvoiceData: {
          source: file ? 'pdf' : 'manual',
          fileName: file?.name ?? null,
          invoiceNumber,
          invoiceAmount: amount,
          shippingAmount,
          taxAmount,
        },
      });
      setResult(res);
      toast.success(res.matchStatus === 'MATCHED' ? 'Invoice matched' : 'Variance detected');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit invoice');
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !submitting) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Submit invoice for milestone {milestone.milestoneNumber}</DialogTitle>
          <DialogDescription>
            {milestone.milestoneDescription} : target {formatMoney(milestone.amount)}
          </DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'pdf' | 'manual')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="pdf"><FileText size={14} /> PDF / OCR</TabsTrigger>
            <TabsTrigger value="manual"><UploadCloud size={14} /> CSV / manual</TabsTrigger>
          </TabsList>
          <TabsContent value="pdf" className="space-y-3">
            <button
              type="button"
              onClick={() => dropRef.current?.click()}
              disabled={reading}
              className="w-full rounded-lg border border-dashed px-4 py-8 text-center hover:bg-muted/40 transition-colors"
              data-testid="vendor-dropzone"
            >
              {reading ? (
                <Loader2 size={22} className="mx-auto animate-spin text-muted-foreground" />
              ) : file ? (
                <CheckCircle2 size={22} className="mx-auto text-emerald-500" />
              ) : (
                <UploadCloud size={22} className="mx-auto text-muted-foreground" />
              )}
              <p className="mt-2 text-sm font-medium">
                {file ? file.name : 'Drop the invoice PDF here'}
              </p>
              <p className="text-xs text-muted-foreground">
                OCR extracts invoice number, amount and date server-side
              </p>
            </button>
            <input
              ref={dropRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            />
          </TabsContent>
          <TabsContent value="manual" className="space-y-3">
            <div className="grid gap-2">
              <Label htmlFor="inv-number">Invoice number</Label>
              <Input id="inv-number" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="INV-2026-0042" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="inv-amount">Invoice amount (HKD)</Label>
              <Input id="inv-amount" type="number" value={invoiceAmount} onChange={(e) => setInvoiceAmount(e.target.value)} placeholder="280000" />
            </div>
          </TabsContent>
        </Tabs>
        <div className="grid gap-3 rounded-lg border p-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="ocr-no">Invoice no.</Label>
              <Input id="ocr-no" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="Inferred or manual" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ocr-amt">Amount (HKD)</Label>
              <Input id="ocr-amt" type="number" value={invoiceAmount} onChange={(e) => setInvoiceAmount(e.target.value)} placeholder="Inferred or manual" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="shipping">Shipping</Label>
              <Input id="shipping" type="number" value={shipping} onChange={(e) => setShipping(e.target.value)} placeholder="0" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="tax">Tax</Label>
              <Input id="tax" type="number" value={tax} onChange={(e) => setTax(e.target.value)} placeholder="0" />
            </div>
          </div>
        </div>
        {result && (
          <div className={`rounded-lg border p-3 ${result.matchStatus === 'MATCHED' ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
            <div className="flex items-center gap-2 text-sm font-semibold">
              {result.matchStatus === 'MATCHED'
                ? <CheckCircle2 size={16} className="text-emerald-500" />
                : <AlertTriangle size={16} className="text-amber-500" />}
              {result.matchStatus === 'MATCHED' ? 'Match confirmed' : `Variance detected: ${result.varianceType}`}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              PO {formatMoney(result.poAmount)} vs invoice {formatMoney(result.invoiceAmount)}
            </p>
            {result.matchStatus !== 'MATCHED' && result.matchStatus !== 'PENDING' && (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                This invoice is VARIANCE_BLOCKED until Finance resolves it.
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>Close</Button>
          <Button type="button" onClick={submit} disabled={submitting || Boolean(result)}>
            {submitting ? <Loader2 size={15} className="animate-spin" /> : 'Submit invoice'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
