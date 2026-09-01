import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile as readFileP } from "node:fs/promises";
import { readEnv } from "../integrations/config";
import { PDFParse } from "pdf-parse";
import {
  EMBEDDING_DIM,
  resolveStore,
  saveChunks,
  clearStore,
  loadAllChunks,
  retrieveK,
} from "./rag-store";

// ---------------------------------------------------------------------------
// Types (kept here as the single source; re-exported by integrations/deepseek
// for backward compatibility with existing routes + the generated client).
// ---------------------------------------------------------------------------
export type Citation = {
  document: string;
  section: string;
  page: number;
  excerpt: string;
};

export type RagDocument = {
  id: string;
  document: string;
  section: string;
  page: number;
  content: string;
};

export type RagAnswer = {
  answer: string;
  confidence: number;
  citations: Citation[];
};

export type RagChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type RagIngestStatus = {
  configured: boolean;
  live: boolean;
  documents: string[];
  chunks: number;
  readerOk: boolean;
  embedOk: boolean;
  generation?: string | null;
  store: "pgvector" | "memory";
};

// ---------------------------------------------------------------------------
// Hand-authored representative chunks (network/pdf fallback when JINA/DeepSeek
// keys are not configured in the environment).
// ---------------------------------------------------------------------------
export const RAG_DOCUMENTS: RagDocument[] = [
  {
    id: "it-001-4.1",
    document: "SOP-IT-001 v3.2 (IT Department SOP)",
    section: "4.1 Production Release Control",
    page: 28,
    content:
      "No production release may proceed without recorded UAT sign-off, rollback readiness, and CAB authorization. Emergency changes use the expedited path but require retrospective review within one business day.",
  },
  {
    id: "it-001-4.3",
    document: "SOP-IT-001 v3.2 (IT Department SOP)",
    section: "4.3 Emergency Change Path",
    page: 31,
    content:
      "Emergency implementation must be followed by retrospective review within one business day by the head of IT or their deputy.",
  },
  {
    id: "mat-003-2.1",
    document: "SOP-MAT-003 v2.0 (Enterprise IT Approval Matrix)",
    section: "2.1 Tiered Approval Limits",
    page: 8,
    content:
      "Level 1 approvals cover PR/PO up to HKD 100,000. Level 2 covers HKD 100,001 to 500,000. Level 3 covers above HKD 500,000 and requires the Head of IT or Deputy.",
  },
  {
    id: "mat-003-2.4",
    document: "SOP-MAT-003 v2.0 (Enterprise IT Approval Matrix)",
    section: "2.4 Dual Control Rule",
    page: 11,
    content:
      "Payment overrides or schedule changes above HKD 250,000 require dual sign-off by the Head of IT and the Finance/Auditor role.",
  },
  {
    id: "proc-002-3.2",
    document: "SOP-PROC-002 v2.1 (IT Procurement & Vendor Management)",
    section: "3.2 Three-Way Matching",
    page: 19,
    content:
      "Approved PO amount must equal the vendor invoice amount and the milestone sign-off. Price variance tolerance is 0%; tax and shipping tolerance is +/- 2%.",
  },
  {
    id: "proc-002-5.1",
    document: "SOP-PROC-002 v2.1 (IT Procurement & Vendor Management)",
    section: "5.1 Vendor Onboarding & API Access",
    page: 24,
    content:
      "Each vendor receives a dedicated API key. Vendors submit invoices, delivery or milestone confirmations, and PO acceptance through the vendor API.",
  },
];

export const RAG_PDF_PATHS = [
  "docs/SOP-IT-001-v3.2_IT_Department_SOP.pdf",
  "docs/SOP-MAT-003-v2.0_Enterprise_IT_Approval_Matrix.pdf",
  "docs/SOP-PROC-002-v2.1_IT_Procurement_Vendor_Management.pdf",
];

