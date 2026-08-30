# Enterprise IT Operations, Staff Monitoring & Vendor Financial Management System - v4

## 1. Changes in v4 (this document)

v4 carries forward the full v3 specification (auth, RLS, staff board, RAG, treasury) and adds the
**completed PR/PO + payment procedure API layer**. Everything described in v3 remains in force; the
sections below document:

1. The **API-layer surface** for the PR/PO workflow and payment procedures (endpoints, request/response
   contracts) — verified end-to-end against the live Supabase DB.
2. The **resilient data-access layer** (exponential backoff + jitter, circuit breaker, DLQ, graceful
   degradation, alerting) that wraps those endpoints.
3. **Workflow-rule enforcement** (tiered approvals, review gating, budget-first, dual sign-off, variance)
   as implemented in the API + DB triggers.
4. The **bug fixes** required to make the workflow actually run: region enum cast, `expected_settlement_month`
   as text, milestone-aware three-way matching, idempotent seed, audit-trigger actor fallback.
5. The **React frontend wiring** (§17): the Procurement control surface now drives the live PR/PO workflow,
   with create-PR, tiered approval + legal/security review, milestones, invoice/three-way match, variance
   resolution, dual sign-off and payment — all against the live API.
6. An **updated build-state table** (§13) reflecting what is now implemented vs. still open.

The authoritative backend spec remains `docs/prompt_v3.md` §6. This v4 focuses on the API layer and
current build state.

---

## 13 (v4). Build State — updated

| Component | Status (v4) |
|-----------|-------------|
| Supabase schema + seed (UUID PKs, RLS, triggers, pgvector) | ✅ Applied to live DB (`maadotlqbdgzxmbpyriy`) |
| Transaction Pooler URL (6543?pgbouncer=true) | ✅ Verified working with `pg` Pool |
| Core runtime endpoints (`/api/health`, `/api/dashboard/summary`, `/api/staff`, `/api/procurement`) | ✅ DB-backed with stub fallback |
| Staff PATCH `/staff/:id` + Procurement PATCH `/procurement/:id/approve` | ✅ Persist to live DB |
| **PR/PO API: create PR with budget pre-check** | ✅ `POST /api/procurement` (201/409 BUDGET) |
| **PR/PO API: legal/security review submission** | ✅ `PATCH /api/procurement/:id/review` |
| **PR/PO API: tiered status advancement (review + tier + budget gating)** | ✅ `PATCH /api/procurement/:id/status` |
| **Payment API: list / create milestone schedules** | ✅ `GET`/`POST /api/procurement/:id/payments` |
| **Payment API: submit invoice (OCR hook) → auto 3-way match** | ✅ `PATCH /api/payments/:id/invoice` |
| **Payment API: three-way match result** | ✅ `GET /api/payments/:id/three-way` |
| **Payment API: variance resolution (finance + legal notes)** | ✅ `PATCH /api/payments/:id/variance` |
| **Payment API: dual sign-off (Head + Finance, > HKD 250k)** | ✅ `PATCH /api/payments/:id/signoff` |
| **Payment API: mark paid (budget paid_amount trigger)** | ✅ `PATCH /api/payments/:id/pay` |
| **Budget API: summary (allocated / incurred / paid / remaining)** | ✅ `GET /api/budget/summary` |
| **Resilience layer: retry w/ backoff+jitter, circuit breaker, graceful degradation, alerting** | ✅ `lib/resilience.ts` |
| **Dead-Letter Queue: `dlq_entries` table + RLS + list/reprocess/discard** | ✅ `GET /api/dlq`, `PATCH /api/dlq/:id/reprocess`, `PATCH /api/dlq/:id/discard` |
| **React Procurement page → live PR/PO workflow (create PR, approvals, milestones, payments)** | ✅ `src/procurement-workflow.tsx`, wired into Router |
| OpenAPI spec (extended) → zod + react-client codegen | ✅ `lib/api-spec/openapi.yaml`, regenerated |
| Budget import / export (CSV/Excel upload) | ⬜ Not started |
| Jira API integration | ⬜ Not started |
| Vendor API integration | ⬜ Not started |
| DeepSeek RAG (Edge Function + pgvector) | ⬜ Not started |
| Supabase Auth 2FA | ⬜ Not started |
| Supabase Storage → pgvector pipeline | ⬜ Not started |
| Realtime subscriptions | ⬜ Not started |

