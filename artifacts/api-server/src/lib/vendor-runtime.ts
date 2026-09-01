import { readEnv } from "../integrations/config";

// Vendor Self-Service data layer.
//
// The api-server connects via the Supabase *service role* which bypasses RLS, so
// vendor isolation is ENFORCED HERE (app layer): every query is scoped to the
// authenticated vendor's UUID and its rows are only reachable through joins on
// `procurement_records.vendor_id`. The migrations add RLS policies as
// defense-in-depth but the authoritative boundary is this module.

type DbPool = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

let poolPromise: Promise<DbPool | null> | null = null;
function isDbConfigured(): boolean {
  return Boolean(readEnv("DATABASE_URL"));
}
async function getPool(): Promise<DbPool | null> {
  if (!isDbConfigured()) return null;
  if (!poolPromise) {
    poolPromise = import("@workspace/db")
      .then((mod) => (mod.pool ?? null) as DbPool | null)
      .catch(() => null);
  }
  return poolPromise;
}

const str = (v: unknown): string => (v == null ? "" : String(v));
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

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
  status: string; // MATCHED / PRICE_VARIANCE / SHIPPING_TAX_VARIANCE / PENDING
  invoiceAmount: number;
  isVarianceDetected: boolean;
  varianceType: string;
  paidAt: string;
  deliveredAt: string;
};

