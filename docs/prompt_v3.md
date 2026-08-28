# Enterprise IT Operations, Staff Monitoring & Vendor Financial Management System - v3

## 1. Executive Summary & Tech Stack

Build an enterprise-grade IT Operations Dashboard and Vendor Management Portal using **React (Vite), Tailwind CSS, Recharts, Supabase (PostgreSQL, Realtime, RLS, pgvector, Auth), and the DeepSeek API** for RAG-based compliance Q&A.

- **Deployment:** Supabase-hosted (managed). Target **500 concurrent users**.
- **Frontend:** React (Vite) / Tailwind CSS / Lucide Icons / Recharts / CSV & Excel export / PDF export libraries.
- **Backend / DB:** Supabase (PostgreSQL, Supabase Auth with **2FA required**, RLS, Supabase Realtime, pgvector).
- **AI & RAG Engine:** DeepSeek API integrated with pgvector vector similarity for natural-language Q&A over **3 PDF documents** (user guide + IT procedures manual). **English + Chinese** supported.
- **UI Language:** English-only for all regions.

---

## 2. Access, Authentication & Security

### Authentication
- **2FA is REQUIRED** for all logins (TOTP via Supabase Auth).
- Staff work on **company-provided computers only** and must connect via **VPN** to access the system.
- **SOC2** compliance standard (no separate SOX cert required). Immutable audit logging of all actions.

### Roles & Authorization Matrix
1. **SUPER_ADMIN / Head of IT** - full access, manages access control & approvals Level 3.
2. **DEPUTY_HEAD_OF_IT** - inherits Head of IT rights when activated.
3. **TEAM_LEAD** - manages their assigned team (1 of 8); approvals Level 1.
4. **IT_COLLEAGUE** - internal staff; updates own status.
5. **FINANCE_AUDITOR** - read-only global access to procurement, payments, cost allocation; blocked from editing operational/system access controls.
6. **VENDOR_API** - vendor access via dedicated API key.

### Tiered Approval Authorization Matrix
1. **Level 1 (Team Lead):** Approves PR/PO up to **HKD $100,000**.
2. **Level 2 (Deputy Head of IT):** Approves PR/PO **HKD $100,001 to $500,000**.
3. **Level 3 (Head of IT or Deputy):** Approves PR/PO **above HKD $500,000**.
4. **Dual-Control Rule:** Payment overrides/schedule changes above **HKD $250,000** require dual sign-off (Head of IT + Finance/Auditor).
5. **Separation of Duties:** Team Lead may approve their own team's PR/POs up to Level 2 (no cross-team conflict restriction).

### Deputy Delegation Engine
- **Scheduled activation** only — Deputy Head of IT rights activate when the Head of IT is **on leave** (auto-activation based on leave schedule).
- Deputy inherits full Head of IT authorization. All deputy actions write to `audit_logs` with `acted_as_deputy: true`.

---

## 3. Multi-Currency FX, Treasury & Cost Allocation

### Currencies & FX
- **Base Currency:** All dashboards/reports normalize to **HKD**.
- **Regional Currencies:** HKD, RMB (China), MYR (Malaysia), IDR (Indonesia).
- **Frozen FX rates** logged at PO creation date to prevent budget creep.
- **Illustrative fixed rates:** `1 USD = 7.8 HKD`, `1 RMB = 1.2 HKD` for demonstrations. (MYR/IDR also frozen at creation.)

### Multi-BU Cost Allocation
- A single PR/PO allocates percentage share across **8 Business Units**.
- Database constraint enforces `SUM(allocation) == 100%`.

### Dashboard & Reporting Metrics
- **Key KPIs:** total payments by month, pending approvals, variance flags, BU cost breakdown.
- **Date ranges:** MTD, YTD, rolling 30 days, rolling 90 days.
- **Chart types:** bar + line (Recharts).
- **Exports:** CSV, Excel, and PDF.

---

