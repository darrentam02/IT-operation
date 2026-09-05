import { createClient } from "npm:@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// ask-rag — query-time RAG Edge Function (Supabase-hosted variant).
// Query-time only by design (parallel variant, Round 1): the question is
// embedded with JINA, a pgvector search runs through the match_rag_chunks RPC,
// and DeepSeek generates a grounded answer. Ingestion/indexing stays in the
// api-server's in-process pipeline (index in batch, infer at the edge).
//
// Contract (mirrors /api/rag/chat):
//   POST  with { question: string; history?: {role:'user',content:string}[]; topK?: number }
//   200  RagAnswer { answer, confidence, citations:[{document,section,page,excerpt}] }
//   400  missing/malformed question or invalid JSON
//   401  missing or unverified staff JWT
//   405  non-POST
//   502  embedding or vector-search failure
//   503  required secrets not configured
//
// Deploy (from your live box):
//   supabase functions deploy ask-rag --project-ref maadotlqbdgzxmbpyriy
//   supabase secrets set --project-ref maadotlqbdgzxmbpyriy \
//     SUPABASE_URL=<project URL> SUPABASE_ANON_KEY=<anon key> \
//     JINA_API_KEY=<...> JINA_EMBEDDING_MODEL=jina-embeddings-v3 \
//     DEEPSEEK_API_KEY=<...> DEEPSEEK_MODEL=deepseek-chat
// The migration supabase/migrations/20260905000000_create_match_rag_chunks.sql
// must be applied first (supabase db push). API smoke test:
//   curl -X POST "https://maadotlqbdgzxmbpyriy.supabase.co/functions/v1/ask-rag" \
//     -H "Authorization: Bearer <staff jwt>" -H "Content-Type: application/json" \
//     -d '{"question":"How are vendor payments approved?"}'
// ---------------------------------------------------------------------------

const JINA_EMBED_URL = "https://api.jina.ai/v1/embeddings";
const DEEPSEEK_CHAT_URL = "https://api.deepseek.com/chat/completions";
const EMBEDDING_DIM = 1024;
const DEFAULT_TOP_K = 5;
const LIVE_THRESHOLD = 0.25;
const HISTORY_LIMIT = 6;

const SYSTEM_PROMPT =
  "You are the IT Operations Control Tower assistant. Answer the user's question using ONLY the provided SOURCES excerpts. Be concise and factual. End your answer by citing the relevant document section(s), e.g. (SOP-IT-001 §4.1). If the sources do not cover the question, say so clearly and do not guess.";

const NO_CONFIDENT_ANSWER =
  "I cannot find a confident reference in the uploaded IT procedures (SOP-IT-001, SOP-MAT-003, SOP-PROC-002). Please consult the Head of IT or rephrase with a policy topic.";

const GENERATION_EMPTY =
  "Retrieval found relevant excerpts but answer generation returned nothing. Retry the question; the evidence below is still valid.";

type Citation = {
  document: string;
  section: string;
  page: number;
  excerpt: string;
};

type RagAnswer = {
  answer: string;
  confidence: number;
  citations: Citation[];
};

type RagChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

type RagChunkRow = {
  document: string;
  section: string;
  page: number;
  content: string;
  similarity: number;
};

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

async function embedText(text: string, apiKey: string): Promise<number[] | null> {
  const model = Deno.env.get("JINA_EMBEDDING_MODEL") ?? "jina-embeddings-v3";
  try {
    const res = await fetch(JINA_EMBED_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input: [text], dimensions: EMBEDDING_DIM }),
    });
    if (!res.ok) return null;
    const json: { data: { embedding: number[] }[] } = await res.json();
    return json.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

async function completeDeepSeek(
  messages: RagChatMessage[],
  apiKey: string,
): Promise<string | null> {
  const model = Deno.env.get("DEEPSEEK_MODEL") ?? "deepseek-chat";
  try {
    const res = await fetch(DEEPSEEK_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, temperature: 0.2 }),
    });
    if (!res.ok) return null;
    const json: { choices?: { message?: { content?: string } }[] } = await res.json();
    return json.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const jinaApiKey = Deno.env.get("JINA_API_KEY");
  const deepseekApiKey = Deno.env.get("DEEPSEEK_API_KEY");

  if (!supabaseUrl || !supabaseAnonKey || !jinaApiKey || !deepseekApiKey) {
    return jsonError(503, "RAG not configured");
  }

  if (req.method !== "POST") {
    return jsonError(405, "method not allowed");
  }

  const header = req.headers.get("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  if (!token) {
    return jsonError(401, "unauthorized");
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData?.user) {
    return jsonError(401, "unauthorized");
  }

  let body: { question?: unknown; history?: unknown; topK?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid JSON body");
  }

  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) {
    return jsonError(400, "Enter a question");
  }

  const topK =
    typeof body.topK === "number" && body.topK >= 1
      ? Math.min(Math.floor(body.topK), 20)
      : DEFAULT_TOP_K;

  const history: RagChatMessage[] = Array.isArray(body.history)
    ? body.history
        .filter(
          (m): m is RagChatMessage =>
            !!m &&
            (m as RagChatMessage).role === "user" &&
            typeof (m as RagChatMessage).content === "string",
        )
        .slice(-HISTORY_LIMIT)
    : [];

  const qVec = await embedText(question, jinaApiKey);
  if (!qVec || qVec.length !== EMBEDDING_DIM) {
    return jsonError(502, "embedding failed");
  }

  const { data: rows, error: rpcError } = await supabase.rpc("match_rag_chunks", {
    query_embedding: qVec,
    match_count: topK,
  });
  if (rpcError) {
    return jsonError(502, `vector search failed: ${rpcError.message}`);
  }

  const ranked = ((rows as RagChunkRow[]) ?? [])
    .map((r) => ({ doc: r, sim: Number(r.similarity) }))
    .sort((a, b) => b.sim - a.sim);

  const [top] = ranked;
  if (!top || top.sim < LIVE_THRESHOLD) {
    return Response.json({
      answer: NO_CONFIDENT_ANSWER,
      confidence: 0,
      citations: [],
    });
  }

  const citations: Citation[] = ranked.map(({ doc }) => ({
    document: doc.document,
    section: doc.section,
    page: doc.page,
    excerpt: doc.content.slice(0, 160),
  }));

  const context = ranked
    .map(({ doc }) => `[${doc.document} §${doc.section} p.${doc.page}]\n${doc.content}`)
    .join("\n\n---\n\n");

  const messages: RagChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    {
      role: "user",
      content: `SOURCES:\n${context}\n\n---\n\nQUESTION: ${question}\n\nAnswer with citations.`,
    },
  ];

  const generated = await completeDeepSeek(messages, deepseekApiKey);
  const answer = generated ?? GENERATION_EMPTY;

  return Response.json({
    answer,
    confidence: Number(Math.max(0, Math.min(1, top.sim)).toFixed(2)),
    citations,
  });
});