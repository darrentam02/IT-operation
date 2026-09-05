# Wall Street Specification: Enterprise IT Operations, Task & Vendor Financial Management System

## 1. Executive Summary & Tech Stack

Build an enterprise-grade, institutional IT Operations Dashboard and Vendor Management Portal utilizing Node.js, React, Tailwind CSS, Recharts, Supabase (PostgreSQL, Realtime, RLS, pgvector), and the DeepSeek API (`deepseek-v4-pro` and `deepseek-v4-flash`).

- **Frontend:** React (Vite) / Tailwind CSS / Lucide Icons / Recharts / PDF Export Libraries
- **Backend / DB:** Supabase (PostgreSQL, Supabase Auth, Row Level Security, Supabase Realtime, pgvector)
- **AI & RAG Engine:** DeepSeek API integrated with vector similarity search (`pgvector`) for natural language compliance Q&A over PDF user guides and IT procedure manuals.

---

## 2. Procurement & Financial Controls (Wall Street Standard)

### Tiered Approval Authorization Matrix
1. **Level 1 (Team Leader):** Approves PR/PO up to **HKD $100,000** (or FX equivalent).
2. **Level 2 (Deputy Head of IT):** Approves PR/PO from **HKD $100,001 to $500,000**.
3. **Level 3 (Head of IT / Super Admin):** Approves PR/PO **above HKD $500,000**.
4. **Dual-Control Rule:** Payment overrides or schedule changes above **HKD $250,000** require dual sign-off (Head of IT + Finance/Auditor role).

### Multi-Currency, FX Treasury & Cost Allocation
- **Base Currency:** All global dashboards and reports normalize to **HKD**.
- **Regional Currencies:** HKD, RMB (China), MYR (Malaysia), IDR (Indonesia).
- **FX Mechanics:** Frozen spot exchange rates logged in `fx_rates` at PO creation date to prevent budget creep.
- **Multi-BU Split:** A single PR/PO expense supports percentage allocation across multiple Business Units (e.g., 50% Retail Banking, 30% Wealth Management, 20% IT Infra). Database constraint enforces `SUM(allocation) == 100%`.

### Three-Way Matching Engine
Auto-verifies **Approved PO Amount == Vendor Invoice Amount == Milestone Sign-off**. 
- Price variance tolerance: **0%**. Shipping/Tax tolerance: **±2%**.
- Discrepancy triggers state `Blocked: Financial Variance Detected` and flags the Finance/Auditor role.

---

## 3. Staff Operations & Environment Release Governance

### Staff Shift & Workload Monitoring (300 Staff across 8 Teams)
- **Real-Time Statuses:** `Active`, `In Meeting`, `On Call - Incidents`, `Deployment Window`, `Out of Office`.
- **Linked Context:** Every status update requires a linked **Active Jira/Ticket ID**, **Target Environment** (SIT, UAT, Staging, Production), and an **ETA to Completion**.
- **Stale Alert:** System auto-flags status as `Stale / Verification Required` if no heartbeat log is registered within 4 hours during active shifts.

### Deputy Delegation Engine
- Manual or scheduled activation for Deputy Head of IT.
- Deputy inherits full Head of IT authorization rights. All actions write to `audit_logs` with `acted_as_deputy: true`.

### Environment Release Gatekeeping
- **Four-Eye Release Gate:** Production releases require verified sign-offs: **Dev Lead + SIT/UAT Test Lead**.
- **Shift Handover Checklist:** Mandatory sign-off logging active P1/P2 incidents, hotfixes, and vendor escalations at shift rotations.

---

## 4. DeepSeek RAG Architecture & Compliance Guardrails

### Indexing & Vector Search
- **PDF Pipeline:** Supabase Storage triggers chunking (500-token chunks, 50-token overlap) and stores vector embeddings in Supabase `pgvector` with an **HNSW index**.
- **Hybrid Retrieval:** Executes Cosine Similarity (`pgvector`) + Full-Text Search (`tsvector`).

