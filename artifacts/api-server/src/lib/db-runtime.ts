import { readEnv } from "../integrations/config";

// Runtime PostgreSQL data access for the live Supabase database.
//
// The pool is loaded lazily (dynamic import) so the server never crashes at
// startup when DATABASE_URL is missing (e.g. a deployment without a DB).
// Every query is guarded and falls back to `null` so callers can degrade to
// representative data instead of breaking the endpoint.

type DbPool = {
  query: (
    text: string,
    params?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[] }>;
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

// ---------------------------------------------------------------------
// Staff (profiles + teams + staff_statuses)
// ---------------------------------------------------------------------
export type RuntimeStaffMember = {
  id: string;
  name: string;
  initials: string;
  role: string;
  team: string;
  region: string;
  status: string;
  ticket: string;
  environment: string;
  eta: string;
  updatedAt: string;
  isStale: boolean;
};

export async function loadStaff(): Promise<RuntimeStaffMember[] | null> {
  const pool = await getPool();
  if (!pool) return null;
  try {
    const { rows } = await pool.query(
      `SELECT
         p.id::text AS id,
         p.full_name AS name,
         p.role AS role,
         COALESCE(t.team_name, 'Unassigned') AS team,
         p.region AS region,
         COALESCE(ss.status_text, 'Active') AS status,
         COALESCE(ss.active_ticket_id, 'N/A') AS ticket,
         COALESCE(ss.environment, 'SIT') AS environment,
         COALESCE(to_char(ss.eta_completion, 'HH24:MI'), 'N/A') AS eta,
         COALESCE(to_char(ss.updated_at, 'HH24:MI'), to_char(p.created_at, 'HH24:MI')) AS updated,
         COALESCE(ss.is_stale, false) AS is_stale
       FROM profiles p
       LEFT JOIN teams t ON t.id = p.team_id
       LEFT JOIN staff_statuses ss ON ss.user_id = p.id
       ORDER BY p.full_name`,
    );
    return rows.map((row) => {
      const name = str(row.name);
      const parts = name.trim().split(/\s+/).filter(Boolean);
      const initials =
        (parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[1]?.[0] ?? "") : "");
      return {
        id: str(row.id),
        name,
        initials: initials.toUpperCase(),
        role: str(row.role),
        team: str(row.team),
        region: str(row.region),
        status: str(row.status),
        ticket: str(row.ticket),
        environment: str(row.environment),
        eta: str(row.eta),
        updatedAt: str(row.updated).length ? `${str(row.updated)} today` : "—",
        isStale: Boolean(row.is_stale),
      };
    });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// Procurement (procurement_records + vendors)
// ---------------------------------------------------------------------
const STATUS_LABEL: Record<string, string> = {
  PR_DRAFT: "Pending L1 Approval",
  PR_APPROVED: "Pending L2 Approval",
  PO_ISSUED: "Pending L3 Approval",
  MILESTONE_RECEIVED: "Milestone Received",
  INVOICE_PENDING: "Payment Pending",
  VARIANCE_BLOCKED: "Variance Blocked",
  PAYMENT_APPROVED: "Payment Approved",
  PAID: "Paid",
};

function isPendingStatus(label: string): boolean {
  return label.includes("Pending");
}

export type RuntimeProcurementRecord = {
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
};

export async function loadProcurement(): Promise<RuntimeProcurementRecord[] | null> {
  const pool = await getPool();
  if (!pool) return null;
  try {
    const { rows } = await pool.query(
      `SELECT
         pr.id::text AS id,
         pr.pr_number AS pr_number,
         COALESCE(pr.po_number, '') AS po_number,
         v.vendor_name AS vendor,
         pr.region AS region,
         pr.local_amount::float8 AS amount,
         pr.local_currency AS currency,
         pr.hkd_amount::float8 AS hkd_amount,
         pr.status AS status,
         to_char(pr.created_at, 'DD Mon YYYY, HH24:MI') AS created_at
       FROM procurement_records pr
       LEFT JOIN vendors v ON v.id = pr.vendor_id
       ORDER BY pr.created_at DESC`,
    );
    return rows.map((row) => {
      const statusKey = str(row.status) || "PR_DRAFT";
      const label = STATUS_LABEL[statusKey] ?? statusKey;
      return {
        id: str(row.id),
        prNumber: str(row.pr_number),
        poNumber: str(row.po_number),
        vendor: str(row.vendor),
        region: str(row.region),
        amount: num(row.amount),
        currency: str(row.currency),
        hkdAmount: num(row.hkd_amount),
        status: label,
        match: statusKey === "VARIANCE_BLOCKED" ? "Variance" : "Matched",
        createdAt: str(row.created_at),
      };
    });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// Dashboard summary
// ---------------------------------------------------------------------
export type RuntimeDashboardSummary = {
  activeStaff: number;
  staleStaff: number;
  pendingApprovals: number;
  blockedVariances: number;
};

export async function loadDashboardStats(): Promise<RuntimeDashboardSummary | null> {
  const pool = await getPool();
  if (!pool) return null;
  try {
    const { rows } = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM profiles) AS active_staff,
         (SELECT count(*)::int FROM staff_statuses WHERE is_stale) AS stale_staff,
         (SELECT count(*)::int FROM procurement_records
           WHERE status IN ('PR_DRAFT','PR_APPROVED','PO_ISSUED','MILESTONE_RECEIVED','INVOICE_PENDING')) AS pending_approvals,
         (SELECT count(*)::int FROM procurement_records WHERE status = 'VARIANCE_BLOCKED') AS blocked_variances`,
    );
    const row = rows[0] ?? {};
    return {
      activeStaff: num(row.active_staff),
      staleStaff: num(row.stale_staff),
      pendingApprovals: num(row.pending_approvals),
      blockedVariances: num(row.blocked_variances),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// Mutations (best-effort; fall back through callers)
// ---------------------------------------------------------------------
export async function updateStaffStatus(
  userId: string,
  statusText: string,
): Promise<boolean> {
  const pool = await getPool();
  if (!pool) return false;
  try {
    await pool.query(
      `INSERT INTO staff_statuses (user_id, status_text, updated_at)
       VALUES ($1::uuid, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE
         SET status_text = EXCLUDED.status_text, is_stale = false, updated_at = NOW()`,
      [userId, statusText],
    );
    return true;
  } catch {
    return false;
  }
}

export async function approveProcurement(id: string): Promise<boolean> {
  const pool = await getPool();
  if (!pool) return false;
  try {
    await pool.query(
      `UPDATE procurement_records SET status = 'PAYMENT_APPROVED' WHERE id = $1::uuid`,
      [id],
    );
    return true;
  } catch {
    return false;
  }
}
