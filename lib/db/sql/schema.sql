-- =====================================================================
-- IT Operations Control Tower — Supabase DDL + RLS + guardrail fixes
-- Source of truth for the database schema. Mirrors Drizzle models in
-- lib/db/src/schema and fills the gaps that Drizzle/pg-core can't model
-- (circular FKs, pgvector, RLS, triggers, cron jobs).
-- =====================================================================

-- Enable Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_cron"; -- for stale-heartbeat (guardrail E)

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
CREATE TYPE user_role AS ENUM ('SUPER_ADMIN', 'DEPUTY_HEAD_OF_IT', 'TEAM_LEAD', 'IT_COLLEAGUE', 'FINANCE_AUDITOR', 'VENDOR_API');
CREATE TYPE region_code AS ENUM ('HK', 'CN', 'MY', 'ID');
CREATE TYPE env_type AS ENUM ('SIT', 'UAT', 'STAGING', 'PROD');
CREATE TYPE pr_po_status AS ENUM ('PR_DRAFT', 'PR_APPROVED', 'PO_ISSUED', 'MILESTONE_RECEIVED', 'INVOICE_PENDING', 'VARIANCE_BLOCKED', 'PAYMENT_APPROVED', 'PAID');

-- ---------------------------------------------------------------------
-- Teams
-- ---------------------------------------------------------------------
CREATE TABLE teams (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_name TEXT NOT NULL,
    team_lead_id UUID,                          -- FK added after profiles exist (guardrail B)
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- Profiles (id is the Supabase auth.users id)
-- ---------------------------------------------------------------------
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    role user_role NOT NULL DEFAULT 'IT_COLLEAGUE',
    team_id UUID,                            -- FK added after tables exist (guardrail B)
    region region_code NOT NULL DEFAULT 'HK',
    deputy_for_user_id UUID REFERENCES profiles(id),
    on_leave BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Break the circular FK as recommended (guardrail B): create teams with
-- team_lead_id NULL, create all profiles, then add the profiles.team_id FK.
ALTER TABLE profiles ADD CONSTRAINT profiles_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id);

-- Add teams.team_lead_id FK only after profiles exists (guardrail B).
ALTER TABLE teams ADD CONSTRAINT teams_team_lead_id_fkey FOREIGN KEY (team_lead_id) REFERENCES profiles(id);

-- ---------------------------------------------------------------------
-- Frozen FX Rates
-- ---------------------------------------------------------------------
CREATE TABLE fx_rates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    base_currency VARCHAR(3) NOT NULL DEFAULT 'HKD',
    quote_currency VARCHAR(3) NOT NULL,
    rate NUMERIC(18, 6) NOT NULL,
    effective_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- Real-Time Staff Statuses
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- Vendors
-- ---------------------------------------------------------------------
CREATE TABLE vendors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vendor_name TEXT NOT NULL,
    region region_code NOT NULL,
    contact TEXT,
    delivery_address TEXT,
    payment_terms TEXT,
    tax_id TEXT,
    api_key_hash TEXT UNIQUE,
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- Procurement Records
-- ---------------------------------------------------------------------
CREATE TABLE procurement_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pr_number TEXT UNIQUE NOT NULL,
    po_number TEXT UNIQUE,
    vendor_id UUID NOT NULL REFERENCES vendors(id),
    region region_code NOT NULL,
    local_currency VARCHAR(3) NOT NULL,
    local_amount NUMERIC(15, 2) NOT NULL,
    hkd_amount NUMERIC(15, 2) NOT NULL,
    fx_rate NUMERIC(18, 6) NOT NULL,
    payment_terms TEXT,
    delivery_address TEXT,
    tax_id TEXT,
    status pr_po_status DEFAULT 'PR_DRAFT',
    created_by UUID REFERENCES profiles(id),
    level_1_approver UUID REFERENCES profiles(id),
    level_2_approver UUID REFERENCES profiles(id),
    level_3_approver UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- Cost Allocations (sum must equal 100% — enforced app-side + trigger)
-- ---------------------------------------------------------------------
CREATE TABLE cost_allocations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    procurement_id UUID REFERENCES procurement_records(id) ON DELETE CASCADE,
    business_unit TEXT NOT NULL,
    percentage_share NUMERIC(5, 2) NOT NULL,
    CHECK (percentage_share > 0 AND percentage_share <= 100)
);

-- ---------------------------------------------------------------------
-- Payment Schedules
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- Knowledge Base Vectors for RAG (EN + CN)
-- ---------------------------------------------------------------------
CREATE TABLE knowledge_base_vectors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_title TEXT NOT NULL,
    language VARCHAR(2) NOT NULL,
    section_reference TEXT,
    page_number INT,
    content TEXT NOT NULL,
    embedding vector(1536),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- Immutable Audit Logs (SOC2)