---

## 14. PR/PO Workflow — API Layer (implemented in v4)

### 14.1 Endpoint surface

All PR/PO + payment routes live in `artifacts/api-server/src/routes/operations.ts`. Every request and
response is validated/typed via zod (generated from `lib/api-spec/openapi.yaml`). The data-access layer
sits in `artifacts/api-server/src/lib/db-runtime.ts` and wraps live PostgreSQL through the Supabase
session pooler.

```
POST   /api/procurement                       # create PR w/ budget pre-check
PATCH  /api/procurement/:id/review            # submit legal or security review decision
PATCH  /api/procurement/:id/status            # advance tiered lifecycle (toStatus, actorId)
GET    /api/procurement/:id/payments          # list payment schedules for a PR
POST   /api/procurement/:id/payments          # create milestone / single payment schedule
PATCH  /api/payments/:id/invoice              # submit invoice (OCR hook) → triggers 3-way match
GET    /api/payments/:id/three-way            # latest three-way match result for a schedule
PATCH  /api/payments/:id/variance             # resolve a blocked variance (finance + legal)
PATCH  /api/payments/:id/signoff              # dual sign-off (Head of IT + Finance) > HKD 250k
PATCH  /api/payments/:id/pay                  # mark paid (budget paid_amount via DB trigger)
GET    /api/budget/summary                    # allocated/incurred/paid/remaining rollup
GET    /api/dlq                               # list dead-letter queue entries
PATCH  /api/dlq/:id/reprocess                 # retry a failed DLQ entry
PATCH  /api/dlq/:id/discard                   # discard a DLQ entry
```

### 14.2 Request contracts (zod-generated, camelCase)

| Route | Body |
|-------|------|
| `POST /api/procurement` | `CreateProcurementInput`: `vendorId`, `budgetLineId`, `region` (HK/CN/MY/ID), `localCurrency`, `localAmount`, `hkdAmount`, `fxRate`, `projectCode`, optional `paymentTerms`, `expectedSettlementAmount`, `expectedSettlementMonth` (`YYYY-MM`), `terms`, `deliveryAddress`, `taxId`, `createdBy`, `level1Approver`, `level2Approver`, `level3Approver` |
| `PATCH /:id/review` | `ReviewDecisionInput`: `reviewType` (`legal`\|`security`), `decision` (`APPROVED`\|`REJECTED`), `reviewerId` |
| `PATCH /:id/status` | `AdvanceProcurementInput`: `toStatus` (`PR_APPROVED`\|`PO_ISSUED`\|`MILESTONE_RECEIVED`\|`INVOICE_PENDING`\|`PAYMENT_APPROVED`\|`PAID`), `actorId`, optional `note` |
| `POST /:id/payments` | `CreatePaymentInput`: `dueDate`, `amount`, `isMilestonePayment`, optional `milestoneNumber`, `milestoneDescription` |
| `PATCH /payments/:id/invoice` | `InvoiceInput`: `invoiceAmount`, `invoiceNumber`, optional `invoiceDate`, `ocrInvoiceData` |
| `PATCH /payments/:id/variance` | `VarianceResolutionInput`: `resolvedBy`, `resolutionNotes`, optional `requireLegalConsultation` |
| `PATCH /payments/:id/signoff` | `SignoffInput`: `headId`, `financeId` |
| `PATCH /payments/:id/pay` | `PaidInput`: `paidAmount`, `paymentReference`, `paidBy` |

### 14.3 Error codes (structured, not just HTTP status)

