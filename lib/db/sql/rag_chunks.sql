-- =============================================================================
-- RAG vector store (pgvector)
--
-- Persistent index for the RAG assistant (JINA embeddings + DeepSeek prompt).
-- This is the same DDL that `lib/rag-store.ts` auto-provisions idempotently at
-- runtime via the api-server's Supabase pool; this file exists so the schema
-- can also be applied manually (e.g. from the Supabase SQL editor) and is the
-- single documented source for the `rag_chunks` table.
--
-- Compatible with pgvector >= 0.5 (HNSW). 1024 dims matches
-- jina-embeddings-v3 output used by the RAG runtime.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.rag_chunks (
    id          bigserial PRIMARY KEY,
    source_pdf  text NOT NULL,
    document    text NOT NULL,
    section     text NOT NULL,
    page        int NOT NULL,
    content     text NOT NULL,
    embedding   vector(1024) NOT NULL,
    created_at  timestamptz DEFAULT NOW()
);

ALTER TABLE public.rag_chunks ENABLE ROW LEVEL SECURITY;

-- Server reads chunks and ranks by embedding; anon is allowed to read so the
-- retrieval endpoint can run with unauthenticated service access if ever used
-- through PostgREST. Writes go through the service-role connection only.
DROP POLICY IF EXISTS rag_chunks_select ON public.rag_chunks;
CREATE POLICY rag_chunks_select ON public.rag_chunks
    FOR SELECT
    USING (true);

CREATE INDEX IF NOT EXISTS rag_chunks_embedding_idx
    ON public.rag_chunks
    USING hnsw (embedding vector_cosine_ops);