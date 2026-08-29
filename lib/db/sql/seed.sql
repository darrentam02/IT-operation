-- =====================================================================
-- IT Operations Control Tower - demo seed data
-- 8 teams, 12 profiles, 6 vendors across all 4 regions, procurement
-- records with frozen FX + 3-way approvers, cost allocations (100% sums),
-- payment schedules, FX reference rates, and initial audit logs.
--
-- The schema uses UUID primary keys throughout, so every referenced id
-- is an explicit UUID. Profile ids equal the real Supabase auth.users ids
-- created via the Auth Admin API (satisfies profiles.id -> auth.users(id)).
--
-- Guardrail B ordering: teams -> profiles -> backfill team_lead_id.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Teams (team_lead_id NULL for now, backfilled after profiles)
-- ---------------------------------------------------------------------
INSERT INTO teams (id, team_name) VALUES
  ('10000000-0000-0000-0000-000000000001', 'Infrastructure & Cloud'),
  ('10000000-0000-0000-0000-000000000002', 'Network & Security'),
  ('10000000-0000-0000-0000-000000000003', 'Service Desk'),
  ('10000000-0000-0000-0000-000000000004', 'Application Delivery'),
  ('10000000-0000-0000-0000-000000000005', 'Data & Analytics'),
  ('10000000-0000-0000-0000-000000000006', 'DevOps & Platform'),
  ('10000000-0000-0000-0000-000000000007', 'End-User Computing'),
  ('10000000-0000-0000-0000-000000000008', 'Enterprise Architecture');

-- ---------------------------------------------------------------------
-- 2. Profiles (id = real Supabase auth.users id)
--   Leah Chan       7937447c-090e-4248-885b-0798763e5994  SUPER_ADMIN
--   Marcus Wong     11b50e41-88e6-4297-bdba-6c76caf641ec  DEPUTY_HEAD_OF_IT
--   Priya Nair      57198c98-3a7b-4e16-b072-5c4c9dd31ffe  TEAM_LEAD
--   Tom Cheng       4866e1a2-aed7-4112-b9fe-bab59549aeb6  TEAM_LEAD
--   Aisha Rahman    0f4090eb-f2ee-4882-a439-6c16fb9ddeb6  TEAM_LEAD
--   Wei Lin         2d1a01a5-ec91-4e25-be93-d2a91003b743  TEAM_LEAD
--   Siti Halim      0ebb310c-b241-48b0-9254-7b78f7634676  FINANCE_AUDITOR
--   Ravi Menon      a531a015-8ad9-4a6e-b877-4606aef3d753  IT_COLLEAGUE
--   Grace Lim       cf6eb3c5-55c0-4e10-8332-344ec72c188f  IT_COLLEAGUE
--   Daniel Ho       dcc4575a-6f3a-4d08-a51c-efceac401d55  IT_COLLEAGUE
--   Nina Tan        246b7f07-8baa-406a-a7d3-817a979d2f23  IT_COLLEAGUE
--   Kenji Sato      bbb71b84-fd22-4f2c-ad96-2aa752300f4f  IT_COLLEAGUE
-- ---------------------------------------------------------------------
INSERT INTO profiles (id, full_name, role, team_id, region, deputy_for_user_id, on_leave) VALUES
  ('7937447c-090e-4248-885b-0798763e5994', 'Leah Chan',     'SUPER_ADMIN',       '10000000-0000-0000-0000-000000000001', 'HK', NULL,                                       FALSE),
  ('11b50e41-88e6-4297-bdba-6c76caf641ec', 'Marcus Wong',   'DEPUTY_HEAD_OF_IT', '10000000-0000-0000-0000-000000000001', 'HK', '7937447c-090e-4248-885b-0798763e5994', FALSE),
  ('57198c98-3a7b-4e16-b072-5c4c9dd31ffe', 'Priya Nair',    'TEAM_LEAD',         '10000000-0000-0000-0000-000000000002', 'HK', NULL, FALSE),
  ('4866e1a2-aed7-4112-b9fe-bab59549aeb6', 'Tom Cheng',     'TEAM_LEAD',         '10000000-0000-0000-0000-000000000003', 'HK', NULL, FALSE),
  ('0f4090eb-f2ee-4882-a439-6c16fb9ddeb6', 'Aisha Rahman',  'TEAM_LEAD',         '10000000-0000-0000-0000-000000000004', 'MY', NULL, FALSE),
  ('2d1a01a5-ec91-4e25-be93-d2a91003b743', 'Wei Lin',       'TEAM_LEAD',         '10000000-0000-0000-0000-000000000005', 'CN', NULL, FALSE),
  ('0ebb310c-b241-48b0-9254-7b78f7634676', 'Siti Halim',    'FINANCE_AUDITOR',   NULL, 'MY', NULL, FALSE),
  ('a531a015-8ad9-4a6e-b877-4606aef3d753', 'Ravi Menon',    'IT_COLLEAGUE',      '10000000-0000-0000-0000-000000000001', 'HK', NULL, FALSE),
  ('cf6eb3c5-55c0-4e10-8332-344ec72c188f', 'Grace Lim',     'IT_COLLEAGUE',      '10000000-0000-0000-0000-000000000002', 'HK', NULL, FALSE),
  ('dcc4575a-6f3a-4d08-a51c-efceac401d55', 'Daniel Ho',     'IT_COLLEAGUE',      '10000000-0000-0000-0000-000000000003', 'HK', NULL, FALSE),
  ('246b7f07-8baa-406a-a7d3-817a979d2f23', 'Nina Tan',      'IT_COLLEAGUE',      '10000000-0000-0000-0000-000000000004', 'MY', NULL, FALSE),
  ('bbb71b84-fd22-4f2c-ad96-2aa752300f4f', 'Kenji Sato',    'IT_COLLEAGUE',      '10000000-0000-0000-0000-000000000005', 'ID', NULL, FALSE);