## 4. Staff Operations & Real-Time Shift Board (300 Staff / 8 Teams)

### Staff Status Monitoring
- **Real-Time Statuses:** `Active`, `In Meeting`, `On Call - Incidents`, `Deployment Window`, `Out of Office`.
- **Data Collection (internal staff):** pulled from **Jira API** (ticket/environment details). ⚠️ **EXTERNAL API INTEGRATION NEEDED**
- **Data Collection (vendors):** submitted via **vendor API**. ⚠️ **EXTERNAL API INTEGRATION NEEDED**
- **Realtime refresh:** **1 minute** (via Supabase Realtime).
- **Linked Context:** every active status requires linked **Active Jira/Ticket ID**, **Target Environment** (SIT, UAT, Staging, Production), and **ETA to Completion**.
- **Stale Alert:** auto-flag `Stale / Verification Required` if no heartbeat within **4 hours** during active shifts.

---

## 5. DeepSeek RAG Architecture & Compliance Guardrails

### Indexing & Vector Search
- **PDFs:** 3 documents (user guides + IT procedures manual). Supabase Storage triggers chunking (500-token chunks, 50-token overlap) -> pgvector embeddings (HNSW index). ⚠️ **SUPABASE STORAGE TRIGGER + pgvector INTEGRATION NEEDED**
- **Hybrid Retrieval:** Cosine Similarity (pgvector) + Full-Text Search (tsvector).

### DeepSeek API Execution
- Route top 5 context chunks to DeepSeek API (`deepseek-v4-pro` for complex policy analysis; `deepseek-v4-flash` for general Q&A). ⚠️ **EXTERNAL API INTEGRATION NEEDED (SERVER-SIDE ONLY)**
- **Paragraph Citations:** explicit `[Source: IT Procedures Manual v3.2, Section 4.1, Page 28]`.
- **Zero-Hallucination Guardrail:** similarity below **0.78** -> standard response: *"I cannot find an exact reference in the verified IT Procedures Manual. Please consult the Head of IT."*
- **Multilingual:** supports **English + Chinese** queries (indexed + answered in both).
- **Access scope:** internal IT staff only (vendors do NOT access RAG assistant).

---

## 6. Procurement Records & Vendor Management

### PR/PO Record Fields
In addition to financials, each PR/PO tracks:
- Vendor contact
- Delivery address
- Payment terms
- Tax ID
- **GMT+8 timestamps** for all monitoring

### Three-Way Matching Engine
Auto-verifies **Approved PO Amount == Vendor Invoice Amount == Milestone Sign-off**.
- Price variance tolerance: **0%**. Shipping/Tax tolerance: **±2%**.
- Discrepancy -> state `Blocked: Financial Variance Detected` and flag Finance/Auditor role.

### Vendor API (100 external/outsourcing vendors)
- **Authentication:** dedicated API key per vendor (100 vendors, each own key). ⚠️ **EXTERNAL API INTEGRATION NEEDED**
- **Onboarding:** Head of IT + Finance create/onboard vendors and issue API keys.
- **Data submitted by vendors:** invoices, delivery/milestone confirmation, PO acceptance.
- **Invoice formats:** PDF invoice upload **OR** API-submitted data.
- **Visibility:** vendors see only their own records (regional + vendor_id RLS isolation).
- Vendor self-service portal available for viewing their own payment status.

---

## 7. Security, Row Level Security (RLS) & Audit Trail

### Multi-Region & Role Isolation
- **Regional Isolation:** vendors restricted via RLS to their explicit `region` and `vendor_id` (HK, CN, MY, ID).
- **Team Isolation:** Team Leads manage only their assigned team (1 of 8).
- **Finance/Auditor:** read-only global access to procurement/payments/cost allocation; blocked from editing operational or system access.
- **Immutable Audit (SOC2):** `audit_logs` **INSERT only** (UPDATE/DELETE revoked for all roles).

---

