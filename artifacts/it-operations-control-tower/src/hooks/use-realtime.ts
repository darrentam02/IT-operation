import { useEffect } from 'react';
import { type QueryKey, useQueryClient } from '@tanstack/react-query';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { useAuth } from '@/hooks/use-auth';

/*
 * Supabase Realtime postgres_changes subscriptions.
 *
 * React-query stays the source of truth; an edge event just invalidates the
 * related query keys so the next read refetches. Requires a full-mode staff
 * JWT + the client env vars; in demo mode (no real JWT) or when the vars are
 * unset the hook no-ops and the existing polling stands.
 */

function supabaseEnv(): { url?: string; anonKey?: string } {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  return { url, anonKey };
}

function canSubscribe(token: string | null | undefined): boolean {
  if (!token || token === 'demo') return false;
  return Boolean(supabaseEnv().url && supabaseEnv().anonKey);
}

export function useRealtimeInvalidate(table: string, queries: QueryKey[], enabled = true): void {
  const queryClient = useQueryClient();
  const { accessToken } = useAuth();
  const queryKeys = queries.map((q) => JSON.stringify(q)).join('|');

  useEffect(() => {
    if (!enabled || !canSubscribe(accessToken)) return;
    const { url, anonKey } = supabaseEnv();
    if (!url || !anonKey) return;

    const client: SupabaseClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    const channel = client
      .channel(`db-${table}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        for (const q of queries) {
          void queryClient.invalidateQueries({ queryKey: q });
        }
      })
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, enabled, accessToken, queryKeys]);
}