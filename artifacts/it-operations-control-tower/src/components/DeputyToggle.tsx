import { useEffect, useRef, useState } from 'react';
import { UserRound, CalendarClock, CalendarX, Check, Loader2, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { useDeputyDelegation, useSetDeputyLeaveWindow } from '@/hooks/use-deputy';

function todayISO() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 10);
}

export function DeputyToggle() {
  const { data, isLoading } = useDeputyDelegation();
  const mutate = useSetDeputyLeaveWindow();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  const acting = !!data?.acting;
  const scheduled = !!data?.leaveStart;
  const principal = data?.principal;

  useEffect(() => {
    if (open && data) {
      setStart(data.leaveStart ?? '');
      setEnd(data.leaveEnd ?? '');
    }
  }, [open, data]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const apply = () => {
    if (!principal) {
      toast.error('No delegation target found');
      return;
    }
    mutate.mutate(
      { principalId: principal.id, leaveStart: start || null, leaveEnd: end || null },
      {
        onSuccess: () => {
          toast.success('Deputy delegation updated');
          setOpen(false);
        },
        onError: () => toast.error('Could not update delegation'),
      },
    );
  };

  const clear = () => {
    if (!principal) return;
    mutate.mutate(
      { principalId: principal.id, leaveStart: null, leaveEnd: null },
      {
        onSuccess: () => {
          toast.success('Deputy delegation cleared');
          setOpen(false);
        },
        onError: () => toast.error('Could not clear delegation'),
      },
    );
  };

  const label =
    isLoading ? 'Deputy ...'
    : acting ? 'Deputy On'
    : scheduled ? 'Deputy Scheduled'
    : 'Deputy Off';

  return (
    <div className="deputy-wrap" ref={wrapRef}>
      <button
        className={`deputy-toggle ${acting ? 'deputy-active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Deputy delegation"
        data-testid="button-deputy-toggle"
      >
        <UserRound size={14} /> {label}
      </button>

      {open && (
        <div className="deputy-popover" data-testid="deputy-popover">
          <div className="deputy-popover-head">
            <span className="eyebrow">Deputy delegation</span>
          </div>

          {acting && (
            <div className="deputy-status acting">
              <ShieldAlert size={14} />
              <span><b>{data?.deputy?.fullName || 'Deputy'}</b> is acting for <b>{principal?.fullName || 'principal'}</b> while they are on leave.</span>
            </div>
          )}
          {!acting && scheduled && (
            <div className="deputy-status">
              <CalendarClock size={14} />
              <span>Leave scheduled {data?.leaveStart} &rarr; {data?.leaveEnd ?? data?.leaveStart}</span>
            </div>
          )}
          {!acting && !scheduled && (
            <div className="deputy-status">
              <UserRound size={14} />
              <span>No leave scheduled. No one is acting as deputy.</span>
            </div>
          )}

          <div className="deputy-fields">
            <label>
              <span>Leave start</span>
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} data-testid="deputy-start" />
            </label>
            <label>
              <span>Leave end</span>
              <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} data-testid="deputy-end" />
            </label>
          </div>

          <div className="deputy-actions">
            <button className="button button-primary" onClick={apply} disabled={mutate.isPending || !principal} data-testid="deputy-apply">
              {mutate.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Apply
            </button>
            <button className="button button-quiet" onClick={clear} disabled={mutate.isPending || !principal} data-testid="deputy-clear">
              <CalendarX size={13} /> Clear
            </button>
          </div>

          {!principal && (
            <p className="deputy-note">No delegation target configured (no profile with a linked deputy).</p>
          )}
          <small className="deputy-note">Runs every 5 min via pg_cron against the live database.</small>
        </div>
      )}
    </div>
  );
}