## 8. UI Dashboard Layout & Functionality

### Header Bar
- Real-time system pulse
- Active Role Badge
- Deputy Mode Toggle (for Head of IT / scheduled)
- DeepSeek AI Search Bar (**Cmd + K**)

### Sidebar
- **⚡ Real-Time Staff Shift Board** (300-staff grid + ticket/environment details)
- **⚙️ Environment Release Gatekeeper** (SIT / UAT / Prod handover checklist)
- **💳 Vendor PR / PO Workflow Engine** (3-way match & variance flags)
- **📊 Treasury & Cost Allocation Analytics** (Recharts multi-BU splits)
- **🤖 IT Compliance Assistant** (DeepSeek RAG modal with paragraph citations)
- **🔒 Super Admin Access Control & Audit Log Viewer**

---

## 9. Complete Database Schema (Supabase DDL)

```sql
-- Enable Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Enums
CREATE TYPE user_role AS ENUM ('SUPER_ADMIN', 'DEPUTY_HEAD_OF_IT', 'TEAM_LEAD', 'IT_COLLEAGUE', 'FINANCE_AUDITOR', 'VENDOR_API');
CREATE TYPE region_code AS ENUM ('HK', 'CN', 'MY', 'ID');
CREATE TYPE env_type AS ENUM ('SIT', 'UAT', 'STAGING', 'PROD');
CREATE TYPE pr_po_status AS ENUM ('PR_DRAFT', 'PR_APPROVED', 'PO_ISSUED', 'MILESTONE_RECEIVED', 'INVOICE_PENDING', 'VARIANCE_BLOCKED', 'PAYMENT_APPROVED', 'PAID');

-- Teams Table
CREATE TABLE teams (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_name TEXT NOT NULL,
    team_lead_id UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Profiles Table
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    role user_role NOT NULL DEFAULT 'IT_COLLEAGUE',
    team_id UUID REFERENCES teams(id),
    region region_code NOT NULL DEFAULT 'HK',
    deputy_for_user_id UUID REFERENCES profiles(id),
    on_leave BOOLEAN DEFAULT FALSE,               -- triggers scheduled deputy activation
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Frozen FX Rates
CREATE TABLE fx_rates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    base_currency VARCHAR(3) NOT NULL DEFAULT 'HKD',
    quote_currency VARCHAR(3) NOT NULL,
    rate NUMERIC(18, 6) NOT NULL,
    effective_at TIMESTAMPTZ DEFAULT NOW()
);

-- Real-Time Staff Statuses
CREATE TABLE staff_statuses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    status_text TEXT NOT NULL,
    active_ticket_id TEXT,                         -- linked Jira/ticket
    environment env_type DEFAULT 'SIT',
    eta_completion TIMESTAMPTZ,
    is_stale BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Vendors
CREATE TABLE vendors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vendor_name TEXT NOT NULL,
    region region_code NOT NULL,
    contact TEXT,
    delivery_address TEXT,
    payment_terms TEXT,
    tax_id TEXT,
    api_key_hash TEXT UNIQUE,                      -- dedicated API key per vendor
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Procurement Records
CREATE TABLE procurement_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pr_number TEXT UNIQUE NOT NULL,
    po_number TEXT UNIQUE,
    vendor_id UUID NOT NULL REFERENCES vendors(id),
    region region_code NOT NULL,
    local_currency VARCHAR(3) NOT NULL,
    local_amount NUMERIC(15, 2) NOT NULL,
    hkd_amount NUMERIC(15, 2) NOT NULL,            -- normalized base
    fx_rate NUMERIC(18, 6) NOT NULL,               -- frozen at creation
    payment_terms TEXT,
    delivery_address TEXT,
    tax_id TEXT,
    status pr_po_status DEFAULT 'PR_DRAFT',
    created_by UUID REFERENCES profiles(id),
    level_1_approver UUID REFERENCES profiles(id),
    level_2_approver UUID REFERENCES profiles(id),
    level_3_approver UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW()           -- GMT+8 monitored
);

-- Cost Allocations Table (Sum must equal 100%)
CREATE TABLE cost_allocations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    procurement_id UUID REFERENCES procurement_records(id) ON DELETE CASCADE,
    business_unit TEXT NOT NULL,
    percentage_share NUMERIC(5, 2) NOT NULL,
    CHECK (percentage_share > 0 AND percentage_share <= 100)
);

-- Payment Schedules
CREATE TABLE payment_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    procurement_id UUID REFERENCES procurement_records(id) ON DELETE CASCADE,
    due_date DATE NOT NULL,
    amount NUMERIC(15,2) NOT NULL,
    is_variance_detected BOOLEAN DEFAULT FALSE,
    dual_signoff_head_id UUID REFERENCES profiles(id),
    dual_signoff_finance_id UUID REFERENCES profiles(id),
    paid_at TIMESTAMPTZ
);

-- Knowledge Base Vectors for RAG (EN + CN)
CREATE TABLE knowledge_base_vectors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_title TEXT NOT NULL,
    language VARCHAR(2) NOT NULL,                  -- 'EN' or 'CN'
    section_reference TEXT,
    page_number INT,
    content TEXT NOT NULL,
    embedding vector(1536),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Immutable Audit Logs (SOC2)
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_id UUID REFERENCES profiles(id),
    action_type TEXT NOT NULL,
    target_resource TEXT NOT NULL,
    old_value JSONB,
    new_value JSONB,
    acted_as_deputy BOOLEAN DEFAULT FALSE,
    ip_address TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Immutable Audit RLS (INSERT only)
CREATE POLICY audit_insert_only ON audit_logs FOR INSERT WITH CHECK (true);
CREATE POLICY audit_select_admin ON audit_logs FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND role IN ('SUPER_ADMIN', 'DEPUTY_HEAD_OF_IT', 'FINANCE_AUDITOR'))
);

-- Vendor Regional Isolation
CREATE POLICY vendor_region_isolation ON vendors FOR SELECT USING (
    region = (SELECT region FROM profiles WHERE id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'SUPER_ADMIN')
);

-- Stored Procedure for Vector Match
CREATE OR REPLACE FUNCTION match_knowledge_base (
  query_embedding vector(1536),
  match_threshold float,
  match_count int
)
RETURNS TABLE (
  id uuid,
  document_title text,
  section_reference text,
  page_number int,
  content text,
  similarity float
)
LANGUAGE plpgsql
AS $$ BEGIN   RETURN QUERY   SELECT     kb.id,     kb.document_title,     kb.section_reference,     kb.page_number,     kb.content,     1 - (kb.embedding <=> query_embedding) AS similarity   FROM knowledge_base_vectors kb   WHERE 1 - (kb.embedding <=> query_embedding) > match_threshold   ORDER BY kb.embedding <=> query_embedding   LIMIT match_count; END; $$;
```

