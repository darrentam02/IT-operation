import { useState } from 'react';
import { PackageCheck, Truck, FileText, CheckCircle2, AlertTriangle, Clock3 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { VendorClient, VendorPortalData, VendorPo, VendorMilestone } from '@/lib/api/vendor-client';
import { VendorInvoiceUploadModal } from '@/components/vendor/VendorInvoiceUploadModal';
import { VendorPOAcceptanceModal } from '@/components/vendor/VendorPOAcceptanceModal';
function formatMoney(value?: number, currency = 'HKD') {
  return typeof value === 'number'
    ? new Intl.NumberFormat('en-HK', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)
    : '-';
}
function formatDate(value?: string) {
  if (!value) return '-';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

interface Props {
  data: VendorPortalData;
  client: VendorClient;
  onDataChange: () => Promise<void> | void;
}
export function VendorMilestoneTracker({ data, client, onDataChange }: Props) {
  const [acceptPo, setAcceptPo] = useState<VendorPo | null>(null);
  const [invoiceFor, setInvoiceFor] = useState<VendorMilestone | null>(null);
  const [delivering, setDelivering] = useState<Record<string, string>>({});
  const [submittingDelivery, setSubmittingDelivery] = useState<string | null>(null);

  const byPo = data.pos.map((po) => ({
    po,
    milestones: data.milestones
      .filter((m) => m.procurementId === po.id)
      .sort((a, b) => a.milestoneNumber - b.milestoneNumber),
  }));

  const confirmDelivery = async (po: VendorPo, m: VendorMilestone) => {
    const date = delivering[m.id] || new Date().toISOString().slice(0, 10);
    setSubmittingDelivery(m.id);
    try {
      await client.recordDelivery({
        procurementId: po.id,
        scheduleId: m.id,
        deliveredAt: date,
      });
      toast.success(`Milestone ${m.milestoneNumber} delivery confirmed`);
      await onDataChange();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to confirm delivery');
    } finally {
      setSubmittingDelivery(null);
    }
  };

  return (
    <div className="space-y-4">
      {byPo.map(({ po, milestones }) => (
        <section className="panel" key={po.id}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="eyebrow">{po.poNumber || po.prNumber}</span>
              <h2 className="text-lg font-semibold">
                {po.hkdAmount ? formatMoney(po.hkdAmount) : `${formatMoney(po.localAmount, po.localCurrency)}`}
              </h2>
              <p className="text-sm text-muted-foreground">
                {po.paymentTerms || 'No payment terms'}  - {po.region}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <Badge variant={po.status === 'VARIANCE_BLOCKED' ? 'destructive' : 'secondary'}>{po.status}</Badge>
              {!po.poAcceptedAt && (
                <Button type="button" size="sm" variant="outline" onClick={() => setAcceptPo(po)}>
                  <CheckCircle2 size={14} /> Accept PO
                </Button>
              )}
              {po.poAcceptedAt && <span className="text-xs text-emerald-600">Accepted {formatDate(po.poAcceptedAt)}</span>}
            </div>
          </div>

          <div className="mt-4 divide-y">
            {milestones.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center gap-3 py-3">
                <Badge variant="outline" className="w-7 justify-center">M{m.milestoneNumber}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.milestoneDescription || 'Milestone payment'}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatMoney(m.amount)}  - due {formatDate(m.dueDate)}
                  </p>
                </div>
                {m.deliveredAt ? (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                    <Truck size={13} /> Delivered {formatDate(m.deliveredAt)}
                  </span>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <Input
                      type="date"
                      className="h-8 w-36"
                      value={delivering[m.id] || ''}
                      onChange={(e) => setDelivering((s) => ({ ...s, [m.id]: e.target.value }))}
                      data-testid={`delivery-date-${m.milestoneNumber}`}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => confirmDelivery(po, m)}
                      disabled={submittingDelivery === m.id}
                    >
                      <Truck size={13} /> Confirm
                    </Button>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  {m.paidAt ? (
                    <Badge variant="secondary"><CheckCircle2 size={12} className="text-emerald-500" /> Paid</Badge>
                  ) : m.isVarianceDetected || m.status === 'PRICE_VARIANCE' || m.status === 'SHIPPING_TAX_VARIANCE' ? (
                    <Badge variant="destructive"><AlertTriangle size={12} /> {m.varianceType || 'Variance'}</Badge>
                  ) : m.status === 'MATCHED' ? (
                    <Badge variant="secondary"><CheckCircle2 size={12} className="text-emerald-500" /> Matched</Badge>
                  ) : m.invoiceAmount ? (
                    <Badge variant="secondary"><Clock3 size={12} /> Awaiting review</Badge>
                  ) : (
                    <Badge variant="outline"><Clock3 size={12} /> Pending</Badge>
                  )}
                  {!m.invoiceAmount && !m.paidAt && (
                    <Button type="button" size="sm" onClick={() => setInvoiceFor(m)}>
                      <FileText size={13} /> Submit invoice
                    </Button>
                  )}
                  {m.invoiceAmount && !m.paidAt && (
                    <Button type="button" size="sm" variant="outline" onClick={() => setInvoiceFor(m)}>
                      <FileText size={13} /> Recheck
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      {!data.pos.length && (
        <div className="panel text-center py-12">
          <div className="vendor-empty-icon"><PackageCheck size={22} /></div>
          <p className="text-sm font-medium">No purchase orders yet</p>
          <p className="text-xs text-muted-foreground mt-1">When procurement issues a PO to this vendor, it will appear here for acceptance, delivery confirmation, and invoicing.</p>
        </div>
      )}

      {acceptPo && (
        <VendorPOAcceptanceModal
          po={acceptPo}
          client={client}
          onClose={() => setAcceptPo(null)}
          onComplete={onDataChange}
        />
      )}
      {invoiceFor && (
        <VendorInvoiceUploadModal
          milestone={invoiceFor}
          client={client}
          onClose={() => setInvoiceFor(null)}
          onComplete={onDataChange}
        />
      )}
    </div>
  );
}