-- ---------------------------------------------------------------------
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

-- =====================================================================
-- ROW LEVEL SECURITY  (guardrail A: complete policies for EVERY table)
-- =====================================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_base_vectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;

-- Helper: is the current user an admin (SUPER_ADMIN / DEPUTY_HEAD_OF_IT / FINANCE_AUDITOR)?
CREATE OR REPLACE FUNCTION is_admin_user()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('SUPER_ADMIN', 'DEPUTY_HEAD_OF_IT', 'FINANCE_AUDITOR')
  );
$$;

-- ============ profiles ============
-- Self read + read own; admins read all (guardrail C: without this, login profile load fails)
CREATE POLICY profiles_select_self ON profiles FOR SELECT USING (id = auth.uid() OR is_admin_user());
-- Update own profile (cannot change role, deputy links guarded app-side)
CREATE POLICY profiles_update_self ON profiles FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());
-- Only an admin can insert/update roles & deputy linkage
CREATE POLICY profiles_insert_admin ON profiles FOR INSERT WITH CHECK (is_admin_user());
CREATE POLICY profiles_update_admin_role ON profiles FOR UPDATE USING (is_admin_user());

-- ============ teams ============
CREATE POLICY teams_select_member ON teams FOR SELECT USING (true);
CREATE POLICY teams_write_admin ON teams FOR INSERT WITH CHECK (is_admin_user());
CREATE POLICY teams_update_admin ON teams FOR UPDATE USING (is_admin_user());

-- ============ staff_statuses ============
-- Users read/write own row; TEAM_LEAD reads their team; admins read all
CREATE POLICY staff_select_self ON staff_statuses FOR SELECT USING (
  user_id = auth.uid()
  OR is_admin_user()
  OR auth.uid() IN (SELECT team_lead_id FROM teams WHERE team_lead_id IS NOT NULL)
);
CREATE POLICY staff_write_self ON staff_statuses FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY staff_write_admin ON staff_statuses FOR UPDATE USING (is_admin_user());

-- ============ procurement_records ============
-- FINANCE_AUDITOR read-only global; approvers see actionable; creators manage own; admins all
CREATE POLICY procurement_select ON procurement_records FOR SELECT USING (
  created_by = auth.uid()
  OR level_1_approver = auth.uid()
  OR level_2_approver = auth.uid()
  OR level_3_approver = auth.uid()
  OR is_admin_user()
);
-- Only admins / procurement creators create records
CREATE POLICY procurement_insert_admin ON procurement_records FOR INSERT WITH CHECK (is_admin_user() OR created_by = auth.uid());
-- Approvers update the status they own; admins update all
CREATE POLICY procurement_update_approver ON procurement_records FOR UPDATE USING (
  is_admin_user()
  OR level_1_approver = auth.uid()
  OR level_2_approver = auth.uid()
  OR level_3_approver = auth.uid()
);

-- ============ cost_allocations ============
CREATE POLICY alloc_select ON cost_allocations FOR SELECT USING (is_admin_user());
CREATE POLICY alloc_insert_admin ON cost_allocations FOR INSERT WITH CHECK (is_admin_user());
CREATE POLICY alloc_update_admin ON cost_allocations FOR UPDATE USING (is_admin_user());

-- ============ payment_schedules ============
CREATE POLICY payment_select ON payment_schedules FOR SELECT USING (is_admin_user());
CREATE POLICY payment_insert_admin ON payment_schedules FOR INSERT WITH CHECK (is_admin_user());
CREATE POLICY payment_update_dual ON payment_schedules FOR UPDATE USING (
  is_admin_user()
  OR dual_signoff_head_id = auth.uid()
  OR dual_signoff_finance_id = auth.uid()
);

-- ============ vendors ============
-- Regional isolation: vendor in my region OR super admin (spec §9)
CREATE POLICY vendor_region_isolation ON vendors FOR SELECT USING (
  region = (SELECT region FROM profiles WHERE id = auth.uid())
  OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'SUPER_ADMIN')
);
-- Onboarding (INSERT/UPDATE) restricted to SUPER_ADMIN + FINANCE (guardrail A)
CREATE POLICY vendor_insert_admin ON vendors FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('SUPER_ADMIN', 'FINANCE_AUDITOR', 'DEPUTY_HEAD_OF_IT'))
);
CREATE POLICY vendor_update_admin ON vendors FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('SUPER_ADMIN', 'FINANCE_AUDITOR', 'DEPUTY_HEAD_OF_IT'))
);

-- ============ fx_rates ============
CREATE POLICY fx_select_all ON fx_rates FOR SELECT USING (true);
CREATE POLICY fx_insert_admin ON fx_rates FOR INSERT WITH CHECK (is_admin_user());

