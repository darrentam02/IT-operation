import { useCallback, useEffect, useState } from 'react';
import { KeyRound, LogOut, RefreshCw, Loader2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  createVendorClient,
  DEMO_VENDOR_KEYS,
  VENDOR_API_BASE_URL,
  type VendorClient,
  type VendorPortalData,
  type VendorApiError,
} from '@/lib/api/vendor-client';
import { VendorPortalLayout } from '@/components/vendor/VendorPortalLayout';

const STORAGE_KEY = 'orbital.vendor.apiKey';
export function VendorPage() {
  const [savedKey, setSavedKey] = useState(() => window.localStorage.getItem(STORAGE_KEY) || '');
  const [draftKey, setDraftKey] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [data, setData] = useState<VendorPortalData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const client: VendorClient | null = savedKey ? createVendorClient(savedKey) : null;

  const load = useCallback(async (clientUse: VendorClient | null) => {
    if (!clientUse) return;
    setLoading(true);
    setError(null);
    try {
      const portal = await clientUse.portal();
      setData(portal);
    } catch (err) {
      const e = err as VendorApiError;
      setError(e.status === 401 ? 'Invalid or revoked vendor API key' : e.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (client) void load(client);
  }, [client, load]);

  const signIn = () => {
    const key = draftKey.trim();
    if (!key) {
      toast.error('Enter the vendor API key');
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, key);
    setSavedKey(key);
    setDraftKey('');
    setError(null);
  };

  const signOut = () => {
    window.localStorage.removeItem(STORAGE_KEY);
    setSavedKey('');
    setData(null);
    setError(null);
  };

  const refresh = async () => {
    if (!client) return;
    await load(client);
    toast.success('Vendor portal refreshed');
  };
  if (!savedKey) {
    return (
      <div className="page-stack">
        <section className="compliance-hero panel signal-grid">
          <div className="compliance-orb"><KeyRound size={20} /></div>
          <div>
            <span className="eyebrow">Vendor self-service</span>
            <h2>Supplier gateway</h2>
            <p>Sign in with your vendor API key to view purchase orders, confirm milestone deliveries, and submit invoices against live procurement.</p>
          </div>
        </section>
        <section className="panel max-w-xl">
          <div className="grid gap-2">
            <Label htmlFor="vendor-demo">Demo vendor</Label>
            <Select value={vendorName} onValueChange={setVendorName}>
              <SelectTrigger id="vendor-demo"><SelectValue placeholder="Choose a demo vendor" /></SelectTrigger>
              <SelectContent>
                {Object.entries(DEMO_VENDOR_KEYS).map(([name, key]) => (
                  <SelectItem key={key} value={name}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Picking a vendor pre-fills its API key.</p>
          </div>
          <div className="grid gap-2 mt-4">
            <Label htmlFor="vendor-key">Vendor API key</Label>
            <Input
              id="vendor-key"
              value={draftKey}
              onChange={(e) => setDraftKey(e.target.value)}
              placeholder="vk_demo_..."
              onKeyDown={(e) => { if (e.key === 'Enter') signIn(); }}
            />
            <p className="text-xs text-muted-foreground">
              Endpoint: <span className="font-mono">{VENDOR_API_BASE_URL}/api/vendor/*</span>
            </p>
          </div>
          <Button type="button" className="mt-4" onClick={signIn} disabled={!draftKey.trim()}>
            Enter vendor portal
          </Button>
        </section>
      </div>
    );
  }
  return (
    <div className="page-stack">
      <div className="toolbar panel flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="signal-dot" />
          <div>
            <p className="text-sm font-semibold">Vendor self-service connected</p>
            <p className="text-xs text-muted-foreground">
              Data is scoped to your vendor API key (region-isolated)
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={loading}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={signOut}>
            <LogOut size={14} /> Switch vendor
          </Button>
        </div>
      </div>

      {loading && !data && (
        <section className="panel"><div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin" /> Loading your vendor portal...        </div></section>
      )}

      {error && (
        <section className="panel">
          <div className="flex items-start gap-2 text-sm">
            <AlertCircle size={16} className="text-red-500 mt-0.5" />
            <div>
              <p className="font-medium">Could not load the portal</p>
              <p className="text-muted-foreground">{error}</p>
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={signOut}>
                Re-enter API key
              </Button>
            </div>
          </div>
        </section>
      )}

      {data && client && (
        <VendorPortalLayout
          data={data}
          client={client}
          onSignOut={signOut}
          onDataChange={async () => { await load(client); }}
        />
      )}
    </div>
  );
}
