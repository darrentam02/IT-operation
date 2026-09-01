import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import {
  authenticateVendor,
  getVendorPortal,
  submitVendorInvoice,
  submitVendorDelivery,
  vendorAcceptPurchaseOrder,
  type VendorProfile,
} from "../lib/vendor-runtime";

const router: IRouter = Router();

function vendorAuth(req: Request, res: Response, next: NextFunction) {
  const key = req.header("x-vendor-api-key") || String(req.query.apiKey || "");
  if (!key) {
    res.status(401).json({ error: "Missing X-Vendor-Api-Key header" });
    return;
  }
  authenticateVendor(String(key)).then((vendor) => {
    if (!vendor) {
      res.status(401).json({ error: "Invalid or revoked vendor API key" });
      return;
    }
    res.locals.vendor = vendor as VendorProfile;
    next();
  });
}

// Simple OCR simulation for a base64 PDF: pulls likely invoice fields from the
// embedded text. Production would call a real OCR service.
function simulateOcr(pdfBase64: string): Record<string, unknown> {
  try {
    const text = Buffer.from(pdfBase64, "base64").toString("utf8");
    const pick = (re: RegExp): string | null => {
      const m = text.match(re);
      return m ? m[1].trim() : null;
    };
    return {
      invoiceNumber: pick(/Invoice\s*#?\s*[:#]?\s*([A-Z0-9\-]+)/i) ?? pick(/INV\s*[:#]?\s*([A-Z0-9\-]+)/i),
      invoiceAmount: pick(/Total\s*[:$]?\s*([0-9.,]+)/i) ?? pick(/Amount\s*[:$]?\s*([0-9.,]+)/i),
      invoiceDate: pick(/Date\s*[:]?\s*([0-9]{4}[-/][0-9]{2}[-/][0-9]{2})/i),
      vendor: pick(/Vendor\s*[:]?\s*([A-Za-z0-9 .]+)/i),
      currency: pick(/Currency\s*[:]?\s*([A-Z]{3})/i) ?? "HKD",
      source: "ocr",
    };
  } catch {
    return { source: "ocr", error: "unparsable" };
  }
}

router.get("/vendor/portal", vendorAuth, async (_req, res) => {
  const vendor = res.locals.vendor as VendorProfile;
  const portal = await getVendorPortal(vendor);
  if (!portal) {
    res.status(500).json({ error: "Failed to load vendor portal" });
    return;
  }
  res.json(portal);
});

router.post("/vendor/invoices", vendorAuth, async (req, res) => {
  const vendor = res.locals.vendor as VendorProfile;
  const body = (req.body ?? {}) as Record<string, unknown>;

  const input: Record<string, unknown> = { ...body };
  if (body.pdfBase64) {
    const ocr = simulateOcr(String(body.pdfBase64));
    input.ocrInvoiceData = ocr;
    if (!input.invoiceNumber && ocr.invoiceNumber) input.invoiceNumber = ocr.invoiceNumber;
    if (!input.invoiceAmount && ocr.invoiceAmount) input.invoiceAmount = Number(String(ocr.invoiceAmount).replace(/[^0-9.]/g, ""));
    if (!input.invoiceDate && ocr.invoiceDate) input.invoiceDate = String(ocr.invoiceDate).replace(/\//g, "-");
    if (!input.currency && ocr.currency) input.currency = String(ocr.currency);
  }

  const result = await submitVendorInvoice(vendor.id, input);
  if (!result.ok) {
    res.status(result.status ?? 500).json({ error: result.error, code: result.code });
    return;
  }
  res.json(result.data);
});

router.post("/vendor/deliveries", vendorAuth, async (req, res) => {
  const vendor = res.locals.vendor as VendorProfile;
  const result = await submitVendorDelivery(vendor.id, (req.body ?? {}) as Record<string, unknown>);
  if (!result.ok) {
    res.status(result.status ?? 500).json({ error: result.error, code: result.code });
    return;
  }
  res.json(result.data);
});

router.post("/vendor/po-acceptance", vendorAuth, async (req, res) => {
  const vendor = res.locals.vendor as VendorProfile;
  const result = await vendorAcceptPurchaseOrder(vendor.id, (req.body ?? {}) as Record<string, unknown>);
  if (!result.ok) {
    const body: Record<string, unknown> = { error: result.error, code: result.code };
    if ("detail" in result) body.detail = (result as Record<string, unknown>).detail;
    res.status(result.status ?? 500).json(body);
    return;
  }
  res.json(result.data);
});

export default router;
