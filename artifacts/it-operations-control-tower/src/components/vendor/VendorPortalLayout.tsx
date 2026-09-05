import { Building2, Globe2, Landmark, ShieldCheck, Loader2 } from 'lucide-react';
import type { VendorPortalData, VendorClient } from '@/lib/api/vendor-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { VendorMilestoneTracker } from '@/components/vendor/VendorMilestoneTracker';

function formatMoney(value?: number, currency = 'HKD') {
  return typeof value === 'number'
    ? new Intl.NumberFormat('en-HK', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)
    : '-';
}
interface Props {
  data: VendorPortalData;
  client: VendorClient;
  onSignOut: () => void;
  onDataChange: () => Promise<void> | void;
}

export function VendorPortalLayout({ data, client, onSignOut, onDataChange }: Props) {
  const { profile, summary } = data;

  return (
    <div className="space-y-5">
      <section className="panel">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="avatar avatar-lime"><Building2 size={18} /></span>
            <div>
              <h2 className="text-xl font-semibold">{profile.vendorName}</h2>
              <p className="text-sm text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="inline-flex items-center gap-1"><Globe2 size={13} /> {profile.region}</span>
                <span className="inline-flex items-center gap-1"><Landmark size={13} /> {profile.paymentTerms || 'NET 30'}</span>
                {profile.taxId && <span className="font-mono">Tax {profile.taxId}</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary"><ShieldCheck size={12} className="text-emerald-500" /> Verified partner</Badge>
            <Button type="button" variant="outline" size="sm" onClick={onSignOut}>Switch vendor</Button>
          </div>
        </div>
      </section>

      <div className="metric-grid">
        <div className="metric-card accent-teal animate-in">
          <div className="metric-top"><span>Purchase orders</span><span className="font-mono">{summary.totalPos}</span></div>
          <strong>{formatMoney(summary.totalHkd)}</strong>
          <small>{summary.acceptedPos} accepted</small>
          <div className="metric-rule" />
        </div>
        <div className="metric-card accent-lime animate-in animate-delay-1">
          <div className="metric-top"><span>Paid to date</span><span className="font-mono">SETTLED</span></div>
          <strong>{formatMoney(summary.paidHkd)}</strong>
          <small>Confirmed HKD payments</small>
          <div className="metric-rule" />
        </div>
        <div className="metric-card accent-amber animate-in animate-delay-2">
          <div className="metric-top"><span>Pending payments</span><span className="font-mono">OPEN</span></div>
          <strong>{formatMoney(summary.pendingHkd)}</strong>
          <small>Invoiced but not yet paid</small>
          <div className="metric-rule" />
        </div>
        <div className="metric-card accent-coral animate-in animate-delay-3">
          <div className="metric-top"><span>Variance blocks</span><span className="font-mono">ALERT</span></div>
          <strong>{summary.varianceBlocked}</strong>
          <small>Awaiting Finance resolution</small>
          <div className="metric-rule" />
        </div>
      </div>

      <section className="panel">
        <div className="section-heading">
          <div><span className="eyebrow">Commercial / live</span><h2>Purchase orders & milestones</h2></div>
          <span className="muted-label">3:4:3 milestone breakdown</span>
        </div>
      </section>

      <VendorMilestoneTracker data={data} client={client} onDataChange={onDataChange} />
    </div>
  );
}
