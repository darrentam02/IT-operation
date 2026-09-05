-- Storage → pgvector sweep + Realtime knowledge.
--
-- Backs the api-server's scheduled sweep (RAG_STORAGE_SYNC_MS / POST
-- /api/rag/storage/sync): per-document chunks are keyed by source_pdf so a
-- single uploaded PDF is upserted idempotently without touching the fixed-SOP
-- store, and rag_storage_docs tracks each file's updated_at as the
-- change-detection cursor. All writes here go through the service_role token,
-- which bypasses RLS.

-- 1. Per-document key on the existing chunk table.
alter table public.rag_chunks
  add column if not exists source_pdf text;

create index if not exists rag_chunks_source_pdf_idx
  on public.rag_chunks (source_pdf);

-- 2. Storage-tracking cursor (Storage file name → last-indexed updated_at).
create table if not exists public.rag_storage_docs (
  name text primary key,
  updated_at text not null,
  indexed_at timestamptz default now(),
  chunks int not null default 0
);

-- 3. Realtime: live invalidations for staff coverage (shifts) and the budget
--    ledger (budget_lines). Adding an already-present table raises
--    duplicate_object/unique_violation; a missing table raises
--    undefined_table (fresh environments that skipped the budget migration).
--    All three are swallowed so the migration is replayable.
do $$
declare
  t text;
begin
  foreach t in array array['public.shifts', 'public.budget_lines']
  loop
    begin
      execute format('alter publication supabase_realtime add table %s', t);
    exception when duplicate_object or unique_violation or undefined_table then
      null;
    end;
  end loop;
end$$;