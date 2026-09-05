import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export type BudgetRow = {
  fiscalYear: number;
  category: string;
  allocated: number;
  incurred: number;
  paid: number;
  remaining: number;
};

export type BudgetImportInput = {
  fiscalYear: number;
  category: string;
  allocated: number;
  incurred?: number;
};

export type BudgetImportResult = {
  imported: number;
  updated: number;
  years: number[];
};

export type BudgetImportError = {
  errors: { row: number; field: string; message: string }[];
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
  if (!res.ok) {
    let message = `HTTP ${res.status} ${path}`;
    try {
      const err = (await res.json()) as BudgetImportError;
      if (Array.isArray(err?.errors) && err.errors.length) {
        message = err.errors.map((e) => `Row ${e.row}: ${e.message}`).join('; ');
      }
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export function useBudgetSummary(year?: number) {
  return useQuery({
    queryKey: ['budget', 'summary', year ?? null],
    queryFn: () => getJSON<BudgetRow[]>(`/api/budget/summary${year != null ? `?year=${year}` : ''}`),
    staleTime: 30000,
  });
}

export function useBudgetImport() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (rows: BudgetImportInput[]) => postJSON<BudgetImportResult>('/api/budget/import', { rows }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['budget', 'summary'] });
    },
  });
}