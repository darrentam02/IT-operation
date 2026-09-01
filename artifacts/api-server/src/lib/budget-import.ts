import ExcelJS from "exceljs";
import { getPool } from "./db-runtime";

export type BudgetImportRow = {
  fiscalYear: number;
  category: string;
  description?: string;
  allocated: number;
};

export type BudgetImportSummary = {
  total: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
};

const CATEGORIES = new Set(["HARDWARE", "SOFTWARE", "DATA", "SERVICES"]);

function parseCsvValue(field: string): string {
  const t = field.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1).replace(/""/g, '"');
  }
  return t;
}

function splitCsvRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function toNumber(value: unknown, field: string, errors: string[]): number {
  if (value == null || String(value).trim() === "") {
    errors.push(`${field} is empty`);
    return -1;
  }
  const n = Number(String(value).replace(/[,$\s]/g, "").replace(/\(([^)]+)\)/g, "-$1"));
  if (!Number.isFinite(n)) {
    errors.push(`${field} is not a number: "${value}"`);
    return -1;
  }
  return n;
}

function coerceCategory(value: unknown, errors: string[]): string {
  const s = String(value == null ? "" : value).trim().toUpperCase();
  if (!CATEGORIES.has(s)) {
    errors.push(`Invalid category "${s}" (expected HARDWARE, SOFTWARE, DATA or SERVICES)`);
    return "";
  }
  return s;
}

function coerceYear(value: unknown, errors: string[]): number {
  const n = toNumber(value, "Fiscal Year", errors);
  if (n > 0 && Number.isInteger(n)) return n;
  if (n > 0) errors.push(`Fiscal Year must be an integer: "${value}"`);
  return -1;
}

function parseCsvRows(lines: string[]): BudgetImportRow[] {
  const rows: BudgetImportRow[] = [];
  let start = 0;
  if (lines.length > 0) {
    const probe = splitCsvRow(lines[0].trim());
    const probeNum = Number(String(probe[0]).trim().replace(/[,$\s]/g, ""));
    if (Number.isNaN(probeNum)) start = 1;
  }
  for (let i = start; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cells = splitCsvRow(line);
    const errors: string[] = [];
    const year = coerceYear(cells[0], errors);
    const category = coerceCategory(cells[1], errors);
    const description = cells[2] ? parseCsvValue(cells[2]) : undefined;
    const allocated = toNumber(cells[3], "Allocated", errors);
    if (errors.length || year < 0 || !category || allocated < 0) {
      throw new Error(`Row ${i + 1}: ${errors.join("; ") || "invalid data"}`);
    }
    rows.push({ fiscalYear: year, category, description: description || undefined, allocated });
  }
  return rows;
}

async function parseXlsx(buffer: Buffer): Promise<BudgetImportRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("Spreadsheet has no worksheet");
  const rows: BudgetImportRow[] = [];
  let rowNum = 1;
  ws.eachRow((row, rowNumber) => {
    rowNum = rowNumber;
    if (rowNumber === 1) return;
    const values = row.values as unknown[];
    values.shift();
    const errors: string[] = [];
    const year = coerceYear(values[0], errors);
    const category = coerceCategory(values[1], errors);
    const description = values[2] == null || String(values[2]).trim() === "" ? undefined : String(values[2]);
    const allocated = toNumber(values[3], "Allocated", errors);
    if (errors.length || year < 0 || !category || allocated < 0) {
      throw new Error(`Row ${rowNumber}: ${errors.join("; ") || "invalid data"}`);
    }
    rows.push({ fiscalYear: year, category, description, allocated });
  });
  return rows;
}

export async function parseBudgetImport(
  originalname: string,
  buffer: Buffer,
): Promise<{ rows: BudgetImportRow[]; errors: string[] }> {
  const name = (originalname || "").toLowerCase();
  try {
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      const rows = await parseXlsx(buffer);
      return { rows, errors: [] };
    }
    if (name.endsWith(".csv")) {
      const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
      const rows = parseCsvRows(text.split(/\r?\n/));
      return { rows, errors: [] };
    }
    return { rows: [], errors: ["Unsupported file format. Upload a .csv, .xlsx or .xls file."] };
  } catch (error) {
    return {
      rows: [],
      errors: [error instanceof Error ? error.message : "Failed to parse file"],
    };
  }
}

export async function upsertBudgetLines(
  rows: BudgetImportRow[],
  createdBy?: string,
): Promise<BudgetImportSummary> {
  const pool = await getPool();
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];
  if (!pool) {
    return { total: rows.length, inserted, updated, skipped, errors: ["DB not configured; import skipped"] };
  }
  try {
    for (const row of rows) {
      let res;
      try {
        res = await pool.query(
          `INSERT INTO budget_lines (fiscal_year, category, description, allocated_amount, created_by, updated_at)
           VALUES ($1::int, $2, $3, $4::numeric, $5::uuid, NOW())
           ON CONFLICT (fiscal_year, category) DO UPDATE
             SET description = EXCLUDED.description,
                 allocated_amount = EXCLUDED.allocated_amount,
                 updated_at = NOW()
           RETURNING xmax = 0 AS created`,
          [row.fiscalYear, row.category, row.description ?? null, row.allocated.toFixed(2), createdBy ?? null],
        );
      } catch (e) {
        errors.push(`${row.fiscalYear}/${row.category}: ${e instanceof Error ? e.message : "insert failed"}`);
        skipped++;
        continue;
      }
      const created = Boolean(res && res.rows && res.rows[0] && Number(res.rows[0].created));
      if (created) {
        inserted++;
      } else {
        updated++;
      }
    }
    return { total: rows.length, inserted, updated, skipped, errors };
  } catch (error) {
    return {
      total: rows.length,
      inserted,
      updated,
      skipped,
      errors: [error instanceof Error ? error.message : "Upsert failed"],
    };
  }
}
