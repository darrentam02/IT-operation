import { getPool } from "./db-runtime";
import { readEnv } from "../integrations/config";
import type { RagDocument } from "./rag-runtime";

// ---------------------------------------------------------------------------
// pgvector-backed persistence for the RAG index.
//
// When the Supabase DATABASE_URL is reachable (with the pgvector extension),
// chunks + their JINA embeddings live in the `rag_chunks` table and retrieval
// is a vector search (cosine distance <=>) executed in Postgres. Any DB
// failure degrades gracefully to the in-memory index used before, so RAG
// never breaks a deployment without a database.
// ---------------------------------------------------------------------------

export const EMBEDDING_DIM = 1024;

type Queryable = {
  query: (
    text: string,
    params?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[] }>;
};

function vecString(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

function parseVector(text: unknown): number[] {
  if (typeof text !== "string") return [];
  const inner = text.replace(/^\[|\]$/g, "").trim();
  if (!inner) return [];
  return inner.split(",").map((n) => Number(n));
}

let resolved:
  | Promise<{ mode: "pgvector" | "memory"; pool: Queryable | null }>
  | null = null;

/**
 * Resolves which store this process uses. `RAG_VECTOR_STORE=memory` forces the
 * in-memory index; the default (`pgvector`) uses the Supabase DB when it is
 * reachable and the vector extension/table can be provisioned, otherwise it
 * falls back to memory.
 */
export function resolveStore() {
  if (!resolved) {
    resolved = (async () => {
      const cfg = (readEnv("RAG_VECTOR_STORE") ?? "pgvector").toLowerCase();
      if (cfg !== "pgvector") return { mode: "memory" as const, pool: null };
      const pool = await getPool();
      if (!pool) return { mode: "memory" as const, pool: null };
      try {
        await provision(pool);
        return { mode: "pgvector" as const, pool };
      } catch {
        return { mode: "memory" as const, pool: null };
      }
    })();
  }
  return resolved;
}

const PROVISION_STATEMENTS = [
  `CREATE EXTENSION IF NOT EXISTS vector`,
  `CREATE TABLE IF NOT EXISTS public.rag_chunks (
     id bigserial PRIMARY KEY,
     source_pdf text NOT NULL,
     document text NOT NULL,
     section text NOT NULL,
     page int NOT NULL,
     content text NOT NULL,
     embedding vector(${EMBEDDING_DIM}),
     created_at timestamptz DEFAULT NOW()
   )`,
  `ALTER TABLE public.rag_chunks ENABLE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS rag_chunks_select ON public.rag_chunks`,
  `CREATE POLICY rag_chunks_select ON public.rag_chunks FOR SELECT USING (true)`,
  `CREATE INDEX IF NOT EXISTS rag_chunks_embedding_idx ON public.rag_chunks USING hnsw (embedding vector_cosine_ops)`,
  `CREATE TABLE IF NOT EXISTS public.rag_storage_docs (
     name text PRIMARY KEY,
     updated_at text NOT NULL,
     indexed_at timestamptz DEFAULT NOW(),
     chunks int NOT NULL DEFAULT 0
   )`,
];

export async function provision(pool: Queryable): Promise<void> {
  for (const stmt of PROVISION_STATEMENTS) {
    await pool.query(stmt);
  }
}

export type StoredChunk = RagDocument & { embedding: number[] };

/**
 * Replaces the whole store with the given chunks (drop + insert in a single
 * transaction). Only chunks with a full EMBEDDING_DIM embedding are kept.
 */
export async function saveChunks(
  pool: Queryable,
  chunks: StoredChunk[],
): Promise<boolean> {
  const rows = chunks.filter((c) => c.embedding.length === EMBEDDING_DIM);
  if (!rows.length) return false;
  const params: unknown[] = [];
  const tuples: string[] = [];
  rows.forEach((c, i) => {
    const b = i * 6;
    tuples.push(
      `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}::vector)`,
    );
    params.push(
      c.document,
      c.document,
      c.section,
      c.page,
      c.content,
      vecString(c.embedding),
    );
  });
  const sql = `INSERT INTO public.rag_chunks (source_pdf, document, section, page, content, embedding)
VALUES ${tuples.join(", ")}`;
  try {
    await pool.query("BEGIN");
    await pool.query("DELETE FROM public.rag_chunks");
    await pool.query(sql, params);
    await pool.query("COMMIT");
    return true;
  } catch {
    await pool.query("ROLLBACK").catch(() => {});
    return false;
  }
}

export async function clearStore(pool: Queryable): Promise<void> {
  try {
    await pool.query("DELETE FROM public.rag_chunks");
  } catch {
    // best-effort; the in-memory index still serves requests
  }
}

export async function loadAllChunks(pool: Queryable): Promise<StoredChunk[]> {
  const res = await pool.query(
    `SELECT id::text AS id, document, section, page, content, embedding::text AS embedding
     FROM public.rag_chunks ORDER BY id`,
  );
  return res.rows.map((r) => ({
    id: String(r.id),
    document: String(r.document),
    section: String(r.section),
    page: Number(r.page),
    content: String(r.content),
    embedding: parseVector(r.embedding),
  }));
}

export type RankedChunk = { doc: RagDocument; sim: number };

export async function retrieveK(
  pool: Queryable,
  query: number[],
  k: number,
): Promise<RankedChunk[]> {
  const res = await pool.query(
    `SELECT id::text AS id, document, section, page, content,
            1 - (embedding <=> $1::vector) AS similarity
     FROM public.rag_chunks
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [vecString(query), k],
  );
  return res.rows.map((r) => ({
    doc: {
      id: String(r.id),
      document: String(r.document),
      section: String(r.section),
      page: Number(r.page),
      content: String(r.content),
    },
    sim: Number(r.similarity),
  }));
}

// ---------------------------------------------------------------------------
// Per-document storage-pipeline persistence (Storage → pgvector).
// Unlike saveChunks (wipe-and-rebuild for the fixed SOP set), these mirror a
// single uploaded PDF into rag_chunks without touching other documents.
// ---------------------------------------------------------------------------

/**
 * Upserts one document's chunks, keyed by source_pdf. Replaces only that
 * document's rows (idempotent re-index of an unchanged file is harmless).
 */
export async function saveDocumentChunks(
  pool: Queryable,
  sourcePdf: string,
  chunks: StoredChunk[],
): Promise<boolean> {
  const rows = chunks.filter((c) => c.embedding.length === EMBEDDING_DIM);
  if (!rows.length) return false;
  const params: unknown[] = [sourcePdf];
  const tuples: string[] = [];
  rows.forEach((c, i) => {
    const b = 1 + i * 6;
    tuples.push(
      `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}::vector)`,
    );
    params.push(
      c.document,
      c.section,
      c.page,
      c.content,
      vecString(c.embedding),
    );
  });
  const sql = `INSERT INTO public.rag_chunks (source_pdf, document, section, page, content, embedding)
VALUES ${tuples.join(", ")}`;
  try {
    await pool.query("BEGIN");
    await pool.query("DELETE FROM public.rag_chunks WHERE source_pdf = $1", [sourcePdf]);
    await pool.query(sql, params);
    await pool.query("COMMIT");
    return true;
  } catch {
    await pool.query("ROLLBACK").catch(() => {});
    return false;
  }
}

/** Removes one document's chunks and its storage-tracking row. */
export async function removeIndexedSource(
  pool: Queryable,
  sourcePdf: string,
): Promise<void> {
  try {
    await pool.query("BEGIN");
    await pool.query("DELETE FROM public.rag_chunks WHERE source_pdf = $1", [sourcePdf]);
    await pool.query("DELETE FROM public.rag_storage_docs WHERE name = $1", [sourcePdf]);
    await pool.query("COMMIT");
  } catch {
    await pool.query("ROLLBACK").catch(() => {});
  }
}

/** Storage file name → recorded updated_at (the change-detection cursor). */
export async function listIndexedSources(
  pool: Queryable,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const res = await pool.query(`SELECT name, updated_at FROM public.rag_storage_docs`);
    for (const r of res.rows) map.set(String(r.name), String(r.updated_at));
  } catch {
    // empty map → next sweep re-indexes everything (safe, idempotent)
  }
  return map;
}

/** Records a successfully indexed storage file (upserts by name). */
export async function recordStorageIndex(
  pool: Queryable,
  name: string,
  updatedAt: string,
  chunks: number,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO public.rag_storage_docs (name, updated_at, chunks)
       VALUES ($1, $2, $3)
       ON CONFLICT (name) DO UPDATE SET
         updated_at = EXCLUDED.updated_at,
         indexed_at = NOW(),
         chunks = EXCLUDED.chunks`,
      [name, updatedAt, chunks],
    );
  } catch {
    // swallowed: the tracking row is advisory, the next sweep retries
  }
}