-- ---------------------------------------------------------------------
-- 3. Backfill team leads (guardrail B)
-- ---------------------------------------------------------------------
UPDATE teams SET team_lead_id = '7937447c-090e-4248-885b-0798763e5994' WHERE id = '10000000-0000-0000-0000-000000000001';
UPDATE teams SET team_lead_id = '57198c98-3a7b-4e16-b072-5c4c9dd31ffe' WHERE id = '10000000-0000-0000-0000-000000000002';
UPDATE teams SET team_lead_id = '4866e1a2-aed7-4112-b9fe-bab59549aeb6' WHERE id = '10000000-0000-0000-0000-000000000003';
UPDATE teams SET team_lead_id = '0f4090eb-f2ee-4882-a439-6c16fb9ddeb6' WHERE id = '10000000-0000-0000-0000-000000000004';
UPDATE teams SET team_lead_id = '2d1a01a5-ec91-4e25-be93-d2a91003b743' WHERE id = '10000000-0000-0000-0000-000000000005';

-- ---------------------------------------------------------------------
-- 4. Vendors across all 4 regions (explicit UUID ids)
-- ---------------------------------------------------------------------
INSERT INTO vendors (id, vendor_name, region, contact, payment_terms, tax_id) VALUES
  ('20000000-0000-0000-0000-000000000001', 'Cerebrum Cloud Pte Ltd',      'MY', 'ops@cerebrum.io',            'NET 30', 'MY-998877'),
  ('20000000-0000-0000-0000-000000000002', 'NexaNet HK Limited',          'HK', 'billing@nexanet.hk',         'NET 15', 'HK-12345678'),
  ('20000000-0000-0000-0000-000000000003', 'Greenline Data Services',     'CN', 'sales@greenline.cn',         'NET 60', 'CN-445566'),
  ('20000000-0000-0000-0000-000000000004', 'Meridian Hardware Distrib',   'ID', 'ap@meridian-hardware.co.id', 'NET 30', 'ID-778899'),
  ('20000000-0000-0000-0000-000000000005', 'Skybridge Security Pte Ltd',  'MY', 'contact@skybridge.my',        'NET 45', 'MY-112233'),
  ('20000000-0000-0000-0000-000000000006', 'PacificWorks Telecom',        'HK', 'finance@pacificworks.hk',     'NET 15', 'HK-87654321');

