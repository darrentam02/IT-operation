import * as XLSX from 'xlsx';
import type { BudgetImportInput, BudgetRow } from '@/hooks/use-budget';

const HEADER_ALIASES: Record<string, 'fiscalYear' | 'category' | 'allocated' | 'incurred'> = {
  'fiscal year': 'fiscalYear',
  fiscal_year: 'fiscalYear',
  fiscalyear: 'fiscalYear',
  fy: 'fiscalYear',
  year: 'fiscalYear',
  budget_year: 'fiscalYear',
  category: 'category',
  budget_category: 'category',
  allocated: 'allocated',
  allocated_amount: 'allocated',
  amount: 'allocated',
  incurred: 'incurred',
  incurred_amount: 'incurred',
};

export type BudgetParseIssue = {
  row: number;
  message: string;
};

export type BudgetParseResult = {
  rows: BudgetImportInput[];
  issues: BudgetParseIssue[];
};

function canonicalHeader(raw: unknown): 'fiscalYear' | 'category' | 'allocated' | 'incurred' | null {
  if (typeof raw !== 'string') return null;
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ');
  return HEADER_ALIASES[key] ?? null;
}

function headerMap(entry: Record<string, unknown>): Map<string, string> {
  const map = new Map<string, string>();
  for (const key of Object.keys(entry)) {
    const canon = canonicalHeader(key);
    if (canon) map.set(canon, key);
  }
  return map;
}

function cell(entry: Record<string, unknown>, map: Map<string, string>, canon: string): unknown {
  const key = map.get(canon);
  return key === undefined ? undefined : entry[key];
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/,/g, ' ').trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toText(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

export async function parseBudgetFile(file: File): Promise<BudgetParseResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { rows: [], issues: [{ row: 1, message: 'No worksheet found in file' }] };

  const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
  });
  if (!raw.length) return { rows: [], issues: [{ row: 1, message: 'File has no data rows' }] };

  const map = headerMap(raw[0]);
  if (map.size < 3) {
    return {
      rows: [],
      issues: [
        { row: 1, message: 'Unrecognized header row — expect fiscalYear / category / allocated (optional incurred).' },
      ],
    };
  }

  const rows: BudgetImportInput[] = [];
  const issues: BudgetParseIssue[] = [];

  raw.forEach((entry, idx) => {
    const row = idx + 2;
    const yearVal = toNumber(cell(entry, map, 'fiscalYear'));
    const category = toText(cell(entry, map, 'category'));
    const allocated = toNumber(cell(entry, map, 'allocated'));
    const incurredVal = cell(entry, map, 'incurred');
    const hasIncurred = incurredVal !== undefined && incurredVal !== null;
    const incurred = hasIncurred ? toNumber(incurredVal) : null;

    if (yearVal === null || !Number.isInteger(yearVal) || yearVal < 2000 || yearVal > 2100) {
      issues.push({ row, message: `fiscalYear must be an integer 2000-2100 (got ${String(cell(entry, map, 'fiscalYear') ?? '')}).` });
      return;
    }
    if (!category || category.length > 120) {
      issues.push({ row, message: 'category is required (max 120 chars).' });
      return;
    }
    if (allocated === null || allocated < 0) {
      issues.push({ row, message: `allocated must be a non-negative number (got ${String(cell(entry, map, 'allocated') ?? '')}).` });
      return;
    }
    if (hasIncurred && (incurred === null || incurred < 0)) {
      issues.push({ row, message: `incurred must be a non-negative number (got ${String(incurredVal ?? '')}).` });
      return;
    }

    rows.push({ fiscalYear: yearVal, category, allocated, ...(incurred !== null ? { incurred } : {}) });
  });

  return issues.length ? { rows: [], issues } : { rows, issues: [] };
}

export function budgetCsv(rows: BudgetRow[]): string {
  const header = ['fiscalYear', 'category', 'allocated', 'incurred', 'paid', 'remaining'];
  const lines = rows.map((r) =>
    [r.fiscalYear, r.category, r.allocated, r.incurred, r.paid, r.remaining].join(','),
  );
  return [header.join(','), ...lines].join('\n');
}

export function downloadText(filename: string, text: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportBudgetWorkbook(rows: BudgetRow[]): void {
  const ws = XLSX.utils.json_to_sheet(
    rows.map((r) => ({
      fiscalYear: r.fiscalYear,
      category: r.category,
      allocated: r.allocated,
      incurred: r.incurred,
      paid: r.paid,
      remaining: r.remaining,
    })),
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Budget');
  XLSX.writeFile(wb, 'budget-summary.xlsx');
}

export function downloadBudgetTemplate(): void {
  const ws = XLSX.utils.json_to_sheet([
    { fiscalYear: 2026, category: 'IT Software', allocated: 500000, incurred: 120000 },
    { fiscalYear: 2026, category: 'Infrastructure', allocated: 800000, incurred: 0 },
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Budget import');
  XLSX.writeFile(wb, 'budget-import-template.xlsx');
  downloadText(
    'budget-import-template.csv',
    ['fiscalYear,category,allocated,incurred', '2026,IT Software,500000,120000'].join('\n'),
    'text/csv;charset=utf-8',
  );
}