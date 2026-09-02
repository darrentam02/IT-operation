import { Router, type IRouter } from "express";
import {
  ConfirmVendorPortalMilestoneBody,
  ConfirmVendorPortalMilestoneHeader,
  ConfirmVendorPortalMilestoneParams,
  ConfirmVendorPortalMilestoneResponse,
  GetVendorPortalSessionHeader,
  GetVendorPortalSessionResponse,
  SubmitVendorPortalInvoiceBody,
  SubmitVendorPortalInvoiceHeader,
  SubmitVendorPortalInvoiceParams,
  SubmitVendorPortalInvoiceResponse,
} from "@workspace/api-zod";
import {
  confirmVendorMilestone,
  loadVendorPortalPurchaseOrders,
  submitVendorInvoice,
} from "../lib/db-runtime";
import {
  resolveVendorPortalIdentity,
  type VendorPortalIdentity,
} from "../integrations/vendor";
import { logger } from "../lib/logger";

const router: IRouter = Router();

type PortalMilestone = {
  id: string;
  procurementId?: string;
  dueDate?: string;
  amount?: number;
  isMilestonePayment?: boolean;
  milestoneNumber?: number;
  milestoneDescription?: string;
  invoiceAmount?: number;
  invoiceNumber?: string;
  isVarianceDetected?: boolean;
  varianceType?: string;
  varianceAmount?: number;
  varianceResolutionNotes?: string;
  dualSignoffAt?: string;
  paidAt?: string;
  paidAmount?: number;
  paymentReference?: string;
  threeWayMatch?: string;
  confirmationStatus?: string;
  confirmationNote?: string;
  confirmedAt?: string;
};

type PortalOrder = {
  id: string;
  prNumber: string;
  poNumber: string;
  vendor: string;
  region: string;
  amount: number;
  currency: string;
  hkdAmount: number;
  status: string;
  match: string;
  createdAt: string;
  projectCode: string;
  paymentTerms: string;
  expectedSettlementMonth: string;
  milestones: PortalMilestone[];
};

const demoVendorPortalOrders: PortalOrder[] = [
  {
    id: "p-demo-001",
    prNumber: "PR-2026-0842",
    poNumber: "PO-2026-0611",
    vendor: "Nimbus Cloud Services",
    region: "HK",
    amount: 428000,
    currency: "HKD",
    hkdAmount: 428000,
    status: "Purchase Order Issued",
    match: "Matched",
    createdAt: "28 Aug 2026, 09:18",
    projectCode: "PROJ-CLOUD-2026-042",
    paymentTerms: "Milestone 3:7",
    expectedSettlementMonth: "2026-10",
    milestones: [
      {
        id: "m-demo-001",
        procurementId: "p-demo-001",
        dueDate: "2026-08-28",
        amount: 128400,
        isMilestonePayment: true,
        milestoneNumber: 1,
        milestoneDescription: "Cloud tenancy and security baseline",
        invoiceAmount: 128400,
        invoiceNumber: "INV-NCS-26081",
        isVarianceDetected: false,
        varianceType: "",
        varianceAmount: 0,
        varianceResolutionNotes: "",
        dualSignoffAt: "",
        paidAt: "2026-08-29",
        paidAmount: 128400,
        paymentReference: "PAY-2026-0841",
        threeWayMatch: "MATCHED",
        confirmationStatus: "CONFIRMED",
        confirmationNote: "Baseline controls delivered and accepted.",
        confirmedAt: "2026-08-28T09:20:00.000Z",
      },
      {
        id: "m-demo-002",
        procurementId: "p-demo-001",
        dueDate: "2026-10-15",
        amount: 299600,
        isMilestonePayment: true,
        milestoneNumber: 2,
        milestoneDescription: "Production migration and service handover",
        invoiceAmount: 0,
        invoiceNumber: "",
        isVarianceDetected: false,
        varianceType: "",
        varianceAmount: 0,
        varianceResolutionNotes: "",
        dualSignoffAt: "",
        paidAt: "",
        paidAmount: 0,
        paymentReference: "",
        threeWayMatch: "PENDING",
        confirmationStatus: "PENDING",
        confirmationNote: "",
        confirmedAt: "",
      },
    ],
  },
];

