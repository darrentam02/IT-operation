import { useMutation } from '@tanstack/react-query';

export type BudgetImportResult = {
  total: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
};

export async function exportBudget(format: 'csv' | 'xlsx') {
  const res = await fetch(`/api/budget/export?format=${format}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} /api/budget/export`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="([^"]+)"/);
  anchor.download = match ? match[1] : `budget-lines.${format}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function useImportBudget() {
  return useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/budget/import', {
        method: 'POST',
        body: fd,
      });
      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body.error) message = body.error;
        } catch {
          // ignore
        }
        throw new Error(message);
      }
      return (await res.json()) as BudgetImportResult;
    },
  });
}