// The server may be launched from the api-server package dir, so relative
// "docs/..." paths won't resolve from cwd. Walk up from the module location
// to the repo root (dist/ -> ./dist/index.mjs, src -> ./src/lib/rag-runtime.ts).
function resolvePdfPath(rel: string): string {
  const fromCwd = resolve(rel);
  if (existsSync(fromCwd)) return fromCwd;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let up = 1; up <= 8; up++) {
    dir = dirname(dir);
    const cand = resolve(dir, rel);
    if (existsSync(cand)) return cand;
  }
  return fromCwd;
}


// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const JINA_EMBED_URL = "https://api.jina.ai/v1/embeddings";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

function jinaKey(): string | undefined {
  return readEnv("JINA_API_KEY");
}
function deepseekKey(): string | undefined {
  return readEnv("DEEPSEEK_API_KEY");
}
function embedModel(): string {
  return readEnv("JINA_EMBEDDING_MODEL") ?? "jina-embeddings-v3";
}
function chatModel(): string {
  return readEnv("DEEPSEEK_MODEL") ?? "deepseek-v4-flash";
}
function readerUrl(): string {
  return readEnv("JINA_READER_URL") ?? "https://r.jina.ai/";
}

export function isRagConfigured(): { jina: boolean; deepseek: boolean } {
  return { jina: Boolean(jinaKey()), deepseek: Boolean(deepseekKey()) };
}

// ---------------------------------------------------------------------------
// Embeddings (JINA) + cosine
// ---------------------------------------------------------------------------
async function embedTexts(texts: string[]): Promise<number[][] | null> {
  const key = jinaKey();
  if (!key) return null;
  try {
    const res = await fetch(JINA_EMBED_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: embedModel(), input: texts, dimensions: EMBEDDING_DIM }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data: { embedding: number[] }[] };
    return json.data?.map((d) => d.embedding) ?? [];
  } catch {
    return null;
  }
}

async function embedText(text: string): Promise<number[] | null> {
  const vec = await embedTexts([text]);
  return vec && vec[0] ? vec[0] : null;
}

function embedStub(text: string): number[] {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return [hash % 100000, text.length % 1000];
}

function cosine(a: number[], b: number[]): number {
  const norm = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  let dot = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) dot += a[i] * b[i];
  const na = norm(a);
  const nb = norm(b);
  return na && nb ? dot / (na * nb) : 0;
}

