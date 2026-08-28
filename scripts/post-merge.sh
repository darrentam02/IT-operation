#!/bin/bash
set -e

# Install workspace dependencies only.
#
# Database migrations (lib/db/sql/schema.sql + lib/db/sql/seed.sql) are applied
# via the documented one-off workflow (see lib/db) and NOT automatically on
# every deploy. Do NOT run `pnpm --filter db push` (drizzle-kit push) here — it
# only knows the Drizzle schema and would clobber Row-Level-Security policies,
# triggers, and functions that exist solely in schema.sql. The live DB is
# already applied; a fresh environment must run the migration deliberately.
pnpm install --frozen-lockfile