export type VendorPortal = {
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

export type VendorResult =
  | { ok: true; data?: unknown }
  | { ok: false; error: string; code: string; status?: number; detail?: string };

// Authenticate a vendor by its dedicated API key (sha256-compare against hash).
export async function authenticateVendor(apiKey: string): Promise<VendorProfile | null> {
  const pool = await getPool();
  if (!pool || !apiKey) return null;
  try {
    // Hash the presented key to match how it was stored at seed time.
    const { rows } = await pool.query(
      `SELECT id::text AS id, vendor_name, region, contact, delivery_address, payment_terms, tax_id
         FROM vendors
        WHERE api_key_hash = encode(sha256($1::bytea), 'hex')
        LIMIT 1`,
      [apiKey],
    );
    if (!rows.length) return null;
    const r = rows[0];
    return {
      id: str(r.id),
      vendorName: str(r.vendor_name),
      region: str(r.region),
      contact: str(r.contact),
      deliveryAddress: str(r.delivery_address),
      paymentTerms: str(r.payment_terms),
      taxId: str(r.tax_id),
    };
  } catch {
    return null;
  }
}

const PO_SELECT = `
  SELECT pr.id::text AS id, pr.pr_number, pr.po_number, pr.region,
         pr.local_currency, pr.local_amount::float8 AS local_amount,
         pr.hkd_amount::float8 AS hkd_amount, pr.status,
         pr.payment_terms, pr.delivery_address,
         pr.po_accepted_at::text AS po_accepted_at, pr.po_acceptance_notes,
         pr.created_by::text AS created_by
    FROM procurement_records pr
   WHERE pr.vendor_id = $1::uuid`;

const MILESTONE_SELECT = `
  SELECT ps.id::text AS id, ps.procurement_id::text AS procurement_id,
         COALESCE(ps.milestone_number, 0)::int AS milestone_number,
         COALESCE(ps.milestone_description,'') AS milestone_description,
         ps.due_date::text AS due_date, ps.amount::float8 AS amount,
         ps.is_milestone_payment, ps.is_variance_detected, ps.variance_type,
         ps.invoice_amount::float8 AS invoice_amount, ps.paid_at::text AS paid_at,
         COALESCE(tw.status,'PENDING') AS match_status,
         d.delivered_at::text AS delivered_at
    FROM payment_schedules ps
    JOIN procurement_records pr ON pr.id = ps.procurement_id
    LEFT JOIN three_way_matches tw ON tw.payment_schedule_id = ps.id
    LEFT JOIN LATERAL (
      SELECT delivered_at FROM deliveries dd
       WHERE dd.payment_schedule_id = ps.id ORDER BY dd.created_at DESC LIMIT 1
    ) d ON true
   WHERE pr.vendor_id = $1::uuid`;

async function loadPortalRows(vendorId: string, pool: DbPool, profile: VendorProfile): Promise<VendorPortal | null> {
  try {
    const [posRes, mileRes, summaryRes] = await Promise.all([
      pool.query(`${PO_SELECT} ORDER BY pr.created_at DESC`, [vendorId]),
      pool.query(`${MILESTONE_SELECT} ORDER BY ps.due_date`, [vendorId]),
      pool.query(
        `SELECT
            COUNT(*)::int AS total_pos,
            COALESCE(SUM(pr.hkd_amount),0)::float8 AS total_hkd,
            COALESCE(SUM(ps.paid_amount),0)::float8 AS paid_hkd,
            COALESCE(SUM(CASE WHEN ps.paid_at IS NULL THEN COALESCE(ps.invoice_amount, ps.amount) ELSE 0 END),0)::float8 AS pending_hkd,
            COUNT(*) FILTER (WHERE pr.status = 'VARIANCE_BLOCKED')::int AS variance_blocked,
            COUNT(*) FILTER (WHERE pr.po_accepted_at IS NOT NULL)::int AS accepted_pos
           FROM procurement_records pr
           LEFT JOIN payment_schedules ps ON ps.procurement_id = pr.id
          WHERE pr.vendor_id = $1::uuid`,
        [vendorId],
      ),
    ]);

    const pos: VendorPo[] = posRes.rows.map((r) => ({
      id: str(r.id),
      prNumber: str(r.pr_number),
      poNumber: str(r.po_number),
      region: str(r.region),
      localCurrency: str(r.local_currency),
      localAmount: num(r.local_amount),
      hkdAmount: num(r.hkd_amount),
      status: str(r.status),
      paymentTerms: str(r.payment_terms),
      deliveryAddress: str(r.delivery_address),
      poAcceptedAt: str(r.po_accepted_at),
      poAcceptanceNotes: str(r.po_acceptance_notes),
      createdBy: str(r.created_by),
    }));

    const milestones: VendorMilestone[] = mileRes.rows.map((r) => ({
      id: str(r.id),
      procurementId: str(r.procurement_id),
      milestoneNumber: num(r.milestone_number),
      milestoneDescription: str(r.milestone_description),
      dueDate: str(r.due_date),
      amount: num(r.amount),
      isMilestonePayment: Boolean(r.is_milestone_payment),
      status: str(r.match_status),
      invoiceAmount: num(r.invoice_amount),
      isVarianceDetected: Boolean(r.is_variance_detected),
      varianceType: str(r.variance_type),
      paidAt: str(r.paid_at),
      deliveredAt: str(r.delivered_at),
    }));

    const s = summaryRes.rows[0] ?? {};
    return {
      profile,
      pos,
      milestones,
      summary: {
        totalPos: num(s.total_pos),
        totalHkd: num(s.total_hkd),
        paidHkd: num(s.paid_hkd),
        pendingHkd: num(s.pending_hkd),
        varianceBlocked: num(s.variance_blocked),
        acceptedPos: num(s.accepted_pos),
      },
    };
  } catch {
    return null;
  }
}

export async function getVendorPortal(profile: VendorProfile): Promise<VendorPortal | null> {
  const pool = await getPool();
  if (!pool) return null;
  return loadPortalRows(profile.id, pool, profile);
}

interface InvoicedSchedule {
  scheduleId: string;
  procurementId: string;
  matchStatus: string;
  isVarianceDetected: boolean;
  varianceType: string;
  paidAt: string;
}

// Submit an invoice against one of this vendor's milestones. Populates the
// schedule's invoice/OCR columns; the DB trigger `trg_three_way_match` runs the
// 3-way match (price tolerance 0%, shipping/tax +/-2%) and flags variance.
export async function submitVendorInvoice(
  vendorId: string,
  input: Record<string, unknown>,
): Promise<VendorResult> {
  const pool = await getPool();
  if (!pool) return { ok: false, error: "DB not configured", code: "DB_UNAVAILABLE" };
  const scheduleId = str(input.scheduleId);
  if (!scheduleId) return { ok: false, error: "scheduleId is required", code: "BAD_REQUEST", status: 400 };

  const invoiceAmount = num(input.invoiceAmount);
  const currency = str(input.currency || "HKD");

  try {
    // Ownership check: the schedule must belong to a PO of THIS vendor.
    const owner = await pool.query(
      `SELECT ps.id::text AS id, ps.procurement_id::text AS procurement_id,
              pr.status AS po_status
         FROM payment_schedules ps
         JOIN procurement_records pr ON pr.id = ps.procurement_id
        WHERE ps.id = $1::uuid AND pr.vendor_id = $2::uuid`,
      [scheduleId, vendorId],
    );
    if (!owner.rows.length) {
      return { ok: false, error: "Payment schedule not found for this vendor", code: "NOT_FOUND", status: 404 };
    }
    const procurementId = str(owner.rows[0].procurement_id);

    // Normalise to HKD before comparison (invoice amount is in local currency unless HKD).
    let normalizedAmount = invoiceAmount;
    if (currency !== "HKD") {
      const fx = await pool.query(
        `SELECT rate FROM fx_rates
          WHERE base_currency = $1 AND quote_currency = 'HKD'
          ORDER BY effective_at DESC LIMIT 1`,
        [currency],
      );
      const rate = num(fx.rows[0]?.rate);
      if (rate > 0) normalizedAmount = invoiceAmount * rate;
    }

    await pool.query(
      `UPDATE payment_schedules
          SET invoice_amount = $2, invoice_number = $3,
              invoice_date = COALESCE($4::date, NOW()),
              ocr_invoice_data = COALESCE($5::jsonb, ocr_invoice_data)
        WHERE id = $1::uuid`,
      [
        scheduleId,
        normalizedAmount,
        str(input.invoiceNumber),
        input.invoiceDate ? String(input.invoiceDate) : null,
        input.ocrInvoiceData ? JSON.stringify(input.ocrInvoiceData) : null,
      ],
    );

    // Read back the schedule + the three-way match produced by the trigger.
    const match = await pool.query(
      `SELECT tw.status AS match_status,
              tw.price_variance::float8 AS price_variance,
              COALESCE(tw.shipping_tax_variance,0)::float8 AS shipping_tax_variance,
              tw.invoice_amount::float8 AS invoice_amount,
              tw.po_amount::float8 AS po_amount,
              tw.matched_at::text, tw.notes
         FROM three_way_matches tw
        WHERE tw.payment_schedule_id = $1::uuid
        ORDER BY tw.created_at DESC LIMIT 1`,
      [scheduleId],
    );
    const schedule = await pool.query(
      `SELECT id::text, is_variance_detected, variance_type, paid_at::text
         FROM payment_schedules WHERE id = $1::uuid`,
      [scheduleId],
    );
    const s = schedule.rows[0] ?? {};
    const m = match.rows[0] ?? {};

    const matchStatus = str(m.match_status);
    const isVariance = matchStatus === "PRICE_VARIANCE" || matchStatus === "SHIPPING_TAX_VARIANCE";

    const result: InvoicedSchedule = {
      scheduleId,
      procurementId,
      matchStatus,
      isVarianceDetected: isVariance,
      varianceType: str(s.variance_type),
      paidAt: str(s.paid_at),
    };

    return {
      ok: true,
      data: {
        ...result,
        poAmount: num(m.po_amount),
        invoiceAmount: num(m.invoice_amount),
        priceVariance: num(m.price_variance),
        shippingTaxVariance: num(m.shipping_tax_variance),
        matchedAt: str(m.matched_at),
        notes: str(m.notes),
        normalizedAmount,
      },
    };
  } catch {
    return { ok: false, error: "Failed to record invoice", code: "DB_ERROR" };
  }
}

// Record a delivery confirmation against one of this vendor's milestones.
export async function submitVendorDelivery(
  vendorId: string,
  input: Record<string, unknown>,
): Promise<VendorResult> {
  const pool = await getPool();
  if (!pool) return { ok: false, error: "DB not configured", code: "DB_UNAVAILABLE" };
  const procurementId = str(input.procurementId);
  const scheduleId = str(input.scheduleId);
  if (!procurementId || !scheduleId) {
    return { ok: false, error: "procurementId and scheduleId are required", code: "BAD_REQUEST", status: 400 };
  }
  try {
    const owner = await pool.query(
      `SELECT ps.id::text AS id FROM payment_schedules ps
         JOIN procurement_records pr ON pr.id = ps.procurement_id
        WHERE ps.id = $1::uuid AND pr.vendor_id = $2::uuid AND pr.id = $3::uuid`,
      [scheduleId, vendorId, procurementId],
    );
    if (!owner.rows.length) {
      return { ok: false, error: "Milestone not found for this vendor", code: "NOT_FOUND", status: 404 };
    }

    await pool.query(
      `INSERT INTO deliveries (procurement_id, payment_schedule_id, vendor_id, delivered_at, qty, notes)
       VALUES ($1::uuid, $2::uuid, $3::uuid, COALESCE($4::timestamptz, NOW()), $5, $6)
       ON CONFLICT (procurement_id, payment_schedule_id) DO UPDATE
          SET delivered_at = COALESCE($4::timestamptz, NOW()),
              qty = $5, notes = $6`,
      [
        procurementId,
        scheduleId,
        vendorId,
        input.deliveredAt ? String(input.deliveredAt) : null,
        input.qty != null ? num(input.qty) : null,
        input.notes ? String(input.notes) : null,
      ],
    );

    // Advance procurement to MILESTONE_RECEIVED unless already further along.
    await pool.query(
      `UPDATE procurement_records
          SET status = 'MILESTONE_RECEIVED', updated_at = NOW()
        WHERE id = $1::uuid AND status IN ('PO_ISSUED','PR_APPROVED')`,
      [procurementId],
    );

    return { ok: true, data: { scheduleId, procurementId, received: true } };
  } catch {
    return { ok: false, error: "Failed to record delivery", code: "DB_ERROR" };
  }
}

// Accept (or dispute) an issued PO for this vendor.
export async function vendorAcceptPurchaseOrder(
  vendorId: string,
  input: Record<string, unknown>,
): Promise<VendorResult> {
  const pool = await getPool();
  if (!pool) return { ok: false, error: "DB not configured", code: "DB_UNAVAILABLE" };
  const procurementId = str(input.procurementId);
  const decision = str(input.decision); // 'accepted' | 'dispute'
  if (!procurementId || (decision !== "accepted" && decision !== "dispute")) {
    return { ok: false, error: "procurementId and decision (accepted|dispute) are required", code: "BAD_REQUEST", status: 400 };
  }
  try {
    const owner = await pool.query(
      `SELECT id::text FROM procurement_records
        WHERE id = $1::uuid AND vendor_id = $2::uuid`,
      [procurementId, vendorId],
    );
    if (!owner.rows.length) {
      return { ok: false, error: "Purchase order not found for this vendor", code: "NOT_FOUND", status: 404 };
    }
    await pool.query(
      `UPDATE procurement_records
          SET po_accepted_at = COALESCE(po_accepted_at, NOW()),
              po_acceptance_notes = $2::text
        WHERE id = $1::uuid`,
      [procurementId, input.notes ? String(input.notes) : null],
    );
    return { ok: true, data: { procurementId, decision } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: "Failed to record PO acceptance", code: "DB_ERROR", detail: msg };
  }
}