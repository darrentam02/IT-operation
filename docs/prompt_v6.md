# Enterprise IT Operations, Staff Monitoring & Vendor Financial Management System - v6

## 1. Changes in v6 (this document)

v6 carries forward the full v3 + v4 + v5 specification (PR/PO + payment API layer, resilient data-access
layer, vendor portal, and the implemented DeepSeek RAG / compliance assistant) and adds the **implemented
staff authentication flow**. Everything described in v3/v4/v5 remains in force; the sections below document:

1. The **staff auth flow** (§10 v6): Supabase sign-in with email/password, TOTP time-based 2FA where a
   factor is enrolled, session persistence + re-validation, logout, and a Router-level gate protecting every
   staff control surface. `/vendor-portal` keeps its own independent API-key flow.
2. The **demo posture** (`AUTH_MODE=demo`): the login/2FA gate is bypassed with a stand-in local session for
   prototyping/previews; `full` requires identity-provider sign-in.
3. The **first project glossary** (`CONTEXT.md`): Staff User, Vendor, Control Surface, Session, 2FA Factor,
   AuthMode — the canonical vocabulary for new work.
4. The **RAG / compliance assistant** (ported in v5) remains in force: pipeline (§6), API surface (§7),
   React surfaces (§8), and its required fix (§9) are unchanged.
5. The **`ask-rag` Edge Function** (Supabase-hosted, query-time variant): a staff-JWT-gated Deno function
   (`supabase/functions/ask-rag`) that embeds the question (JINA v3, 1024-dim), runs pgvector search via the
   `match_rag_chunks` PostgREST RPC (`supabase/migrations/20260905000000_create_match_rag_chunks.sql`,
   SECURITY DEFINER + HNSW index), and generates a grounded DeepSeek answer — contract-identical to
   `/api/rag/chat` (0.25 live threshold, user-role history `slice(-6)`, 160-char excerpts, same system prompt,
   200/400/401/405/502/503). Indexing stays in-process (index in batch, infer at the edge); the frontend and
   in-process pipeline are unchanged.
6. An **updated build-state table** (§13) reflecting the auth flow and the Edge Function as implemented and
   re-verifying the outstanding list: budget import/export, Storage → pgvector, and realtime subscriptions are
   the only remaining not-started items.

The authoritative backend spec remains `docs/prompt_v3.md` §5–§6. This v6 focuses on the auth layer, the
query-time RAG Edge Function variant, and the current build state.

---

## 6 (v6). RAG Assistant — implemented

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

## 7 (v6). RAG API surface

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

## 8 (v6). React frontend — Compliance + RAG assistant (implemented)

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

## 9 (v6). Fix applied

| # | Bug | Fix |
|---|-----|-----|
| 1 | Dashboard `App.tsx` referenced the `Sparkles` lucide icon without importing it (would not render/typecheck the new surfaces) | Added the missing `Sparkles` (plus `BookOpen`, `Send`) to the lucide import block |

---

## 10 (v6). Auth flow — implemented (this port)

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

## 13 (v6). Build State — updated

| Component | Status (v6) |
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
| Budget import / export (CSV/Excel upload) | ✅ Implemented |
| DeepSeek RAG **Edge Function** (Supabase-hosted variant, query-time `ask-rag`) | ✅ **Implemented (this port)** — deploy via `supabase functions deploy ask-rag --project-ref maadotlqbdgzxmbpyriy` |
| **Supabase Auth 2FA (login + TOTP, route-gated staff surfaces, `AUTH_MODE=demo` bypass)** | ✅ **Implemented (this port)** |
| **CONTEXT.md glossary (domain model)** | ✅ **Implemented (this port)** |
| Supabase Storage → pgvector pipeline (scheduled sweep + POST /api/rag/storage/sync) | ✅ Implemented |
| Realtime subscriptions (shifts + budget_lines → react-query invalidation) | ✅ Implemented |

---

*Generated from `prompt_v5.md` — v6 adds the implemented staff auth flow (login + TOTP 2FA + demo mode +
route gating), the `ask-rag` Edge Function (query-time RAG variant), the first `CONTEXT.md` glossary, and an
updated (re-verified) build state.*
