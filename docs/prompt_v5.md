# Enterprise IT Operations, Staff Monitoring & Vendor Financial Management System - v5

## 1. Changes in v5 (this document)

v5 carries forward the full v3 + v4 specification and adds the **implemented DeepSeek RAG /
compliance assistant** (the last major integration backlog item from the v3 build-state table).
Everything described in v3/v4 remains in force; the sections below document:

1. The **server-side RAG pipeline** (§6 v5): JINA Reader + `jina-embeddings-v3` over the three SOP
   PDFs, stored in `pgvector` (`rag_chunks`, HNSW index) with a graceful in-memory fallback, and a
   DeepSeek generation layer that returns grounded answers with confidence + paragraph citations.
2. The **RAG API surface** (§7 v5): `GET/POST /api/rag/{status,documents,ingest,search,chat}`.
3. The **React frontend** (§8 v5): the `Compliance` surface (`/compliance`) and the conversational
   `RAG assistant` surface (`/assistant`) with a chatbox, confidence meter, and cited-source cards.
4. The **bug fix** required by the port (§9 v5): the dashboard referenced the `Sparkles` icon without
   importing it; resolved while wiring the new routes.
5. An **updated build-state table** (§13) reflecting RAG as now implemented.

The authoritative backend spec remains `docs/prompt_v3.md` §5–§6. This v5 focuses on the RAG layer and
the updated build state.

---

## 6 (v5). RAG Assistant — implemented

### 6.1 Pipeline

```
docs/*.pdf  (SOP-IT-001, SOP-MAT-003, SOP-PROC-002)
        │  JINA Reader (r.jina.ai) — text extraction, page + section metadata
        ▼
 chunking (≈500 tokens, 50 overlap) ──► jina-embeddings-v3 (1024-dim)
        │
        ▼
 pgvector `public.rag_chunks`  (HNSW index)   ◄── graceful fallback to in-memory index
        │
        ▼
 top-K cosine retrieval ──► DeepSeek (deepseek-v4-pro / deepseek-v4-flash)
        ▼
 grounded answer + confidence + [Source: doc, Section, Page] citations
```

- **Reader + embedding:** JINA (server-side only; API key never leaves the server).
- **Store:** `RAG_VECTOR_STORE=pgvector` (default) writes chunks + 1024-dim embeddings into
  `rag_chunks` with an HNSW index; `RAG_VECTOR_STORE=memory` forces the in-memory index. Any DB
  failure degrades to memory so RAG never breaks a deployment without a database.
- **Retrieval:** hybrid cosine similarity over the vector store; top 5 chunks passed to DeepSeek.
- **Zero-hallucination guardrail:** when confidence falls below threshold the assistant answers that
  it cannot find an exact reference in the verified SOPs.
- **Language:** supports English (+ Chinese where the indexed text allows) for both query and answer.

### 6.2 Implementation notes

- Core logic lives in `artifacts/api-server/src/lib/rag-runtime.ts` (pipeline, chunking, retrieval,
  DeepSeek calls) and `artifacts/api-server/src/lib/rag-store.ts` (pgvector/memory persistence,
  provisioning of `rag_chunks` + HNSW index + RLS).
- `artifacts/api-server/src/integrations/deepseek.ts` is a slim facade re-exporting the RAG surface
  (backward-compatible with existing generated-client imports).
- The vector store reuses the API's PostgreSQL pool: `getPool()` in `lib/db-runtime.ts` is now
  exported so the store can read the same `DATABASE_URL`-backed pool.
- Env vars: `JINA_API_KEY`, `JINA_EMBEDDING_MODEL` (default `jina-embeddings-v3`), `JINA_READER_URL`
  (default `https://r.jina.ai/`), `RAG_VECTOR_STORE` (default `pgvector`).

---

## 7 (v5). RAG API surface

All routes live in `artifacts/api-server/src/routes/integrations.ts` and are mounted under `/api`
(the existing Jira and vendor endpoints are preserved).

```
GET   /api/rag/status       # configured / live / document + chunk counts / store mode
GET   /api/rag/documents    # list of ingested documents + live flag
POST  /api/rag/ingest       # re-run ingestion over docs/*.pdf on demand
POST  /api/rag/search       # single-shot compliance question → RagAnswer
POST  /api/rag/chat         # question + optional history → RagAnswer
```

`RagAnswer` shape: `{ answer: string; confidence: number; citations: Array<{ document; section; page; excerpt }> }`.

The existing `GET /api/health` / `GET /api/jira/tickets` / `GET /api/vendor/submissions` routes are
unchanged.

