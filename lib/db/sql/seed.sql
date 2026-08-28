-- =====================================================================
-- IT Operations Control Tower — demo seed data
-- 8 teams, 8 business units, sample vendors across all 4 regions.
-- Guardrail B ordering: teams -> profiles -> backfill team_lead_id.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Teams (team_lead_id NULL for now — backfilled after profiles)
-- ---------------------------------------------------------------------
INSERT INTO teams (team_name) VALUES
  ('Infrastructure & Cloud'),
  ('Network & Security'),
  ('Service Desk'),
  ('Application Delivery'),
  ('Data & Analytics'),
  ('DevOps & Platform'),
  ('End-User Computing'),
  ('Enterprise Architecture');

-- ---------------------------------------------------------------------
-- 2. Profiles — linked to Supabase auth.users. In a live run these ids
--    MUST be the real auth.users ids for your seeded login accounts.
--    Placeholder fixed UUIDs are used for idempotent demo seed; replace
--    with the actual auth user ids after creating users in Auth.
-- ---------------------------------------------------------------------
INSERT INTO profiles (id, full_name, role, team_id, region, deputy_for_user_id, on_leave) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Leah Chan',     'SUPER_ADMIN',     1, 'HK', NULL,                            FALSE),
  ('00000000-0000-0000-0000-000000000002', 'Marcus Wong',   'DEPUTY_HEAD_OF_IT',1, 'HK', '00000000-0000-0000-0000-000000000001', FALSE),
  ('00000000-0000-0000-0000-000000000003', 'Priya Nair',    'TEAM_LEAD',       2, 'HK', NULL, FALSE),
  ('00000000-0000-0000-0000-000000000004', 'Tom Cheng',     'TEAM_LEAD',       3, 'HK', NULL, FALSE),
  ('00000000-0000-0000-0000-000000000005', 'Aisha Rahman',  'TEAM_LEAD',       4, 'MY', NULL, FALSE),
  ('00000000-0000-0000-0000-000000000006', 'Wei Lin',       'TEAM_LEAD',       5, 'CN', NULL, FALSE),
  ('00000000-0000-0000-0000-000000000007', 'Siti Halim',    'FINANCE_AUDITOR', NULL, 'MY', NULL, FALSE),
  ('00000000-0000-0000-0000-000000000008', 'Ravi Menon',    'IT_COLLEAGUE',    1, 'HK', NULL, FALSE),
  ('00000000-0000-0000-0000-000000000009', 'Grace Lim',     'IT_COLLEAGUE',    2, 'HK', NULL, FALSE),
  ('00000000-0000-0000-0000-00000000000a', 'Daniel Ho',     'IT_COLLEAGUE',    3, 'HK', NULL, FALSE),
  ('00000000-0000-0000-0000-00000000000b', 'Nina Tan',      'IT_COLLEAGUE',    4, 'MY', NULL, FALSE),
  ('00000000-0000-0000-0000-00000000000c', 'Kenji Sato',    'IT_COLLEAGUE',    5, 'ID', NULL, FALSE);

-- ---------------------------------------------------------------------
-- 3. Backfill team leads (guardrail B)
-- ---------------------------------------------------------------------
UPDATE teams SET team_lead_id = '00000000-0000-0000-0000-000000000001' WHERE id = 1;
UPDATE teams SET team_lead_id = '00000000-0000-0000-0000-000000000003' WHERE id = 2;
UPDATE teams SET team_lead_id = '00000000-0000-0000-0000-000000000004' WHERE id = 3;
UPDATE teams SET team_lead_id = '00000000-0000-0000-0000-000000000005' WHERE id = 4;
UPDATE teams SET team_lead_id = '00000000-0000-0000-0000-000000000006' WHERE id = 5;