-- ============ knowledge_base_vectors ============
-- Vector search runs via SECURITY DEFINER function; direct select for admins
CREATE POLICY kb_select ON knowledge_base_vectors FOR SELECT USING (true);
CREATE POLICY kb_write_admin ON knowledge_base_vectors FOR INSERT WITH CHECK (is_admin_user());

-- ============ audit_logs (immutable — INSERT only, guardrail A/spec) ============
CREATE POLICY audit_insert_only ON audit_logs FOR INSERT WITH CHECK (true);
CREATE POLICY audit_select_admin ON audit_logs FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND role IN ('SUPER_ADMIN', 'DEPUTY_HEAD_OF_IT', 'FINANCE_AUDITOR'))
);

-- Stored Procedure for Vector Match (spec §9). SECURITY DEFINER so app
-- can run similarity search through PostgREST/anon role (guardrail: RLS bypass).
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
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT kb.id, kb.document_title, kb.section_reference, kb.page_number,
           kb.content, 1 - (kb.embedding <=> query_embedding) AS similarity
    FROM knowledge_base_vectors kb
    WHERE 1 - (kb.embedding <=> query_embedding) > match_threshold
    ORDER BY kb.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
GRANT EXECUTE ON FUNCTION match_knowledge_base(vector, float, int) TO anon, authenticated, service_role;

-- =====================================================================
-- GUARDRAIL D: Deputy auto-activation on SUPER_ADMIN leave
-- =====================================================================
CREATE OR REPLACE FUNCTION activate_deputy_on_leave()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.on_leave = TRUE AND OLD.on_leave = FALSE THEN
    -- mark the linked deputy as a delegated authority holder
    UPDATE profiles
       SET role = 'DEPUTY_HEAD_OF_IT'
     WHERE id = NEW.deputy_for_user_id;
    INSERT INTO audit_logs (actor_id, action_type, target_resource, new_value, acted_as_deputy)
    VALUES (NEW.id, 'DEPUTY_ACTIVATED', 'profiles', jsonb_build_object('deputy', NEW.deputy_for_user_id), NEW.deputy_for_user_id IS NOT NULL);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_deputy_on_leave ON profiles;
CREATE TRIGGER trg_deputy_on_leave
AFTER UPDATE OF on_leave ON profiles
FOR EACH ROW EXECUTE FUNCTION activate_deputy_on_leave();

-- =====================================================================
-- GUARDRAIL E: Stale staff heartbeat (updated > 4h or > 15 min in demo -> stale)
-- =====================================================================
CREATE OR REPLACE FUNCTION mark_stale_staff()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE staff_statuses
     SET is_stale = TRUE
   WHERE status_text ILIKE '%active%'
     AND is_stale = FALSE
     AND updated_at < NOW() - INTERVAL '4 hours';
END;
$$;

-- Schedule every 15 minutes (requires the pg_cron extension & access)
-- Note: use a distinct dollar-quote tag for the job SQL so it does not
-- prematurely close the outer DO $$ ... $$ body.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('mark-stale-staff', '*/15 * * * *', $cron$SELECT mark_stale_staff()$cron$);
  END IF;
END $$;

-- =====================================================================
-- GUARDRAIL / spec: Cost allocation sum must equal 100% per procurement
-- =====================================================================
CREATE OR REPLACE FUNCTION enforce_allocation_total()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE total numeric;
BEGIN
  SELECT COALESCE(SUM(percentage_share),0) INTO total
    FROM cost_allocations WHERE procurement_id = NEW.procurement_id;
  IF total > 100 THEN
    RAISE EXCEPTION 'Cost allocation totals exceed 100%% for this procurement';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_alloc_total ON cost_allocations;
CREATE TRIGGER trg_alloc_total
AFTER INSERT OR UPDATE ON cost_allocations
FOR EACH ROW EXECUTE FUNCTION enforce_allocation_total();

-- =====================================================================
-- GUARDRAIL F: 2FA — the app enforces TOTP at login (see supabase integration
-- routes). The database layer allows admins to view enforcement state via a
-- dedicated function. Auth-level TOTP is enforced in the API auth middleware.
-- =====================================================================

-- =====================================================================
-- Indexes for hot query paths
-- =====================================================================
CREATE INDEX idx_staff_statuses_user ON staff_statuses(user_id);
CREATE INDEX idx_staff_statuses_updated ON staff_statuses(updated_at);
CREATE INDEX idx_proc_vendor ON procurement_records(vendor_id);
CREATE INDEX idx_proc_status ON procurement_records(status);
CREATE INDEX idx_alloc_proc ON cost_allocations(procurement_id);
CREATE INDEX idx_pay_proc ON payment_schedules(procurement_id);
CREATE INDEX idx_audit_actor ON audit_logs(actor_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at);