---

## 8 (v5). React frontend — Compliance + RAG assistant (implemented)

Two new control surfaces were added to the dashboard (`artifacts/it-operations-control-tower/src/App.tsx`):

| Surface | Route | Behaviour |
|---------|-------|-----------|
| **Compliance** | `/compliance` | Hero with a single search box; posts to `/api/rag/chat` (self-contained hook — no codegen dependency) and renders a confidence bar plus cited-source cards. Supports a `?q=` deep link. |
| **RAG assistant** | `/assistant` | Conversational chatbox with a scrollable transcript, typing indicator, suggestion chips, and a live knowledge-base status pill (chunk/SOP counts + store mode). Each assistant turn renders a `RagAnswer` with confidence + evidence-trail citations. |

- The client rides on `artifacts/it-operations-control-tower/src/hooks/use-rag.ts` (manual fetch hooks
  `useRagChat`, `useRagStatus`, `useRagDocuments`, `useRagIngest` + shared types), avoiding generated-client
  codegen so response shapes stay self-contained.
- Both nav entries, page metadata, routes, and the icon imports were added alongside the pages.

---

## 9 (v5). Fix applied

| # | Bug | Fix |
|---|-----|-----|
| 1 | Dashboard `App.tsx` referenced the `Sparkles` lucide icon without importing it (would not render/typecheck the new surfaces) | Added the missing `Sparkles` (plus `BookOpen`, `Send`) to the lucide import block |

---

## 10 (v5). Auth flow — implemented (this port)

Staff authentication with time-based 2FA was ported after the RAG pipeline:

- **Backend** (`artifacts/api-server`): `GET /api/auth/mode` (`AUTH_MODE=demo | full`); `POST /api/auth/login`
  now surfaces `weak_session` + `factors` when the account requires TOTP 2FA; `POST /api/auth/totp/verify`
  returns the refreshed verified tokens; `listFactors` and `AuthFactor` added to `integrations/supabase-auth.ts`.
- **React** (`artifacts/it-operations-control-tower`): `hooks/use-auth.tsx` (`AuthProvider`/`useAuth`, status flow
  `restoring | signedOut | needsTotp | signedIn`), `components/auth/login-screen.tsx` and `totp-screen.tsx`,
  and a Router-level gate so every staff surface under the `Shell` is login-gated; `/vendor-portal` keeps its own
  independent API-key flow. Sessions persist as `orbital.auth.session` (localStorage) and are re-validated via
  `POST /api/auth/user` on boot.
- **Demo mode**: with `AUTH_MODE=demo` the gate is bypassed for prototyping (stand-in local session); `full`
  requires Supabase sign-in with TOTP where a factor is enrolled.

---

## 13 (v5). Build State — updated

| Component | Status (v5) |
|-----------|-------------|
| Supabase schema + seed (UUID PKs, RLS, triggers, pgvector) | ✅ Applied to live DB |
| Core runtime endpoints + PR/PO + payment API layer (from v4) | ✅ Implemented (see `prompt_v4.md`) |
| Resilient data-access layer (retry/backoff, circuit breaker, DLQ, graceful degradation) | ✅ Implemented |
| React Procurement → live PR/PO workflow | ✅ Implemented |
| **DeepSeek RAG pipeline (JINA Reader + JINA embeddings + DeepSeek + pgvector)** | ✅ **Implemented (this port)** |
| **RAG API surface (`/api/rag/{status,documents,ingest,search,chat}`)** | ✅ **Implemented** |
| **React Compliance surface (`/compliance`)** | ✅ **Implemented** |
| **React RAG assistant chatbox (`/assistant`)** | ✅ **Implemented** |
| Vendor portal (`/vendor-portal`, API-key login, milestone confirm / invoice) | ✅ Implemented (ported earlier) |
| Budget import / export (CSV/Excel upload) | ⬜ Not started |
| DeepSeek RAG **Edge Function** (Supabase-hosted variant) | ⬜ Not started (in-process pipeline used instead) |
| **Supabase Auth 2FA (login + TOTP, route-gated staff surfaces, `AUTH_MODE=demo` bypass)** | ✅ **Implemented (this port)** |
| Supabase Storage → pgvector pipeline | ⬜ Not started |
| Realtime subscriptions | ⬜ Not started |

---

*Generated from `prompt_v4.md` — v5 adds the implemented DeepSeek RAG / compliance assistant (server
pipeline + API + React surfaces), the `Sparkles` import fix, the staff auth flow (login + TOTP 2FA + demo mode),
and an updated build state.*
