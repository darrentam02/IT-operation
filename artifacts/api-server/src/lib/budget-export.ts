import ExcelJS from "exceljs";
import type { RuntimeBudgetRow } from "./db-runtime";

export type BudgetExportFormat = "csv" | "xlsx";

export type BudgetExportResult = {
  filename: string;
  contentType: string;
  buffer: Buffer;
};

function csvEscape(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildCsv(rows: RuntimeBudgetRow[]): string {
  const lines: string[] = [];
  lines.push(["Fiscal Year", "Category", "Description", "Allocated (HKD)"].join(","));
  for (const r of rows) {
    lines.push([
      csvEscape(r.fiscalYear),
      csvEscape(r.category),
      csvEscape(r.description),
      csvEscape(r.allocated),
    ].join(","));
  }
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

async function buildXlsx(rows: RuntimeBudgetRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "IT Operations Control Tower";
  wb.created = new Date();

  const sheet = wb.addWorksheet("Budget Lines");
  sheet.addRow(["Fiscal Year", "Category", "Description", "Allocated (HKD)"]);
  sheet.getRow(1).font = { bold: true };
  for (const r of rows) {
    sheet.addRow([r.fiscalYear, r.category, r.description ?? "", Math.round(r.allocated)]);
  }
  sheet.getColumn(4).numFmt = "#,##0";
  sheet.getColumn(1).width = 12;
  sheet.getColumn(2).width = 14;
  sheet.getColumn(3).width = 30;
  sheet.getColumn(4).width = 18;

  const data = await wb.xlsx.writeBuffer();
  return Buffer.from(data as ArrayBuffer);
}

export async function buildBudgetExport(
  rows: RuntimeBudgetRow[],
  format: BudgetExportFormat,
): Promise<BudgetExportResult> {
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "xlsx") {
    return {
      filename: `budget-lines-${stamp}.xlsx`,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: await buildXlsx(rows),
    };
  }
  return {
    filename: `budget-lines-${stamp}.csv`,
    contentType: "text/csv",
    buffer: Buffer.from(buildCsv(rows), "utf8"),
  };
}