### DeepSeek API Execution
- Routes top 5 context chunks to DeepSeek API (`deepseek-v4-pro` for complex policy analysis; `deepseek-v4-flash` for general user guide Q&A).
- **Paragraph Citations:** Returns explicit citations: `[Source: IT Procedures Manual v3.2, Section 4.1, Page 28]`.
- **Zero-Hallucination Guardrail:** If similarity score is below **0.78**, returns standard compliance response: *"I cannot find an exact reference in the verified IT Procedures Manual. Please consult the Head of IT."*

---

## 5. Security, Row Level Security (RLS) & Audit Trail

### Multi-Region & Role Isolation Rules
- **Regional Isolation:** Vendors in HK, China, Malaysia, and Indonesia are restricted via RLS to their explicit `region` and `vendor_id`.
- **Team Isolation:** Team Leads view/manage only their assigned team (1 of 8).
- **Finance / Auditor:** Read-only global access to procurement, payments, and cost allocation. Blocked from editing operational or system access controls.
- **SOX/SOC 2 Immutable Audit:** `audit_logs` table allows **`INSERT` only** (`UPDATE` and `DELETE` strictly revoked for all roles).

---

## 6. Complete Database Schema (Supabase DDL)

```sql
-- Enable Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Enums
CREATE TYPE user_role AS ENUM ('SUPER_ADMIN', 'DEPUTY_HEAD_OF_IT', 'TEAM_LEAD', 'IT_COLLEAGUE', 'FINANCE_AUDITOR', 'VENDOR_API');
CREATE TYPE region_code AS ENUM ('HK', 'CN', 'MY', 'ID');
CREATE TYPE env_type AS ENUM ('SIT', 'UAT', 'STAGING', 'PROD');
CREATE TYPE pr_po_status AS ENUM ('PR_DRAFT', 'PR_APPROVED', 'PO_ISSUED', 'MILESTONE_RECEIVED', 'INVOICE_PENDING', 'VARIANCE_BLOCKED', 'PAYMENT_APPROVED', 'PAID');

-- Profiles Table
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    role user_role NOT NULL DEFAULT 'IT_COLLEAGUE',
    team_id UUID,
    region region_code NOT NULL DEFAULT 'HK',
    deputy_for_user_id UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Teams Table
CREATE TABLE teams (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_name TEXT NOT NULL,
    team_lead_id UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Real-Time Staff Statuses
CREATE TABLE staff_statuses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    status_text TEXT NOT NULL,
    active_ticket_id TEXT,
    environment env_type DEFAULT 'SIT',
    eta_completion TIMESTAMPTZ,
    is_stale BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Procurement Records
CREATE TABLE procurement_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pr_number TEXT UNIQUE NOT NULL,
    po_number TEXT UNIQUE,
    vendor_id UUID NOT NULL,
    region region_code NOT NULL,
    local_currency VARCHAR(3) NOT NULL,
    local_amount NUMERIC(15, 2) NOT NULL,
    hkd_amount NUMERIC(15, 2) NOT NULL,
    status pr_po_status DEFAULT 'PR_DRAFT',
    created_by UUID REFERENCES profiles(id),
    level_1_approver UUID REFERENCES profiles(id),
    level_2_approver UUID REFERENCES profiles(id),
    level_3_approver UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
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

-- Knowledge Base Vectors for RAG
CREATE TABLE knowledge_base_vectors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_title TEXT NOT NULL,
    section_reference TEXT,
    page_number INT,
    content TEXT NOT NULL,
    embedding vector(1536),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Immutable Audit Logs
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
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Immutable Audit RLS (INSERT allowed, UPDATE/DELETE blocked)
CREATE POLICY audit_insert_only ON audit_logs FOR INSERT WITH CHECK (true);
CREATE POLICY audit_select_admin ON audit_logs FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND role IN ('SUPER_ADMIN', 'DEPUTY_HEAD_OF_IT', 'FINANCE_AUDITOR'))
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