---

## 10. Phase & Build Notes (for Replit)

1. **Phase 1 (MVP):** Auth + 2FA, role-based UI shell, staff shift board (Jira + realtime), procurement workflow + approvals, 3-way match.
2. **Phase 2:** DeepSeek RAG over 3 PDFs (EN/CN), treasury analytics + exports (CSV/Excel/PDF), vendor API + self-service portal, deputy delegation, audit log viewer.
3. Use Supabase Edge Functions for DeepSeek API calls (keep API key server-side).
4. Seed demo data reflecting the 8 teams, 8 BUs, and sample vendors across all 4 regions.

---

## 11. External Platform API Integrations — **MUST IMPLEMENT**

| # | Platform | Purpose | Integration Point | Auth Method | Status |
|---|----------|---------|-------------------|-------------|--------|
| 1 | **Jira REST API v3** | Pull ticket/environment details for internal staff statuses | `GET /rest/api/3/issue/{key}`, webhook for real-time updates | OAuth 2.0 / PAT | ⬜ **NOT STARTED** |
| 2 | **Vendor REST API** | Vendors submit invoices, delivery/milestone confirmations, PO acceptances | Vendor-facing endpoints: `POST /api/vendor/invoices`, `POST /api/vendor/deliveries`, `POST /api/vendor/po-acceptance` | API Key (per vendor, HMAC-SHA256) | ⬜ **NOT STARTED** |
| 3 | **DeepSeek API** | RAG Q&A: embed query → vector search → DeepSeek completion with citations | Edge Function: `deepseek-chat`, `deepseek-v4-pro` / `deepseek-v4-flash` | Bearer Token (server-side only) | ⬜ **NOT STARTED** |
| 4 | **Supabase Auth** | User authentication, TOTP 2FA, session management, role claims | Supabase Auth SDK + Edge Functions for 2FA challenge | JWT + TOTP | 🟡 **PARTIAL (users seeded, 2FA not wired)** |
| 5 | **Supabase Storage** | PDF upload → trigger chunking → pgvector embeddings | Storage webhook → Edge Function → pgvector insert | Service Role Key | ⬜ **NOT STARTED** |
| 6 | **Supabase Realtime** | 1-min staff status broadcast, procurement updates | Channel subscriptions on `staff_statuses`, `procurement_records` | Anon / Auth JWT | 🟡 **PARTIAL (channel infra exists, not subscribed)** |
| 7 | **pgvector / HNSW** | Vector similarity search for RAG | `match_knowledge_base` RPC + HNSW index on `knowledge_base_vectors.embedding` | Service Role / Auth | 🟡 **PARTIAL (schema exists, index missing)** |

