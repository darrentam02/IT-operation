import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import type { RuntimeBudgetRow } from "./db-runtime";

export type BudgetExportFormat = "csv" | "xlsx" | "pdf";

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


function buildPdf(rows: RuntimeBudgetRow[]): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).text("Budget Lines", { underline: true });
    doc.moveDown(0.4);
    doc.fontSize(9).text(`Generated ${new Date().toISOString().slice(0, 10)}`);
    doc.moveDown(0.6);
    doc.fontSize(9);
    const headers = ["Fiscal Year", "Category", "Description", "Allocated (HKD)"];
    const colX = [48, 120, 200, 300];
    const widths = colX.map((x, i) => (i < colX.length - 1 ? colX[i + 1] - x : 505 - x) - 4);
    doc.font("Helvetica-Bold");
    headers.forEach((h, i) => doc.text(h, colX[i], doc.y, { width: widths[i], lineBreak: false }));
    doc.moveDown(0.3);
    doc.font("Helvetica");
    if (rows.length === 0) {
      doc.text("No budget lines.");
    } else {
      for (const r of rows) {
        doc.text(String(r.fiscalYear), colX[0], doc.y, { width: widths[0], lineBreak: false });
        doc.text(String(r.category), colX[1], doc.y, { width: widths[1], lineBreak: false });
        doc.text(r.description ?? "", colX[2], doc.y, { width: widths[2], lineBreak: false });
        doc.text(Math.round(r.allocated).toLocaleString("en-HK"), colX[3], doc.y, { width: widths[3], lineBreak: false });
        doc.moveDown(0.2);
      }
    }
    doc.end();
  });
}


export async function buildBudgetExport(
  rows: RuntimeBudgetRow[],
  format: BudgetExportFormat,
): Promise<BudgetExportResult> {
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "pdf") {
    return {
      filename: `budget-lines-${stamp}.pdf`,
      contentType: "application/pdf",
      buffer: await buildPdf(rows),
    };
  }
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