-- ---------------------------------------------------------------------
-- 4. Vendors across all 4 regions
-- ---------------------------------------------------------------------
INSERT INTO vendors (vendor_name, region, contact, payment_terms, tax_id) VALUES
  ('Cerebrum Cloud Pte Ltd',      'MY', 'ops@cerebrum.io',            'NET 30',   'MY-998877'),
  ('NexaNet HK Limited',          'HK', 'billing@nexanet.hk',         'NET 15',   'HK-12345678'),
  ('Greenline Data Services',     'CN', 'sales@greenline.cn',         'NET 60',   'CN-445566'),
  ('Meridian Hardware Distrib',   'ID', 'ap@meridian-hardware.co.id', 'NET 30',   'ID-778899'),
  ('Skybridge Security Pte Ltd',  'MY', 'contact@skybridge.my',        'NET 45',   'MY-112233'),
  ('PacificWorks Telecom',        'HK', 'finance@pacificworks.hk',    'NET 15',   'HK-87654321');

-- ---------------------------------------------------------------------
-- 5. Procurement records (with frozen FX + level approvers)
-- ---------------------------------------------------------------------
INSERT INTO procurement_records
  (pr_number, po_number, vendor_id, region, local_currency, local_amount, hkd_amount, fx_rate, status,
   created_by, level_1_approver, level_2_approver, level_3_approver)
VALUES
  ('PR-2026-0001', 'PO-2026-0101', 1, 'MY', 'MYR', 420000, 700000, 1.6667, 'PO_ISSUED',
   '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000007', NULL),
  ('PR-2026-0002', 'PO-2026-0102', 2, 'HK', 'HKD', 185000, 185000, 1.0000, 'PR_APPROVED',
   '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', NULL, NULL),
  ('PR-2026-0003', NULL, 4, 'ID', 'IDR', 9800000000, 2000000, 0.0002041, 'VARIANCE_BLOCKED',
   '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000007', NULL);

-- ---------------------------------------------------------------------
-- 6. Cost allocations (each sum to 100%)
-- ---------------------------------------------------------------------
INSERT INTO cost_allocations (procurement_id, business_unit, percentage_share) VALUES
  (1, 'Enterprise Platform', 40),
  (1, 'Regional Operations', 35),
  (1, 'Cloud Enablement',    25),
  (2, 'Network Services',    100),
  (3, 'Hardware Refresh',    60),
  (3, 'End-User Computing',  40);

-- ---------------------------------------------------------------------
-- 7. Payment schedules
-- ---------------------------------------------------------------------
INSERT INTO payment_schedules (procurement_id, due_date, amount, is_variance_detected) VALUES
  (1, '2026-09-15', 280000, FALSE),
  (1, '2026-12-15', 420000, FALSE),
  (2, '2026-08-30', 185000, FALSE),
  (3, '2026-09-01', 2000000, TRUE);

-- ---------------------------------------------------------------------
-- 8. FX reference rates
-- ---------------------------------------------------------------------
INSERT INTO fx_rates (base_currency, quote_currency, rate) VALUES
  ('HKD', 'MYR', 0.5999),
  ('HKD', 'CNY', 0.9250),
  ('HKD', 'IDR', 4900.0000),
  ('HKD', 'SGD', 0.1720),
  ('HKD', 'USD', 0.1278);

-- ---------------------------------------------------------------------
-- 9. Initial audit log entries
-- ---------------------------------------------------------------------
INSERT INTO audit_logs (actor_id, action_type, target_resource, new_value, acted_as_deputy) VALUES
  ('00000000-0000-0000-0000-000000000001', 'LOGIN', 'auth', '{"provider":"email"}', FALSE),
  ('00000000-0000-0000-0000-000000000001', 'PROCUREMENT_CREATED', 'procurement_records', '{"pr":"PR-2026-0001"}', FALSE);

-- =====================================================================
-- Seed note (guardrail F — 2FA): after creating auth users, enable TOTP
-- per user. The API enforces the second factor before opening the UI.
-- =====================================================================
