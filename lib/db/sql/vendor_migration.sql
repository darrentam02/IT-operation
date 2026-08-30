-- =====================================================================
-- Vendor Self-Service Portal ??non-destructive migration (idempotent)
--
-- Adds:
--   1. deliveries            ??vendor delivery / milestone-confirmation records
--   2. procurement_records   ??PO acceptance fields (po_accepted_at, po_acceptance_notes)
--   3. vendors.api_key_hash  ??hashed dedicated API keys for the 6 vendors
--   4. RLS (defense-in-depth)??vendor-role context function + scoped policies.
--
-- Security note: the api-server connects via the Supabase *service role* which
-- bypasses RLS, so vendor isolation is AUTHORITATIVELY enforced in the app layer
-- (every query is scoped to the authenticated vendor_id + its region). The RLS
-- policies below are defense-in-depth, applied only when the connection sets the
-- `app.vendor_id` context via `SET LOCAL`.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. deliveries table
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deliveries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    procurement_id UUID NOT NULL REFERENCES procurement_records(id) ON DELETE CASCADE,
    payment_schedule_id UUID REFERENCES payment_schedules(id) ON DELETE SET NULL,
    vendor_id UUID NOT NULL REFERENCES vendors(id),
    delivered_at TIMESTAMPTZ,
    qty NUMERIC(15,2),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (procurement_id, payment_schedule_id)
);

-- ---------------------------------------------------------------------
-- 2. PO acceptance columns on procurement_records
-- ---------------------------------------------------------------------
ALTER TABLE procurement_records
    ADD COLUMN IF NOT EXISTS po_accepted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS po_acceptance_notes TEXT;

-- ---------------------------------------------------------------------
-- 3. Vendor API-key context function + hashed key seeding
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION current_vendor_id() RETURNS uuid
LANGUAGE plpgsql STABLE AS
$$
BEGIN
    RETURN NULLIF(current_setting('app.vendor_id', true), '')::uuid;
EXCEPTION WHEN others THEN
    RETURN NULL;
END;
$$;

INSERT INTO vendors (id, vendor_name, region, api_key_hash)
VALUES
    ('20000000-0000-0000-0000-000000000001', 'Cerebrum Cloud Pte Ltd', 'MY'::region_code,
     encode(sha256('vk_demo_cerebrum'::bytea),'hex')),
    ('20000000-0000-0000-0000-000000000002', 'NexaNet HK Limited',      'HK'::region_code,
     encode(sha256('vk_demo_nexanet'::bytea),'hex')),
    ('20000000-0000-0000-0000-000000000003', 'Greenline Data Services', 'CN'::region_code,
     encode(sha256('vk_demo_greenline'::bytea),'hex')),
    ('20000000-0000-0000-0000-000000000004', 'Meridian Hardware Distrib','ID'::region_code,
     encode(sha256('vk_demo_meridian'::bytea),'hex')),
    ('20000000-0000-0000-0000-000000000005', 'Skybridge Security Pte Ltd','MY'::region_code,
     encode(sha256('vk_demo_skybridge'::bytea),'hex')),
    ('20000000-0000-0000-0000-000000000006', 'PacificWorks Telecom',    'HK'::region_code,
     encode(sha256('vk_demo_pacificworks'::bytea),'hex'))
ON CONFLICT (id) DO UPDATE SET api_key_hash = EXCLUDED.api_key_hash;

-- ---------------------------------------------------------------------
-- 4. RLS ??defense-in-depth vendor policies (context-gated)
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS vendor_self_portal ON vendors;
CREATE POLICY vendor_self_portal ON vendors FOR SELECT
    USING (current_vendor_id() IS NOT NULL AND id = current_vendor_id());

DROP POLICY IF EXISTS procurement_vendor_read ON procurement_records;
CREATE POLICY procurement_vendor_read ON procurement_records FOR SELECT
    USING (current_vendor_id() IS NOT NULL AND vendor_id = current_vendor_id());

DROP POLICY IF EXISTS payment_vendor_read ON payment_schedules;
CREATE POLICY payment_vendor_read ON payment_schedules FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM procurement_records pr
         WHERE pr.id = payment_schedules.procurement_id
           AND pr.vendor_id = current_vendor_id()
    ));

DROP POLICY IF EXISTS threeway_vendor_read ON three_way_matches;
CREATE POLICY threeway_vendor_read ON three_way_matches FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM procurement_records pr
         WHERE pr.id = three_way_matches.procurement_id
           AND pr.vendor_id = current_vendor_id()
    ));

DROP POLICY IF EXISTS delivery_vendor_all ON deliveries;
CREATE POLICY delivery_vendor_all ON deliveries FOR ALL
    USING (current_vendor_id() IS NOT NULL AND vendor_id = current_vendor_id());
