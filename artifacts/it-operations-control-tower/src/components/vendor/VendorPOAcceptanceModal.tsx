import { useState } from 'react';
import { ShieldCheck, AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import type { VendorPo, VendorClient } from '@/lib/api/vendor-client';

interface Props {
  po: VendorPo;
  client: VendorClient;
  onComplete: () => Promise<void> | void;
  onClose: () => void;
}

export function VendorPOAcceptanceModal({ po, client, onClose, onComplete }: Props) {
  const [decision, setDecision] = useState<'accepted' | 'dispute'>('accepted');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (po.poAcceptedAt) return;
    setSubmitting(true);
    try {
      const result = await client.acceptPo({ procurementId: po.id, decision, notes });
      toast.success(decision === 'accepted' ? 'PO accepted' : 'Dispute recorded for review');
      await onComplete();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to record response');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !submitting) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{po.poAcceptedAt ? 'PO response locked' : 'Respond to purchase order'}</DialogTitle>
          <DialogDescription>
            {po.poNumber || po.prNumber} - {po.paymentTerms || 'No payment terms'}
          </DialogDescription>
        </DialogHeader>
        {po.poAcceptedAt ? (
          <div className="flex items-start gap-2 text-sm">
            <ShieldCheck size={16} className="text-emerald-500 mt-0.5" />
            <p>Your response was locked and sent to the finance team. No further changes are allowed.</p>
          </div>
        ) : (
          <>
            <div className="grid gap-2">
              <Label>Decision</Label>
              <div className="flex gap-2">
                <Button type="button" variant={decision === 'accepted' ? 'default' : 'outline'} size="sm"
                  onClick={() => setDecision('accepted')}>Accept PO</Button>
                <Button type="button" variant={decision === 'dispute' ? 'default' : 'outline'} size="sm"
                  onClick={() => setDecision('dispute')}>Dispute</Button>
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Notes (optional)</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
                placeholder="Add a note for the finance team" />
            </div>
          </>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          {!po.poAcceptedAt && (
            <Button type="button" onClick={submit} disabled={submitting}>
              {submitting ? <Loader2 size={15} className="animate-spin" /> : null}
              {decision === 'accepted' ? 'Record acceptance' : 'File dispute'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}