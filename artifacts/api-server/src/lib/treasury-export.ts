import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import type {
  RuntimeTreasuryAnalytics,
  RuntimeTreasuryLedgerRow,
} from "./db-runtime";

export type TreasuryExportFormat = "csv" | "xlsx" | "pdf";

export type TreasuryExportResult = {
  filename: string;
  contentType: string;
  buffer: Buffer;
};

const money = (v: number): string =>
  new Intl.NumberFormat("en-HK", {
    style: "currency",
    currency: "HKD",
    maximumFractionDigits: 0,
  }).format(v);

function csvEscape(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildCsv(
  analytics: RuntimeTreasuryAnalytics,
  ledger: RuntimeTreasuryLedgerRow[],
): string {
  const lines: string[] = [];
  lines.push("TREASURY ANALYTICS");
  lines.push(["Metric", "Value"].join(","));
  lines.push(["Total YTD (HKD)", csvEscape(money(analytics.totalYtd))].join(","));
  lines.push(["Variance rate (%)", csvEscape(analytics.varianceRate)].join(","));
  lines.push("");
  lines.push("MONTHLY PAYMENTS (HKD)");
  lines.push(["Month", "Committed", "Paid"].join(","));
  for (const m of analytics.monthlyPayments) {
    lines.push([m.month, csvEscape(money(m.committed)), csvEscape(money(m.paid))].join(","));
  }
  lines.push("");
  lines.push("BUSINESS UNIT ALLOCATION (HKD)");
  lines.push(["Business unit", "Allocated"].join(","));
  for (const u of analytics.businessUnits) {
    lines.push([csvEscape(u.name), csvEscape(money(u.value))].join(","));
  }
  lines.push("");
  lines.push("FX REFERENCE RATES");
  lines.push(["Pair", "Rate", "Delta (%)"].join(","));
  for (const f of analytics.fxRates) {
    lines.push([csvEscape(f.currency), csvEscape(f.rate), csvEscape(f.delta.toFixed(2))].join(","));
  }
  lines.push("");
  lines.push("PAYMENT LEDGER");
  lines.push(["PR", "Vendor", "Project", "Due", "Amount (HKD)", "Paid (HKD)", "Variance", "Status"].join(","));
  for (const r of ledger) {
    lines.push([
      csvEscape(r.prNumber),
      csvEscape(r.vendor),
      csvEscape(r.projectCode),
      csvEscape(r.dueDate),
      csvEscape(r.amount),
      csvEscape(r.paidAmount),
      csvEscape(r.varianceDetected ? "Yes" : "No"),
      csvEscape(r.status),
    ].join(","));
  }
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

async function buildXlsx(
  analytics: RuntimeTreasuryAnalytics,
  ledger: RuntimeTreasuryLedgerRow[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "IT Operations Control Tower";
  wb.created = new Date();

  const summary = wb.addWorksheet("Summary");
  summary.addRow(["TREASURY ANALYTICS"]);
  summary.addRow(["Total YTD", money(analytics.totalYtd)]);
  summary.addRow(["Variance rate", `${analytics.varianceRate}%`]);
  summary.getColumn(2).width = 22;

  const monthly = wb.addWorksheet("Monthly Payments");
  monthly.addRow(["Month", "Committed (HKD)", "Paid (HKD)"]);
  monthly.getRow(1).font = { bold: true };
  for (const m of analytics.monthlyPayments) {
    monthly.addRow([m.month, Math.round(m.committed), Math.round(m.paid)]);
  }
  monthly.getColumn(2).numFmt = "#,##0";
  monthly.getColumn(3).numFmt = "#,##0";

  const units = wb.addWorksheet("Business Units");
  units.addRow(["Business unit", "Allocated (HKD)"]);
  units.getRow(1).font = { bold: true };
  for (const u of analytics.businessUnits) {
    units.addRow([u.name, Math.round(u.value)]);
  }
  units.getColumn(2).numFmt = "#,##0";

  const fx = wb.addWorksheet("FX Rates");
  fx.addRow(["Pair", "Rate", "Delta (%)"]);
  fx.getRow(1).font = { bold: true };
  for (const f of analytics.fxRates) {
    fx.addRow([f.currency, f.rate, f.delta]);
  }

  const rows = wb.addWorksheet("Payment Ledger");
  rows.addRow(["PR", "Vendor", "Project", "Due", "Amount (HKD)", "Paid (HKD)", "Variance", "Status"]);
  rows.getRow(1).font = { bold: true };
  for (const r of ledger) {
    rows.addRow([r.prNumber, r.vendor, r.projectCode, r.dueDate, r.amount, r.paidAmount, r.varianceDetected ? "Yes" : "No", r.status]);
  }
  rows.getColumn(5).numFmt = "#,##0";
  rows.getColumn(6).numFmt = "#,##0";

  const data = await wb.xlsx.writeBuffer();
  return Buffer.from(data as ArrayBuffer);
}

function buildPdf(
  analytics: RuntimeTreasuryAnalytics,
  ledger: RuntimeTreasuryLedgerRow[],
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).text("Treasury Analytics", { underline: true });
    doc.moveDown(0.4);
    doc.fontSize(11).text(`Total YTD (HKD): ${money(analytics.totalYtd)}`);
    doc.text(`Variance rate: ${analytics.varianceRate}%`);
    doc.moveDown(0.6);

    doc.fontSize(13).text("Monthly payments (HKD)", { underline: true });
    doc.moveDown(0.2);
    for (const m of analytics.monthlyPayments) {
      doc.fontSize(10).text(`${m.month}  committed ${money(m.committed)}  paid ${money(m.paid)}`);
    }
    doc.moveDown(0.6);

    doc.fontSize(13).text("Business unit allocation (HKD)", { underline: true });
    doc.moveDown(0.2);
    for (const u of analytics.businessUnits) {
      doc.fontSize(10).text(`${u.name}: ${money(u.value)}`);
    }
    doc.moveDown(0.6);

    doc.fontSize(13).text("FX reference rates (base HKD)", { underline: true });
    doc.moveDown(0.2);
    for (const f of analytics.fxRates) {
      doc.fontSize(10).text(`${f.currency}  ${f.rate.toFixed(4)}  (${f.delta >= 0 ? "+" : ""}${f.delta.toFixed(2)}%)`);
    }

    doc.addPage();
    doc.fontSize(13).text("Payment ledger", { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(8);
    if (ledger.length === 0) {
      doc.text("No payment records.");
    } else {
      const headers = ["PR", "Vendor", "Project", "Due", "Amount", "Paid", "Variance", "Status"];
      const colX = [48, 110, 210, 290, 330, 390, 450, 505];
      const widths = colX.map((x, i) => (i < colX.length - 1 ? colX[i + 1] - x : 0) - 4);
      doc.font("Helvetica-Bold");
      headers.forEach((h, i) => doc.text(h, colX[i], doc.y, { width: widths[i], lineBreak: false }));
      doc.moveDown(0.2);
      doc.font("Helvetica");
      for (const r of ledger) {
        doc.text(r.prNumber, colX[0], doc.y, { width: widths[0], lineBreak: false });
        doc.text(r.vendor, colX[1], doc.y, { width: widths[1], lineBreak: false });
        doc.text(r.projectCode, colX[2], doc.y, { width: widths[2], lineBreak: false });
        doc.text(r.dueDate, colX[3], doc.y, { width: widths[3], lineBreak: false });
        doc.text(money(r.amount), colX[4], doc.y, { width: widths[4], lineBreak: false });
        doc.text(money(r.paidAmount), colX[5], doc.y, { width: widths[5], lineBreak: false });
        doc.text(r.varianceDetected ? "Yes" : "No", colX[6], doc.y, { width: widths[6], lineBreak: false });
        doc.text(r.status, colX[7], doc.y, { width: widths[7], lineBreak: false });
        doc.moveDown(0.2);
      }
    }

    doc.end();
  });
}

export async function buildTreasuryExport(
  analytics: RuntimeTreasuryAnalytics,
  ledger: RuntimeTreasuryLedgerRow[],
  format: TreasuryExportFormat,
): Promise<TreasuryExportResult> {
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "csv") {
    return {
      filename: `treasury-analytics-${stamp}.csv`,
      contentType: "text/csv",
      buffer: Buffer.from(buildCsv(analytics, ledger), "utf8"),
    };
  }
  if (format === "xlsx") {
    return {
      filename: `treasury-analytics-${stamp}.xlsx`,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: await buildXlsx(analytics, ledger),
    };
  }
  return {
    filename: `treasury-analytics-${stamp}.pdf`,
    contentType: "application/pdf",
    buffer: await buildPdf(analytics, ledger),
  };
}