### Integration Architecture Summary

```
┌─────────────────────────────────────────────────────────────────────┐
│                        REACT FRONTEND (Vite + Tailwind)            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐  │
│  │ Staff Board │  │ Procurement │  │ Treasury    │  │ RAG Chat  │  │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └─────┬─────┘  │
└─────────┼────────────────┼────────────────┼─────────────┼──────────┘
          │                │                │             │
          ▼                ▼                ▼             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      SUPABASE BACKEND                               │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌───────────┐  │
│  │ Auth (2FA)   │ │ Postgres +   │ │ Realtime     │ │ Storage   │  │
│  │ + RLS        │ │ pgvector     │ │ (1-min)      │ │ (PDFs)    │  │
│  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └─────┬───────┘  │
└─────────┼────────────────┼────────────────┼─────────────┼──────────┘
          │                │                │             │
    ┌─────┴─────┐    ┌─────┴─────┐    ┌─────┴─────┐ ┌────┴────┐
    ▼           ▼    ▼           ▼    ▼           ▼ ▼         ▼
Jira API   Vendor API  DeepSeek    pgvector    Supabase
           (inbound)   (server)    (HNSW)     Edge Fn
```

### Critical Integration Requirements

#### Jira API (Internal Staff Status)
- **Endpoint:** `GET /rest/api/3/issue/{issueIdOrKey}?fields=summary,status,environment,assignee`
- **Polling:** 1-minute interval (or webhook via Jira Automation)
- **Mapping:** `issue.key` → `staff_statuses.active_ticket_id`, `fields.environment` → `environment`, `fields.assignee` → user mapping
- **Error handling:** Graceful degradation to manual entry if Jira unavailable

#### Vendor API (External Vendor Submissions)
- **Auth:** HMAC-SHA256 signature verification using `api_key_hash` from `vendors` table
- **Endpoints:**
  - `POST /api/vendor/invoices` — multipart/form-data (PDF) + JSON metadata
  - `POST /api/vendor/deliveries` — `{ procurement_id, milestone_id, delivered_at, qty }`
  - `POST /api/vendor/po-acceptance` — `{ po_number, accepted: boolean }`
- **RLS:** Vendor only sees own records via `vendor_id` + `region`

