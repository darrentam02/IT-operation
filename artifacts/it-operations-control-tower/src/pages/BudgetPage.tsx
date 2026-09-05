import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  CircleDollarSign,
  Download,
  FileDown,
  FileSpreadsheet,
  RefreshCw,
  Upload,
} from 'lucide-react';
import { useBudgetImport, useBudgetSummary, type BudgetRow } from '@/hooks/use-budget';
import { useRealtimeInvalidate } from '@/hooks/use-realtime';
import {
  budgetCsv,
  downloadBudgetTemplate,
  downloadText,
  exportBudgetWorkbook,
  parseBudgetFile,
  type BudgetParseIssue,
} from '@/lib/budget-parse';

const CURRENCY = new Intl.NumberFormat('en-HK', { style: 'currency', currency: 'HKD', maximumFractionDigits: 0 });

function formatHkd(v: number): string {
  return CURRENCY.format(v);
}

function BudgetTable({ rows }: { rows: BudgetRow[] }) {
  if (!rows.length) {
    return (
      <div className="panel" data-testid="budget-empty">
        <CircleDollarSign size={28} />
        <span className="eyebrow">Budget ledger</span>
        <h2>No budget lines yet.</h2>
        <p>Import a CSV/XLSX (or download the template) to start allocating budget lines.</p>
      </div>
    );
  }
  return (
    <Table data-testid="budget-table">
      <TableHeader>
        <TableRow>
          <TableHead>Fiscal year</TableHead>
          <TableHead>Category</TableHead>
          <TableHead className="text-right">Allocated</TableHead>
          <TableHead className="text-right">Incurred</TableHead>
          <TableHead className="text-right">Paid</TableHead>
          <TableHead className="text-right">Remaining</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => {
          const pct = r.allocated > 0 ? Math.max(0, Math.min(100, Math.round((r.incurred / r.allocated) * 100))) : 0;
          return (
            <TableRow key={`${r.fiscalYear}-${r.category}`} data-testid="budget-row">
              <TableCell><Badge variant="secondary">{r.fiscalYear}</Badge></TableCell>
              <TableCell className="font-medium">{r.category}</TableCell>
              <TableCell className="text-right tabular-nums">{formatHkd(r.allocated)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatHkd(r.incurred)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatHkd(r.paid)}</TableCell>
              <TableCell className="text-right tabular-nums">
                <span className={r.remaining < 0 ? 'text-destructive' : undefined}>{formatHkd(r.remaining)}</span>
                <span className="block text-xs text-muted-foreground">{pct}% utilized</span>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export function BudgetPage() {
  const [year, setYear] = useState<string>('all');
  useRealtimeInvalidate('budget_lines', [['budget', 'summary']]);
  const [issues, setIssues] = useState<BudgetParseIssue[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const summary = useBudgetSummary(year !== 'all' ? Number(year) : undefined);
  const importMutation = useBudgetImport();

  const years = useMemo(() => {
    const set = new Set<number>();
    for (const r of summary.data ?? []) set.add(r.fiscalYear);
    return [...set].sort((a, b) => b - a);
  }, [summary.data]);

  async function onFilePicked(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const parsed = await parseBudgetFile(file);
    if (parsed.issues.length) {
      setIssues(parsed.issues.slice(0, 5));
      toast.error(`Import rejected — ${parsed.issues.length} row problem(s)`);
      return;
    }
    setIssues([]);
    importMutation.mutate(parsed.rows, {
      onSuccess: (res) => {
        toast.success(`Imported ${res.imported} new / ${res.updated} updated line(s) for FY ${res.years.join(', ')}`);
      },
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : 'Budget import failed', {
          duration: 8000,
        }),
    });
  }

  const rows = summary.data ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Budget ledger</CardTitle>
            <CardDescription>
              Allocation-only import: paid amounts stay owned by the payments pipeline.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger className="w-40" aria-label="Fiscal year filter">
                <SelectValue placeholder="Filter by year" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All years</SelectItem>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={() => summary.refetch()} aria-label="Refresh">
              {summary.isFetching ? <RefreshCw size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => fileRef.current?.click()} disabled={importMutation.isPending}>
              <Upload size={16} className="mr-2" />
              {importMutation.isPending ? 'Importing…' : 'Import CSV / XLSX'}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              data-testid="budget-file-input"
              onChange={onFilePicked}
            />
            <Button variant="outline" onClick={downloadBudgetTemplate}>
              <FileDown size={16} className="mr-2" />
              Template
            </Button>
            <Button
              variant="outline"
              onClick={() => rows.length && downloadText(`budget-summary${year !== 'all' ? `-${year}` : ''}.csv`, budgetCsv(rows), 'text/csv;charset=utf-8')}
              disabled={!rows.length}
            >
              <FileDown size={16} className="mr-2" />
              Export CSV
            </Button>
            <Button variant="outline" onClick={() => rows.length && exportBudgetWorkbook(rows)} disabled={!rows.length}>
              <FileSpreadsheet size={16} className="mr-2" />
              Export XLSX
            </Button>
            {issues.length ? (
              <Badge variant="destructive" className="ml-auto" data-testid="budget-issues">
                {issues.length} problem(s)
              </Badge>
            ) : null}
          </div>

          {issues.length ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm" data-testid="budget-issue-list">
              <p className="mb-1 font-medium text-destructive">Fix these rows, then re-import:</p>
              <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                {issues.map((iss) => (
                  <li key={`${iss.row}-${iss.message}`}>Row {iss.row}: {iss.message}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {summary.isLoading ? (
            <div className="panel" data-testid="budget-loading">Loading budget…</div>
          ) : (
            <BudgetTable rows={rows} />
          )}
        </CardContent>
      </Card>
      <p className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
        <Download size={12} /> Headers: fiscalYear, category, allocated, incurred (optional). One row per category per fiscal year; re-importing refreshes allocations idempotently.
      </p>
    </div>
  );
}

export default BudgetPage;