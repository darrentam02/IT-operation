-- =========================================================================
-- DEPUTY DELEGATION - date-windowed, pg_cron reconciled
-- Target : live Supabase project afqpyyahglavelgoetqq (darrentam02 phase-2)
-- Purpose: replace the buggy boolean on_leave trigger with deterministic
--          date-windowed activation + clean, reversible de-activation.
-- Driver : profiles.leave_start_date / leave_end_date (+ reversible base_role)
-- Note   : requires the pg_cron extension (created separately).
-- Idempotent: safe to re-run.
-- =========================================================================

BEGIN;

-- 1) Date-windowed leave + reversible base role columns
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS leave_start_date DATE,
  ADD COLUMN IF NOT EXISTS leave_end_date   DATE,
  ADD COLUMN IF NOT EXISTS base_role        user_role;

-- 2) Remove the legacy boolean-flip trigger + function (inverted, no exit)
DROP TRIGGER IF EXISTS trg_deputy_on_leave ON profiles;
DROP FUNCTION IF EXISTS activate_deputy_on_leave();

-- 3) Reconciliation state machine (idempotent over date windows)
CREATE OR REPLACE FUNCTION reconcile_deputy_delegation()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  deputy RECORD;
  principal_id uuid;
  w_start DATE;
  w_end   DATE;
  on_leave_now BOOLEAN;
BEGIN
  FOR deputy IN
    SELECT p.id            AS deputy_id,
           p.role          AS deputy_role,
           p.base_role     AS base_role,
           p.deputy_for_user_id AS principal_id
      FROM profiles p
     WHERE p.deputy_for_user_id IS NOT NULL
  LOOP
    principal_id := deputy.principal_id;
    -- when no matching principal profile, w_start/w_end are NULL -> off leave
    SELECT leave_start_date, leave_end_date INTO w_start, w_end
      FROM profiles WHERE id = principal_id;

    on_leave_now := w_start IS NOT NULL
                    AND CURRENT_DATE >= w_start
                    AND CURRENT_DATE <= COALESCE(w_end, w_start);

    IF on_leave_now THEN
      -- ACTIVATE only on a role transition (avoids audit spam each run)
      IF deputy.deputy_role IS DISTINCT FROM 'DEPUTY_HEAD_OF_IT' THEN
        IF deputy.base_role IS NULL THEN
          UPDATE profiles SET base_role = deputy.deputy_role
           WHERE id = deputy.deputy_id;
        END IF;
        UPDATE profiles SET role = 'DEPUTY_HEAD_OF_IT'
         WHERE id = deputy.deputy_id;
        INSERT INTO audit_logs (actor_id, action_type, target_resource, new_value, acted_as_deputy)
        VALUES (principal_id, 'DEPUTY_ACTIVATED', 'profiles',
                jsonb_build_object(
                  'deputy', deputy.deputy_id,
                  'from',   to_char(w_start, 'YYYY-MM-DD'),
                  'to',     to_char(COALESCE(w_end, w_start), 'YYYY-MM-DD')
                ), TRUE);
      END IF;
    ELSE
      -- DE-ACTIVATE only if we promoted them (base_role is set)
      IF deputy.deputy_role = 'DEPUTY_HEAD_OF_IT' AND deputy.base_role IS NOT NULL THEN
        UPDATE profiles SET role = deputy.base_role, base_role = NULL
         WHERE id = deputy.deputy_id;
        INSERT INTO audit_logs (actor_id, action_type, target_resource, new_value, acted_as_deputy)
        VALUES (principal_id, 'DEPUTY_DEACTIVATED', 'profiles',
                jsonb_build_object('deputy', deputy.deputy_id, 'restored', deputy.base_role), TRUE);
      END IF;
    END IF;
  END LOOP;
END;
$$;

-- 4) Apply once now (in case a leave window is already active)
SELECT reconcile_deputy_delegation();

-- 5) Schedule via pg_cron (idempotent), when the extension is present.
--    Also registers the pre-existing mark-stale-staff job (was never scheduled).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'deputy-delegation') THEN
      PERFORM cron.unschedule('deputy-delegation');
    END IF;
    PERFORM cron.schedule('deputy-delegation', '*/5 * * * *', $cron$SELECT reconcile_deputy_delegation()$cron$);
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mark-stale-staff') THEN
      PERFORM cron.schedule('mark-stale-staff', '*/15 * * * *', $cron$SELECT mark_stale_staff()$cron$);
    END IF;
  END IF;
END $$;

COMMIT;