#### DeepSeek API (RAG - Server-Side Only)
- **Location:** Supabase Edge Function (`/functions/v1/compliance-chat`)
- **Flow:** Client query → Edge Function → pgvector `match_knowledge_base` → DeepSeek completion → return citations
- **Models:** `deepseek-v4-pro` (policy), `deepseek-v4-flash` (general)
- **Guardrail:** Threshold 0.78; below = fallback message
- **Languages:** EN + CN (both indexed and answered)

#### Supabase Auth (2FA)
- **TOTP:** Enforce via `auth.mfa` factors; challenge on every login
- **Roles:** Custom claim `role` in JWT (mirror `profiles.role`)
- **Session:** Short-lived access tokens (15 min) + refresh tokens

#### Supabase Storage + pgvector (PDF Pipeline)
- **Upload:** Client → Storage bucket `it-procedures`
- **Trigger:** `onInsert` → Edge Function chunks PDF (500 tokens / 50 overlap)
- **Embed:** Edge Function calls embedding model → inserts into `knowledge_base_vectors`
- **Index:** HNSW on `embedding` column (maintained via `CREATE INDEX ... USING hnsw`)

---

## 12. Agent Guardrails / Gotchas (READ FIRST before coding)

Same as v2 — see `prompt_v2.md` §11 for full list. Key integration-specific gotchas:

- **A. RLS Policies Are Incomplete** — Add policies for all tables (not just `audit_logs`/`vendors`).
- **B. Circular FKs** — `teams.team_lead_id` ↔ `profiles.team_id`; create teams first with NULL lead, backfill.
- **C. `profiles` RLS Blocks Login** — Self-read policy mandatory before any auth flow.
- **D. `on_leave` → Deputy Activation** — Implement trigger or Edge Function cron.
- **E. Staff Stale Flag** — Scheduled job (pg_cron or Edge Function) sets `is_stale` after 4h.
- **F. 2FA Enforced** — Wire Supabase TOTP; block login until verified.
- **G. `match_knowledge_base` Security** — Add `SECURITY DEFINER` + `GRANT EXECUTE`.
- **H. DeepSeek Key Server-Side Only** — Never in client; Edge Function only.
- **I. SUM(Allocation) == 100%** — Trigger or app logic at save time.
- **J. Variance Tolerance Constants** — Single config source (0% price, ±2% tax/shipping, RAG 0.78).
- **K. Circular Seed Order** — teams → profiles → vendors → procurement → allocations → payments → staff_statuses.

---

## 13. Current Build State (as of v3)

| Component | Status |
|-----------|--------|
| Supabase schema + seed (UUID PKs, RLS, triggers) | ✅ Applied to live DB (`maadotlqbdgzxmbpyriy`) |
| Transaction Pooler URL (6543?pgbouncer=true) | ✅ Verified working with Pool |
| API Server routes (`/api/health`, `/api/dashboard/summary`, `/api/staff`, `/api/procurement`) | ✅ DB-backed with stub fallback |
| Staff PATCH `/staff/:id` + Procurement PATCH `/procurement/:id/approve` | ✅ Persist to live DB |
| Migration strategy (`post-merge.sh` no auto-push; `pnpm db:migrate` one-off) | ✅ Implemented |
| Replit deployment | ✅ Live at `https://it-operations-control-tower.replit.app/` |
| Replit Secrets (DB, Supabase, DeepSeek) | ⚠️ Set by user (not in repo) |
| Jira API integration | ⬜ Not started |
| Vendor API integration | ⬜ Not started |
| DeepSeek RAG (Edge Function + pgvector) | ⬜ Not started |
| Supabase Auth 2FA | ⬜ Not started |
| Supabase Storage → pgvector pipeline | ⬜ Not started |
| Realtime subscriptions | ⬜ Not started |

---

*Generated from `prompt_v2.md` with explicit external API integration matrix added for v3.*