async function loadPortalOrders(identity: VendorPortalIdentity): Promise<PortalOrder[]> {
  if (identity.demoMode) return demoVendorPortalOrders;
  return (await loadVendorPortalPurchaseOrders(identity.id)) ?? [];
}

async function findVendorPortalOrder(
  identity: VendorPortalIdentity,
  purchaseOrderId: string,
): Promise<PortalOrder | null> {
  const orders = await loadPortalOrders(identity);
  return orders.find((item) => item.id === purchaseOrderId) ?? null;
}

async function findVendorPortalMilestone(
  identity: VendorPortalIdentity,
  milestoneId: string,
): Promise<{ order: PortalOrder; milestone: PortalMilestone } | null> {
  const orders = await loadPortalOrders(identity);
  for (const order of orders) {
    const milestone = order.milestones.find((item) => item.id === milestoneId);
    if (milestone) return { order, milestone };
  }
  return null;
}

router.get("/vendor/portal/session", async (req, res): Promise<void> => {
  const header = GetVendorPortalSessionHeader.safeParse({
    "X-Vendor-API-Key": req.header("X-Vendor-API-Key") ?? "",
  });
  const identity = header.success
    ? resolveVendorPortalIdentity(header.data["X-Vendor-API-Key"])
    : null;
  if (!identity) {
    res.status(401).json({ error: "The vendor API key is invalid", code: "INVALID_VENDOR_KEY" });
    return;
  }

  let purchaseOrders: PortalOrder[] | null;
  try {
    purchaseOrders = await loadPortalOrders(identity);
  } catch (error) {
    logger.error({ err: error, vendorId: identity.id }, "Vendor portal session query failed");
    res.status(503).json({
      error: "The vendor workspace is temporarily unavailable",
      code: "VENDOR_PORTAL_UNAVAILABLE",
    });
    return;
  }
  if (!purchaseOrders) {
    res.status(503).json({
      error: "The vendor workspace is temporarily unavailable",
      code: "VENDOR_PORTAL_UNAVAILABLE",
    });
    return;
  }
  res.json(GetVendorPortalSessionResponse.parse({
    vendor: {
      id: identity.id,
      name: identity.name,
      region: identity.region,
      contact: identity.contact,
    },
    purchaseOrders,
    demoMode: identity.demoMode,
  }));
});

