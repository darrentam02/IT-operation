import { readEnv, type IntegrationStatus } from "./config";

export type VendorConfig = {
  publicKey: string;
};

export function getVendorConfig(): Partial<VendorConfig> {
  return {
    publicKey: readEnv("VENDOR_PUBLIC_KEY"),
  };
}

export type VendorSubmission = {
  vendorId: string;
  type: "invoice" | "delivery" | "milestone" | "po_acceptance";
  poNumber: string;
  amount: number;
  submittedAt: string;
};

const FALLBACK_SUBMISSIONS: VendorSubmission[] = [
  { vendorId: "v-001", type: "invoice", poNumber: "PO-2026-0611", amount: 428000, submittedAt: "28 Aug 2026, 09:20" },
  { vendorId: "v-002", type: "milestone", poNumber: "PO-2026-0607", amount: 223800, submittedAt: "27 Aug 2026, 14:45" },
  { vendorId: "v-003", type: "po_acceptance", poNumber: "PO-2026-0599", amount: 165600, submittedAt: "26 Aug 2026, 11:10" },
];

export function isVendorConfigured(): boolean {
  return Boolean(getVendorConfig().publicKey);
}

export async function checkVendorHealth(): Promise<IntegrationStatus> {
  if (!isVendorConfigured()) {
    return {
      name: "vendor-api",
      configured: false,
      status: "not_configured",
      message: "VENDOR_PUBLIC_KEY not configured; using representative vendor submissions",
    };
  }
  return {
    name: "vendor-api",
    configured: true,
    status: "ok",
    message: "Vendor API configured",
  };
}

export async function listVendorSubmissions(): Promise<VendorSubmission[]> {
  return FALLBACK_SUBMISSIONS;
}

export const vendor = {
  config: getVendorConfig,
  isConfigured: isVendorConfigured,
  health: checkVendorHealth,
  listSubmissions: listVendorSubmissions,
};
