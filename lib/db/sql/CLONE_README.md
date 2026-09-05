# Supabase Clone (for a new/phase-2 project)

`clone_supabase.sql` is a full snapshot of the **live production database**,
exported with `pg_dump` (schema + data + RLS + triggers + functions + enums).
It recreates the 14 public tables with their exact current data, including the
vendor portal additions (`deliveries`, `po_accepted_at`, `api_key_hash`).

## How to apply it to a NEW Supabase project

The web SQL Editor in the Supabase dashboard **cannot** run `COPY ... FROM stdin`,
so apply the file with `psql` against the new project's connection string:

```sh
psql "postgresql://postgres.<ref>.<region>.pooler.supabase.com:5432/postgres" \
  -f clone_supabase.sql
```

(or run it as the DB owner via the Dashboard > SQL Editor if your project
version has restored `psql` support; otherwise use the CLI:

```sh
supabase db push
# or for a one-off:
psql "$DATABASE_URL" -f clone_supabase.sql
```

You must be the **postgres / owner role** (bypass RLS) so that rows and policies
restore cleanly.

## Important: auth.users caveat

`public.profiles.id` is a foreign key to `auth.users(id)`. The dump contains the
**public** schema only — `auth` is managed by your new Supabase Auth. After
restoring you need the same users to exist in `auth.users`, otherwise:

- The `profiles` rows (12 staff) will not restore (FK violation), or
- RLS lookups (`auth.uid()`) won't match the profile rows.

Two options:

1. **Recreate the same auth users first** with their original UUIDs
   (use the Admin API / a DB script that inserts into `auth.users` with the
   matching `id`). Then restore profiles succeeds and everything lines up.
2. **For pure UI/dev work**, drop the FK temporarily
   (`ALTER TABLE public.profiles DROP CONSTRAINT profiles_id_fkey;`), restore,
   and re-map profile IDs to newly-created auth users afterward.

## Contents

- 7 enum types (`budget_category`, `region_code`, `pr_po_status`, ...)
- 13 app functions (`validate_three_way_match`, `match_knowledge_base`, ...)
- 14 tables: `teams`, `profiles`, `vendors`, `budget_lines`, `procurement_records`,
  `payment_schedules`, `three_way_matches`, `cost_allocations`, `fx_rates`,
  `deliveries`, `audit_logs`, `dlq_entries`, `knowledge_base_vectors`, `staff_statuses`
- Indexes, triggers, RLS policies, and current data for all tables.

## Required Supabase extensions

The top of the file enables `uuid-ossp`, `pgcrypto`, and `vector` (pgvector),
which Supabase provides by default. `pg_cron`, `supabase_vault`, and
`pg_stat_statements` are part of the standard Supabase install.