// ---------------------------------------------------------------------------
// PDF text extraction via JINA Reader
// ---------------------------------------------------------------------------
async function extractPdfText(buffer: Buffer, _name: string): Promise<string | null> {
  // Local extraction is the reliable ingestion path (Jina Reader's raw-POST
  // endpoint can sit behind a Cloudflare challenge from server environments).
  // Jina Reader stays as a fast best-effort first attempt; pdf-parse always
  // guarantees text when the API route is unreachable/blocked.
  const key = jinaKey();
  if (key) {
    try {
      const res = await fetch(readerUrl(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/pdf",
        },
        body: new Uint8Array(buffer),
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        const text = await res.text();
        if (text && !text.startsWith("<!DOCTYPE") && text.trim().length > 80) {
          return text;
        }
      }
    } catch {
      // fall straight through to the local parser
    }
  }
  try {
    const parser = new PDFParse({ data: buffer, verbosity: 0 });
    const { text } = await parser.getText();
    return text && text.trim() ? text : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------
function chunkText(text: string, document: string, seed: number): RagDocument[] {
  const clean = text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  if (!clean) return [];
  const MAX = 700;
  const paragraphs = clean.split(/\n{2,}/).filter((p) => p.trim());
  const chunks: RagDocument[] = [];
  let current = "";
  let page = 1;
  let index = 0;
  for (const para of paragraphs) {
    if ((current + "\n\n" + para).length > MAX && current) {
      chunks.push({
        id: `${seed}-${index}`,
        document,
        section: `Page ${page} · chunk ${index + 1}`,
        page,
        content: current.trim(),
      });
      index++;
      current = para;
    } else {
      current = current ? current + "\n\n" + para : para;
    }
    if (/page\s*\d+/i.test(para)) {
      const m = para.match(/page\s*(\d+)/i);
      if (m) page = Number(m[1]);
    }
  }
  if (current) {
    chunks.push({
      id: `${seed}-${index}`,
      document,
      section: `Page ${page} · chunk ${index + 1}`,
      page,
      content: current.trim(),
    });
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// In-memory index (lazy)
// ---------------------------------------------------------------------------
type IndexedChunk = { doc: RagDocument; embedding: number[]; live: boolean };

let indexPromise: Promise<IndexedChunk[]> | null = null;
let readerOk = false;
let embedOk = false;

async function ingestPdfDocuments(): Promise<{ docs: RagDocument[]; ok: boolean }> {
  // Try to ingest the three PDFs (JINA Reader first, local pdf-parse fallback).
  let docs: RagDocument[] = [];
  let seed = 1000;
  for (const rel of RAG_PDF_PATHS) {
    try {
      const filePath = resolvePdfPath(rel);
      const buffer = await readFileP(filePath);
      const text = await extractPdfText(buffer, rel);
      if (text) {
        const name = rel.split("/").pop() ?? rel;
        docs = docs.concat(chunkText(text, name, seed));
        seed += 1000;
      }
    } catch {
      // keep going; fall back below
    }
  }
  return { docs, ok: docs.length > 0 };
}

async function buildIndex(): Promise<IndexedChunk[]> {
  const store = await resolveStore();

  // pgvector store: reuse persisted chunks+embeddings after a restart instead
  // of re-reading and re-embedding the PDFs.
  if (store.mode === "pgvector" && store.pool) {
    const persisted = await loadAllChunks(store.pool);
    if (persisted.length) {
      readerOk = true;
      embedOk = true;
      return persisted.map((c) => ({
        doc: c,
        embedding: c.embedding,
        live: true,
      }));
    }
  }

  // Extract + embed the three PDFs (also seeds an empty vector store).
  const { docs, ok } = await ingestPdfDocuments();
  readerOk = ok;
  const ready = docs.length ? docs : RAG_DOCUMENTS.slice();

  const contents = ready.map((d) => d.content);
  const vectors = await embedTexts(contents);
  embedOk = Boolean(vectors && vectors.length === contents.length);
  const indexed = ready.map((doc, i) => ({
    doc,
    embedding: vectors && vectors[i] ? vectors[i] : embedStub(doc.content),
    live: Boolean(vectors && vectors[i]),
  }));

  // Persist real embeddings so the next boot loads from the DB; retrieval then
  // runs as a Postgres vector search instead of the in-memory cosine index.
  if (store.mode === "pgvector" && store.pool) {
    const seeded = indexed
      .filter((c) => c.embedding.length === EMBEDDING_DIM)
      .map((c) => ({ ...c.doc, embedding: c.embedding }));
    if (seeded.length) {
      await saveChunks(store.pool, seeded);
    }
    const persisted = await loadAllChunks(store.pool);
    if (persisted.length) {
      return persisted.map((c) => ({
        doc: c,
        embedding: c.embedding,
        live: true,
      }));
    }
  }

  return indexed;
}

function getIndex(): Promise<IndexedChunk[]> {
  if (!indexPromise) indexPromise = buildIndex();
  return indexPromise;
}

async function resetIndex(): Promise<void> {
  indexPromise = buildIndex();
  await indexPromise;
}

// ---------------------------------------------------------------------------
// DeepSeek generation
// ---------------------------------------------------------------------------
async function completeDeepSeek(messages: RagChatMessage[]): Promise<string | null> {
  const key = deepseekKey();
  if (!key) return null;
  try {
    const res = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: chatModel(),
        messages,
        temperature: 0.2,
        max_tokens: 1500,
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      choices?: {
        message?: { content?: string; reasoning_content?: string };
      }[];
    };
    const message = json.choices?.[0]?.message;
    const content = message?.content?.trim();
    if (content) return content;
    const reasoning = message?.reasoning_content?.trim();
    return reasoning ? reasoning : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Retrieval: vector search in the pgvector store when available, otherwise the
// in-memory cosine index. Falls back to memory if the DB yields no rows.
// ---------------------------------------------------------------------------
async function retrieveRelevant(
  qVec: number[],
  topK: number,
): Promise<Array<{ doc: RagDocument; sim: number }>> {
  const store = await resolveStore();
  if (store.mode === "pgvector" && store.pool) {
    try {
      const hits = await retrieveK(store.pool, qVec, topK);
      if (hits.length) return hits;
    } catch {
      // fall through to the in-memory index
    }
  }
  const index = await getIndex();
  return index
    .map((c) => ({ doc: c.doc, sim: cosine(qVec, c.embedding) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, topK);
}

// ---------------------------------------------------------------------------
// Public: askRag
// ---------------------------------------------------------------------------
export type AskRagOptions = {
  history?: RagChatMessage[];
  topK?: number;
};

export async function askRag(question: string, opts: AskRagOptions = {}): Promise<RagAnswer> {
  const topK = opts.topK ?? 5;
  const index = await getIndex();
  const qVec = (await embedText(question)) ?? embedStub(question);
  const live = index.some((c) => c.live);

  const ranked = await retrieveRelevant(qVec, topK);

  const threshold = live ? 0.25 : 0.78;
  const [top] = ranked;

  if (!top || top.sim < threshold) {
    return {
      answer:
        "I cannot find a confident reference in the uploaded IT procedures (SOP-IT-001, SOP-MAT-003, SOP-PROC-002). Please consult the Head of IT or rephrase with a policy topic.",
      confidence: 0,
      citations: [],
    };
  }

  const citations: Citation[] = ranked.map(({ doc, sim }) => ({
    document: doc.document,
    section: doc.section,
    page: doc.page,
    excerpt: doc.content.slice(0, 160),
    ...(live ? ({} as Record<string, never>) : {}),
  }));
  void top;

  // Build grounded prompt.
  const context = ranked
    .map(({ doc }) => `[${doc.document} §${doc.section} p.${doc.page}]\n${doc.content}`)
    .join("\n\n---\n\n");
  const history = opts.history ?? [];
  const messages: RagChatMessage[] = [
    {
      role: "system",
      content:
        "You are the IT Operations Control Tower assistant. Answer the user's question using ONLY the provided SOURCES excerpts. Be concise and factual. End your answer by citing the relevant document section(s), e.g. (SOP-IT-001 §4.1). If the sources do not cover the question, say so clearly and do not guess.",
    },
    ...history.slice(-6),
    {
      role: "user",
      content: `SOURCES:\n${context}\n\n---\n\nQUESTION: ${question}\n\nAnswer with citations.`,
    },
  ];

  const generated = await completeDeepSeek(messages);
  const answer =
    generated ??
    (live
      ? "Retrieval found relevant excerpts but answer generation returned nothing. Retry the question; the evidence below is still valid."
      : "Representative RAG answer. Connect DeepSeek + JINA keys for live retrieval-augmented generation.");

  return {
    answer,
    confidence: Number(Math.max(0, Math.min(1, top.sim)).toFixed(2)),
    citations,
  };
}

export async function listDocuments(): Promise<{ documents: RagDocument[]; live: boolean }> {
  const index = await getIndex();
  return {
    documents: index.map((c) => c.doc),
    live: index.some((c) => c.live),
  };
}

export async function ingestStatus(): Promise<RagIngestStatus> {
  const index = await getIndex();
  const names = [...new Set(index.map((c) => c.doc.document))];
  return {
    configured: Boolean(jinaKey()) && Boolean(deepseekKey()),
    live: index.some((c) => c.live),
    documents: names,
    chunks: index.length,
    readerOk,
    embedOk,
    generation: isRagConfigured().deepseek ? "deepseek" : null,
    store: (await resolveStore()).mode,
  };
}

export async function reingest(): Promise<RagIngestStatus> {
  const store = await resolveStore();
  if (store.mode === "pgvector" && store.pool) {
    await clearStore(store.pool);
  }
  await resetIndex();
  return ingestStatus();
}