router.post("/vendor/portal/purchase-orders/:id/invoices", async (req, res): Promise<void> => {
  const params = SubmitVendorPortalInvoiceParams.safeParse(req.params);
  const header = SubmitVendorPortalInvoiceHeader.safeParse({
    "X-Vendor-API-Key": req.header("X-Vendor-API-Key") ?? "",
  });
  const body = SubmitVendorPortalInvoiceBody.safeParse(req.body);
  const identity = header.success
    ? resolveVendorPortalIdentity(header.data["X-Vendor-API-Key"])
    : null;
  if (!identity) {
    res.status(401).json({ error: "The vendor API key is invalid", code: "INVALID_VENDOR_KEY" });
    return;
  }
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Enter a valid invoice number, date, and amount", code: "INVALID_INVOICE" });
    return;
  }

  let order: PortalOrder | null;
  try {
    order = await findVendorPortalOrder(identity, params.data.id);
  } catch (error) {
    logger.error({ err: error, vendorId: identity.id }, "Vendor portal invoice lookup failed");
    res.status(503).json({
      error: "The vendor workspace is temporarily unavailable",
      code: "VENDOR_PORTAL_UNAVAILABLE",
    });
    return;
  }
  if (!order) {
    res.status(403).json({ error: "This purchase order is outside your vendor account", code: "VENDOR_SCOPE" });
    return;
  }
  const milestone = order.milestones.find((item) => item.id === body.data.paymentScheduleId);
  if (!milestone) {
    res.status(403).json({ error: "This payment milestone is outside your vendor account", code: "VENDOR_SCOPE" });
    return;
  }
  if (milestone.paidAt || milestone.invoiceNumber) {
    res.status(409).json({ error: "An invoice has already been submitted for this milestone", code: "INVOICE_EXISTS" });
    return;
  }

  if (identity.demoMode) {
    milestone.invoiceAmount = body.data.invoiceAmount;
    milestone.invoiceNumber = body.data.invoiceNumber;
    milestone.isVarianceDetected = body.data.invoiceAmount !== milestone.amount;
    milestone.varianceType = milestone.isVarianceDetected ? "PRICE" : "";
    milestone.varianceAmount = milestone.isVarianceDetected
      ? Math.abs(body.data.invoiceAmount - (milestone.amount ?? 0))
      : 0;
    milestone.threeWayMatch = milestone.isVarianceDetected ? "PRICE_VARIANCE" : "MATCHED";
    res.json(SubmitVendorPortalInvoiceResponse.parse(milestone));
    return;
  }

  const updated = await submitVendorInvoice(
    milestone.id,
    order.id,
    body.data as unknown as Record<string, unknown>,
  );
  if (!updated) {
    res.status(409).json({ error: "This invoice could not be submitted", code: "INVOICE_REJECTED" });
    return;
  }
  res.json(SubmitVendorPortalInvoiceResponse.parse(updated));
});

router.patch("/vendor/portal/milestones/:id/confirm", async (req, res): Promise<void> => {
  const params = ConfirmVendorPortalMilestoneParams.safeParse(req.params);
  const header = ConfirmVendorPortalMilestoneHeader.safeParse({
    "X-Vendor-API-Key": req.header("X-Vendor-API-Key") ?? "",
  });
  const body = ConfirmVendorPortalMilestoneBody.safeParse(req.body ?? {});
  const identity = header.success
    ? resolveVendorPortalIdentity(header.data["X-Vendor-API-Key"])
    : null;
  if (!identity) {
    res.status(401).json({ error: "The vendor API key is invalid", code: "INVALID_VENDOR_KEY" });
    return;
  }
  if (!params.success || !body.success) {
    res.status(400).json({ error: "The milestone confirmation is invalid", code: "INVALID_MILESTONE" });
    return;
  }

  let scoped: { order: PortalOrder; milestone: PortalMilestone } | null;
  try {
    scoped = await findVendorPortalMilestone(identity, params.data.id);
  } catch (error) {
    logger.error({ err: error, vendorId: identity.id }, "Vendor portal milestone lookup failed");
    res.status(503).json({
      error: "The vendor workspace is temporarily unavailable",
      code: "VENDOR_PORTAL_UNAVAILABLE",
    });
    return;
  }
  if (!scoped) {
    res.status(403).json({ error: "This milestone is outside your vendor account", code: "VENDOR_SCOPE" });
    return;
  }
  if (!scoped.milestone.isMilestonePayment || scoped.milestone.confirmationStatus === "CONFIRMED") {
    res.status(409).json({ error: "This milestone cannot be confirmed", code: "MILESTONE_NOT_PENDING" });
    return;
  }

  if (identity.demoMode) {
    scoped.milestone.confirmationStatus = "CONFIRMED";
    scoped.milestone.confirmationNote = body.data.confirmationNote ?? "";
    scoped.milestone.confirmedAt = new Date().toISOString();
    res.json(ConfirmVendorPortalMilestoneResponse.parse(scoped.milestone));
    return;
  }

  const updated = await confirmVendorMilestone(
    scoped.milestone.id,
    body.data.confirmationNote,
  );
  if (!updated) {
    res.status(409).json({ error: "This milestone could not be confirmed", code: "MILESTONE_REJECTED" });
    return;
  }
  res.json(ConfirmVendorPortalMilestoneResponse.parse(updated));
});

export default router;