| Code | Meaning | HTTP |
|------|---------|------|
| `BUDGET` | Budget pre-check / availability failed (insufficient remaining) | 409 |
| `APPROVAL_TIER` | Required approver tier not set or wrong actor for the HKD band | 409 |
| `REVIEW_GATING` | Legal/security review pending or rejected before `PO_ISSUED` | 409 |
| `REVIEW_NOT_REQUIRED` | No review required for the given `reviewType` on this record | 409 |
| `BAD_TRANSITION` / `BAD_STATUS` | Illegal or backwards status move | 409 |
| `MILESTONE_OVERFLOW` | Milestone amounts would exceed the PO amount | 409 |
| `SIGNOFF_NOT_REQUIRED` | Payment ≤ HKD 250k — dual sign-off not applicable | 409 |
| `SIGNOFF_REQUIRED` | Payment > HKD 250k paid without dual sign-off | 409 |
| `VARIANCE_BLOCKED` / `NO_VARIANCE` | Variance handling on a blocked / clean schedule | 409 |
| `NOT_FOUND` | Record not found | 404 / 409 |
| `CIRCUIT_OPEN` | Circuit breaker open — dependency degraded | 503 |
| `DB_UNAVAILABLE` / `DB_ERROR` | DB not configured or statement failed | 500 |

### 14.4 Workflow-rule enforcement (API + DB triggers)

- **Budget-first:** `POST /api/procurement` runs a budget pre-check; `advanceProcurementStatus` re-checks
  before `PR_APPROVED` / `PO_ISSUED`. Incurred is committed on `PR_APPROVED`/`PO_ISSUED`, paid on `paid_at`
  (DB triggers on `budget_lines`).
- **Review gating:** cannot reach `PO_ISSUED` if legal/security review is required but not `APPROVED`.
- **Tiered approvals:** L2 required for the `PR_APPROVED` transition when `hkd > 100k`; L3 for `PO_ISSUED`
  when `hkd > 500k`.
- **Two-way / three-way match:** `validate_three_way_match()` DB trigger auto-creates/updates the match
  row on invoice insert/update; price tolerance 0% → `PRICE_VARIANCE`, shipping/tax ±2% →
  `SHIPPING_TAX_VARIANCE`; any variance sets `VARIANCE_BLOCKED` on the PR. **Milestone-aware:** the invoice
  is compared against the schedule's own `amount` (e.g. a 3:4:3 milestone) rather than the full PO total.
- **Variance resolution:** `resolveVariance` records `variance_resolved_by/at/notes` and releases the PR
  from `VARIANCE_BLOCKED` once no blocked schedules remain.
- **Dual sign-off:** > HKD 250k requires `dualSignoff` before `markPaid` (returns `SIGNOFF_REQUIRED` otherwise).
- **Audit:** all status changes, review decisions, variance resolutions and dual sign-offs are written to
  immutable `audit_logs` by DB triggers. Actor fallback is `NULL` (never a bogus UUID).

---

## 15. Resilient Data-Access Layer (`artifacts/api-server/src/lib/resilience.ts`)

Added to keep the API stable against network/DB/dependency failures:

- **`withRetry(fn, { maxAttempts, baseDelayMs })`** — exponential backoff with jitter; used on retryable
  operations (e.g. invoice submission).
- **`CircuitBreaker`** — trips `OPEN` after N consecutive failures, resets after a cooldown, sends a
  half-open probe; throws `CircuitOpenError` → routes return `503 CIRCUIT_OPEN`.
  Instances: `dbBreaker`, `budgetBreaker`.
- **`withGracefulDegradation`** — fall back to representative/stub data when a dependency is unavailable
  (used for DeepSeek, Jira, Vendor integrations and budget summary on failure).
- **`alertEngine.critical / warning`** — routes to Slack / SMS / Email channels (webhook URLs via
  `ALERT_SLACK_WEBHOOK`, `ALERT_SMS_ENDPOINT`, `ALERT_EMAIL_ENDPOINT`).
- **Dead-letter queue:** `captureToDlq` / `registerDlqCapture` persist failed outbound calls to
  `dlq_entries` (RLS-enabled), with an in-memory fallback buffer. `reprocessDlq`/`discardDlq` manage retries.

Routes wrap DB calls with the breaker and retry so failures degrade to 503/500 with structured codes
instead of hanging the dashboard, and failed deliveries are captured for replay.

---

## 16. Fixes applied to make the workflow run end-to-end

These were the bugs that blocked seed application / the live workflow (all verified via the full e2e):

