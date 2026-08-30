// Vendor Self-Service client. Talks to the LIVE api-server vendor endpoints
// (`/api/vendor/*`) using the vendor's dedicated `X-Vendor-Api-Key`.
export const VENDOR_API_BASE_URL = import.meta.env.VITE_VENDOR_API_BASE_URL || 'https://it-operations-control-tower.replit.app';
export const DEMO_VENDOR_KEYS: Record<string, string> = {
  'Cerebrum Cloud Pte Ltd': 'vk_demo_cerebrum',
  'NexaNet HK Limited': 'vk_demo_nexanet',
  'Greenline Data Services': 'vk_demo_greenline',
  'Meridian Hardware Distrib': 'vk_demo_meridian',
  'Skybridge Security Pte Ltd': 'vk_demo_skybridge',
  'PacificWorks Telecom': 'vk_demo_pacificworks',
};

export class VendorApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type VendorProfile = {
  id: string;
  vendorName: string;
  region: string;
  contact: string;
  deliveryAddress: string;
  paymentTerms: string;
  taxId: string;
};

export type VendorPo = {
  id: string;
  prNumber: string;
  poNumber: string;
  region: string;
  localCurrency: string;
  localAmount: number;
  hkdAmount: number;
  status: string;
  paymentTerms: string;
  deliveryAddress: string;
  poAcceptedAt: string;
  poAcceptanceNotes: string;
  createdBy: string;
};

export type VendorMilestone = {
  id: string;
  procurementId: string;
  milestoneNumber: number;
  milestoneDescription: string;
  dueDate: string;
  amount: number;
  isMilestonePayment: boolean;
  status: string;
  invoiceAmount: number;
  isVarianceDetected: boolean;
  varianceType: string;
  paidAt: string;
  deliveredAt: string;
};

export type VendorPortalData = {
  profile: VendorProfile;
  pos: VendorPo[];
  milestones: VendorMilestone[];
  summary: {
    totalPos: number;
    totalHkd: number;
    paidHkd: number;
    pendingHkd: number;
    varianceBlocked: number;
    acceptedPos: number;
  };
};

export type InvoiceResult = {
  scheduleId: string;
  procurementId: string;
  matchStatus: string;
  isVarianceDetected: boolean;
  varianceType: string;
  paidAt: string;
  poAmount: number;
  invoiceAmount: number;
  priceVariance: number;
  shippingTaxVariance: number;
  matchedAt: string;
  notes: string;
};

export type DeliveryResult = {
  scheduleId: string;
  procurementId: string;
  received: boolean;
};

export type PoAcceptanceResult = {
  procurementId: string;
  decision: string;
};

async function request<T>(path: string, apiKey: string, init?: RequestInit): Promise<T> {
  const url = `${VENDOR_API_BASE_URL}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-Vendor-Api-Key': apiKey,
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new VendorApiError('Vendor service unreachable', 0, 'NETWORK');
  }
  if (!res.ok) {
    let message = `Vendor request failed (${res.status})`;
    let code: string | undefined;
    try {
      const body = await res.json();
      if (body?.error) message = String(body.error);
      if (body?.code) code = String(body.code);
    } catch {
      /* ignore */
    }
    throw new VendorApiError(message, res.status, code);
  }
  return (await res.json()) as T;
}

export function createVendorClient(apiKey: string) {
  const get = <T,>(path: string) => request<T>(path, apiKey);
  const post = <T,>(path: string, body: unknown) =>
    request<T>(path, apiKey, { method: 'POST', body: JSON.stringify(body) });

  return {
    portal: () => get<VendorPortalData>('/api/vendor/portal'),
    submitInvoice: (payload: Record<string, unknown>) =>
      post<InvoiceResult>('/api/vendor/invoices', payload),
    recordDelivery: (payload: { procurementId: string; scheduleId: string; deliveredAt?: string; qty?: number; notes?: string }) =>
      post<DeliveryResult>('/api/vendor/deliveries', payload),
    acceptPo: (payload: { procurementId: string; decision: 'accepted' | 'dispute'; notes?: string }) =>
      post<PoAcceptanceResult>('/api/vendor/po-acceptance', payload),
  };
}

export type VendorClient = ReturnType<typeof createVendorClient>;
