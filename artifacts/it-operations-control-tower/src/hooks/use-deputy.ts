import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export type DeputyPrincipal = {
  id: string;
  fullName: string;
  role: string;
  onLeave: boolean;
};
export type DeputyDeputy = {
  id: string;
  fullName: string;
  role: string;
  baseRole: string | null;
};
export type DeputyDelegation = {
  principal: DeputyPrincipal | null;
  deputy: DeputyDeputy | null;
  leaveStart: string | null;
  leaveEnd: string | null;
  active: boolean;
  acting: boolean;
};

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`);
  return (await res.json()) as T;
}
async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`);
  return (await res.json()) as T;
}

export const deputyDelegationKey = ['deputy', 'delegation'] as const;

export function useDeputyDelegation() {
  return useQuery<DeputyDelegation>({
    queryKey: deputyDelegationKey,
    queryFn: () => getJSON<DeputyDelegation>('/api/deputy/delegation'),
    retry: 1,
  });
}

export function useSetDeputyLeaveWindow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      principalId: string;
      leaveStart: string | null;
      leaveEnd: string | null;
    }) => postJSON<DeputyDelegation>('/api/deputy/delegation', vars),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: deputyDelegationKey });
    },
  });
}