| # | Bug | Fix |
|---|-----|-----|
| 1 | Audit-trigger actor fallback used `'system'` (non-UUID) and `NEW.paid_amount::uuid` (numeric→uuid invalid) → seed failed `22P02` | Use `NULL` fallback (drop `'system'` and the invalid cast) |
| 2 | Three-way match compared invoice vs **full PO** → false variances on 3:4:3 milestones | Compare invoice vs **schedule `amount`** (milestone-aware) |
| 3 | Seed `three_way_matches` inserts collided with trigger-created rows (`UNIQUE(procurement_id, payment_schedule_id)`) | `ON CONFLICT DO NOTHING` |
| 4 | `expected_settlement_month` was `DATE`; API sends `YYYY-MM` → `::date` cast fails | Column changed to `TEXT` (matches contract + runtime `YYYY-MM` output) |
| 5 | `createProcurementRecord` region passed `$5::text` but column is `region_code` enum → `42703`/mismatch | Remove the explicit text cast (let Postgres coerce to the enum) |

### Verified end-to-end

Executed the full workflow against the live DB: create PR (201) → legal + security review (200) →
`PR_DRAFT→PR_APPROVED→PO_ISSUED` (L2/L3 tier labels, review gating) → create milestones (201) →
submit invoice → three-way **MATCHED** → dual sign-off (>250k OK; ≤250k correctly `SIGNOFF_NOT_REQUIRED`)
→ pay both → **budget incurred +paid updated** → DLQ empty. Typecheck + api-server build green.

---

## 17. React Frontend — live PR/PO Workflow (implemented)

The **Procurement control surface** (`/procurement`) is now fully wired to the live API. The old list +
single "Approve" button (`useListProcurementRecords` / `useApproveProcurement`) was replaced with a
self-contained module at `artifacts/it-operations-control-tower/src/procurement-workflow.tsx`, imported
into `App.tsx` as `ProcurementWorkflowPage` and bound to the `/procurement` route.

### 17.1 What the UI drives (all against live endpoints)

| UI surface | Action → endpoint |
|------------|-------------------|
| **New PR** modal | `POST /api/procurement` (vendor/budget/region/FX; live HKD + tier preview; sets `level1/2/3Approver` by HKD band) |
| **Legal / security review** | `PATCH /api/procurement/:id/review` (shown when `hkd > 100k`) |
| **Advance to next status** | `PATCH /api/procurement/:id/status` (tier + review + budget gating surfaced as toasts) |
| **Add milestone** | `POST /api/procurement/:id/payments` (3:4:3; `MILESTONE_OVERFLOW` respected) |
| **Submit invoice** | `PATCH /api/payments/:id/invoice` → auto three-way match |
| **Three-way match status** | displayed from the schedule's `threeWayMatch` field |
| **Resolve variance** | `PATCH /api/payments/:id/variance` (finance + legal notes) |
| **Dual sign-off** | `PATCH /api/payments/:id/signoff` (shown only for `> HKD 250k`, Head + Finance) |
| **Mark paid** | `PATCH /api/payments/:id/pay` (budget `paid_amount` via DB trigger) |

### 17.2 Decisions

- **Reference data baked in** from the live DB: six vendors (name/region/currency), four budget lines
  (category), and the four seeded auth users (Head, Deputy Head, Team Lead, Finance Auditor) as actor IDs.
- **Approval tier is derived client-side** for display and approver assignment, but the **server remains
  authoritative** — a minted PR sets `level1Approver` (Team Lead), `level2Approver` (Deputy) when
  `hkd > 100k`, `level3Approver` (Head) when `hkd > 500k`, matching the API's L2/L3 enforcement.
- **Errors surface as toasts** with the structured message from the resilience layer (e.g.
  `REVIEW_GATING`, `APPROVAL_TIER`, `BUDGET`, `SIGNOFF_REQUIRED`, `MILESTONE_OVERFLOW`).
- **shadcn/ui primitives** (`Dialog`, `Button`, `Input`, `Label`, `Select`, `Textarea`) for the forms,
  consistent with the existing operational CSS vocabulary for tables/metrics/status pills.

### 17.3 Verification

Frontend `typecheck` and `vite build` are green from a fresh `git reset --hard origin/main` of the WSL
build clone. No backend/API changes were introduced by this step.

---

*Generated from `prompt_v3.md` — v4 adds the implemented PR/PO + payment API layer, the resilient
data-access layer, the applied bug fixes, the React frontend wiring, and an updated build state.*
