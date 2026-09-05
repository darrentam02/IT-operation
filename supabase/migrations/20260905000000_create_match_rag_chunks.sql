-- pgvector similarity RPC backing the `ask-rag` Supabase Edge Function
-- (query-time RAG variant; indexing stays in the api-server's in-process
-- pipeline). Mirrors the inline cosine search in lib/rag-store.ts: returns the
-- top `match_count` rows ordered by cosine distance. The 0.25 live-confidence
-- threshold is applied in the function's TypeScript (askRag parity), not here.

create or replace function public.match_rag_chunks(
  query_embedding vector(1024),
  match_count int default 5
)
returns table (
  id bigint,
  document text,
  section text,
  page int,
  content text,
  similarity double precision
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.document,
    c.section,
    c.page,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.rag_chunks c
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- The edge function verifies a staff JWT before calling this; grant to
-- authenticated (staff tokens claim role=authenticated) and service_role only.
grant execute on function public.match_rag_chunks(vector, int)
  to authenticated, service_role;