-- ---------------------------------------------------------------------
-- 5. Budget Lines (2026 IT Budget — allocated, incurred, paid)
-- ---------------------------------------------------------------------
INSERT INTO budget_lines (id, fiscal_year, category, description, allocated_amount, incurred_amount, paid_amount, created_by) VALUES
  ('40000000-0000-0000-0000-000000000001', 2026, 'HARDWARE', 'Server/Storage/Network refresh',  5000000, 0, 0, '7937447c-090e-4248-885b-0798763e5994'),
  ('40000000-0000-0000-0000-000000000002', 2026, 'SOFTWARE', 'SaaS licences / subscriptions',   3000000, 0, 0, '7937447c-090e-4248-885b-0798763e5994'),
  ('40000000-0000-0000-0000-000000000003', 2026, 'DATA',     'Data platform / analytics',       2000000, 0, 0, '7937447c-090e-4248-885b-0798763e5994'),
  ('40000000-0000-0000-0000-000000000004', 2026, 'SERVICES', 'Professional services / support', 1500000, 0, 0, '7937447c-090e-4248-885b-0798763e5994');

-- ---------------------------------------------------------------------
-- 6. Procurement records (frozen FX + tiered approvers; explicit UUIDs + budget_line_id)
-- ---------------------------------------------------------------------
INSERT INTO procurement_records
  (id, pr_number, po_number, vendor_id, budget_line_id, region, local_currency, local_amount, hkd_amount, fx_rate, status,
    created_by, level_1_approver, level_2_approver, level_3_approver)
VALUES
  ('30000000-0000-0000-0000-000000000001', 'PR-2026-0001', 'PO-2026-0101', '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'MY', 'MYR', 420000, 700000, 1.6667, 'PO_ISSUED',
    '7937447c-090e-4248-885b-0798763e5994', '57198c98-3a7b-4e16-b072-5c4c9dd31ffe', '0ebb310c-b241-48b0-9254-7b78f7634676', NULL),
  ('30000000-0000-0000-0000-000000000002', 'PR-2026-0002', 'PO-2026-0102', '20000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', 'HK', 'HKD', 185000, 185000, 1.0000, 'PR_APPROVED',
    '7937447c-090e-4248-885b-0798763e5994', '57198c98-3a7b-4e16-b072-5c4c9dd31ffe', NULL, NULL),
  ('30000000-0000-0000-0000-000000000003', 'PR-2026-0003', NULL,            '20000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000001', 'ID', 'IDR', 9800000000, 2000000, 0.0002041, 'VARIANCE_BLOCKED',
    '7937447c-090e-4248-885b-0798763e5994', '57198c98-3a7b-4e16-b072-5c4c9dd31ffe', '0ebb310c-b241-48b0-9254-7b78f7634676', NULL);

-- ---------------------------------------------------------------------
-- 7. Cost allocations (each procurement sums to 100%)
-- ---------------------------------------------------------------------
INSERT INTO cost_allocations (procurement_id, business_unit, percentage_share) VALUES
  ('30000000-0000-0000-0000-000000000001', 'Enterprise Platform', 40),
  ('30000000-0000-0000-0000-000000000001', 'Regional Operations', 35),
  ('30000000-0000-0000-0000-000000000001', 'Cloud Enablement',    25),
  ('30000000-0000-0000-0000-000000000002', 'Network Services',    100),
  ('30000000-0000-0000-0000-000000000003', 'Hardware Refresh',    60),
  ('30000000-0000-0000-0000-000000000003', 'End-User Computing',  40);

-- ---------------------------------------------------------------------
-- 8. Payment schedules
-- ---------------------------------------------------------------------
INSERT INTO payment_schedules (procurement_id, due_date, amount, is_variance_detected) VALUES
  ('30000000-0000-0000-0000-000000000001', '2026-09-15', 280000,  FALSE),
  ('30000000-0000-0000-0000-000000000001', '2026-12-15', 420000,  FALSE),
  ('30000000-0000-0000-0000-000000000002', '2026-08-30', 185000,  FALSE),
  ('30000000-0000-0000-0000-000000000003', '2026-09-01', 2000000, TRUE);

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
-- 9. Initial audit log entries (immutable - INSERT only)
-- ---------------------------------------------------------------------
INSERT INTO audit_logs (actor_id, action_type, target_resource, new_value, acted_as_deputy) VALUES
  ('7937447c-090e-4248-885b-0798763e5994', 'LOGIN', 'auth', '{"provider":"email"}', FALSE),
  ('7937447c-090e-4248-885b-0798763e5994', 'PROCUREMENT_CREATED', 'procurement_records', '{"pr":"PR-2026-0001"}', FALSE);

-- =====================================================================
-- Seed note (guardrail F - 2FA): after creating auth users, enable TOTP
-- per user. The API enforces the second factor before opening the UI.
-- =====================================================================
