# Enterprise IT Operations, Staff Monitoring & Vendor Financial Management System - v5

## 1. Changes in v5 (this document)

v5 carries forward the full v4 specification (PR/PO + payment API layer, resilience layer, React wiring)
and adds:

1. The **budget export endpoint** (`GET /api/budget/export`) producing an importable 4-column
   CSV/Excel layout.
2. The **budget import endpoint** (`POST /api/budget/import`) accepting multipart CSV/Excel and
   upserting live `budget_lines` on `(fiscal_year, category)`.
3. The **export/import round-trip contract** — the exported file imports straight back in.
4. The **React toolbar** on the Procurement page (`Import budget`, `CSV`, `Excel`) and its hook.
5. The **RAG chatbox** (§21): **implemented end-to-end** — JINA AI embeddings + DeepSeek API
   generation over three PDFs, surfaced at `/assistant`. Design is no longer "locked/planned"; every
   step (ingest → index → retrieve → generate) is shipped and verified live.
6. **pgvector persistence for the RAG store** (§21.7): chunks + JINA embeddings live in a Supabase
   `rag_chunks` table with an HNSW index, so the index survives restarts and retrieval is a Postgres
   vector search (`<=>` cosine), with a graceful in-memory fallback.
7. An **updated build-state table** (§13) reflecting what is now implemented vs. planned.

The authoritative backend spec remains `docs/prompt_v3.md` §6; the API-layer spec is `docs/prompt_v4.md`
§14. This v5 focuses on the budget import/export surface, the fully-implemented RAG chatbox with its
persistent vector store, and the current build state.

---

## 13 (v5). Build State — updated

| Component | Status (v5) |
|-----------|-------------|
| Supabase schema + seed (UUID PKs, RLS, triggers, pgvector) | ✅ Applied to live DB (`maadotlqbdgzxmbpyriy`) |
| Core runtime endpoints (`/api/health`, `/api/dashboard/summary`, `/api/staff`, `/api/procurement`) | ✅ DB-backed with stub fallback |
| **Budget API: summary (allocated / incurred / paid / remaining)** | ✅ `GET /api/budget/summary` |
| **Budget API: export CSV/Excel** | ✅ `GET /api/budget/export?format=csv\|xlsx` |
| **Budget API: import CSV/Excel (upsert)** | ✅ `POST /api/budget/import` (multipart `file`) |
| **Budget React toolbar (Import / CSV / Excel)** | ✅ `procurement-workflow.tsx` + `hooks/use-budget.ts` |
| Resilience layer (retry / circuit breaker / DLQ / degradation / alerting) | ✅ `lib/resilience.ts` |
| React Procurement page → live PR/PO workflow | ✅ wired into Router |
| OpenAPI spec → zod + react-client codegen | ✅ `lib/api-spec/openapi.yaml`, regenerated |
| **RAG chatbox (JINA AI + DeepSeek API + 3 PDFs)** | ✅ Implemented — `/api/rag/*` + `/assistant` page, verified live |
| **RAG vector store: pgvector persistence (`rag_chunks`)** | ✅ `lib/rag-store.ts` + `lib/db/sql/rag_chunks.sql` (HNSW 1024-dim, RLS), auto-provisioned at runtime |
| Jira API integration | ⬜ Not started |
| Vendor API integration (portal) | ✅ backend + frontend (see v3) |
| Supabase Auth 2FA | ⬜ Not started |
| Realtime subscriptions | ⬜ Not started |

---

## 18. Budget Import / Export (implemented in v5)

### 18.1 Endpoint surface

Both routes live in `artifacts/api-server/src/routes/operations.ts`; data access via
`artifacts/api-server/src/lib/db-runtime.ts` (`loadBudgetSummary`), parsing helpers in
`artifacts/api-server/src/lib/budget-export.ts` and `budget-import.ts`.

```
GET  /api/budget/export?format=csv|xlsx    # download budget lines as CSV (default) or XLSX
POST /api/budget/import                    # multipart form-data field "file" -> upsert budget lines
```

- **Export** (`GET /api/budget/export`): reads `loadBudgetSummary` (all years, or `?year=` filter),
  builds the file via `buildBudgetExport`, sets `Content-Type` + `Content-Disposition:
  attachment; filename="..."` and `Cache-Control: no-store`. Unknown/unset `format` defaults to `csv`.
- **Import** (`POST /api/budget/import`): multer in-memory upload (10 MB cap), `uploadBudgetFile.single("file")`.
  Parsing is dispatched on the original filename extension (`.csv` / `.xlsx` / `.xls`). Unsupported
  formats return a structured `{ rows: [], errors: ["Unsupported file format..."] }` message.

### 18.2 BuildBudgetExport — 4-column importable layout

Both CSV and XLSX emit the exact same column order the importer expects, so an exported file
**round-trips straight back in**:

`Fiscal Year, Category, Description, Allocated (HKD)`

- CSV: BOM-prefixed, RFC-4180 quoting, `\r\n` line endings. Header row only (no stray `BUDGET LINES`
  banner line).
- XLSX (exceljs): bold header row, `#,##0` numFmt on the Allocated column, sized columns.
- `RuntimeBudgetRow` / `loadBudgetSummary` were extended to also return **`description`**
  (`artifacts/api-server/src/lib/db-runtime.ts`) so the export can carry it through.

### 18.3 ParseBudgetImport + UpsertBudgetLines

- **Parsing** (`lib/budget-import.ts`):
  - CSV: BOM stripped, RFC-4180 state-machine splitter, comma/space/`$`/parentheses-normalised numbers,
    category case-insensitive → validated against `HARDWARE | SOFTWARE | DATA | SERVICES`, integer year.
    A leading **header row is detected and skipped** (first cell non-numeric).
  - XLSX: exceljs reads the first worksheet; header row skipped; same field validation.
  - Any invalid row aborts with `Row N: <reason>` in the structured `errors` array.
- **Upsert** (`upsertBudgetLines`): for each valid row,
  `INSERT ... ON CONFLICT (fiscal_year, category) DO UPDATE SET description, allocated_amount, updated_at
  RETURNING xmax = 0 AS created` so new rows are counted as *inserted* and existing rows as *updated*.
  Per-row failures are captured as `skipped` + error strings; the DB-missing case returns
  `errors: ["DB not configured; import skipped"]` without throwing.
- **Summary**: `{ total, inserted, updated, skipped, errors: string[] }`.

### 18.4 Import contract columns

The importer reads 4 columns in order: **Fiscal Year, Category, Description (optional), Allocated**.
Rows are upserted on the **`(fiscal_year, category)`** composite key (matches the live
`budget_lines` unique constraint / PR budget linkage).

---

## 19. React Frontend — Budget Import/Export Toolbar (implemented)

A **Budget import/export** toolbar was added to the Procurement page
(`artifacts/it-operations-control-tower/src/procurement-workflow.tsx`), rendering a
`BudgetImportExportBlock` above the records table, plus a thin wire hook
`artifacts/it-operations-control-tower/src/hooks/use-budget.ts`.

### 19.1 UI surface

| Control | Behavior |
|---------|----------|
| **CSV** | `exportBudget('csv')` → `GET /api/budget/export?format=csv`, blob download via the `Content-Disposition` filename |
| **Excel** | `exportBudget('xlsx')` → same for `format=xlsx` |
| **Import budget** | hidden `<input type="file" accept=".csv,.xlsx,...">` triggered by the button; uploads via `useImportBudget` mutation |

### 19.2 `use-budget.ts`

- `exportBudget(format)` — fetch → `res.blob()` → `URL.createObjectURL` → anchor download, filename
  parsed from `Content-Disposition`. Plain async function (no hook state).
- `useImportBudget()` — `useMutation` wrapping `POST /api/budget/import` with `FormData` (the browser
  sets the multipart `Content-Type` boundary automatically). On success the toast shows
  `Imported <inserted> new, <updated> updated (<skipped> skipped)`.

### 19.3 Conventions

- `toast` from `sonner`; icon buttons reuse the existing `.button`, `.button-quiet`,
  `.button-primary`, `.toolbar-inner`, `.export-toolbar` and `.export-actions` CSS vocabulary from
  `index.css`, matching the Treasury export toolbar.
- `Button`/`useState`/`useRef` mirror existing page conventions; the upload input is a sibling of the
  button (no modal needed).

---

## 21. RAG Chatbox — JINA AI + DeepSeek API over three PDFs (implemented)

The chat surface answers questions grounded in **three reference PDFs**, served at `/assistant` with a
new `POST /api/rag/chat` route. The pipeline outsources heavy parsing/embedding to **JINA AI** and
uses **DeepSeek** for grounded answer generation; retrieval runs against a **pgvector** store on
Supabase with an in-memory cosine fallback. No custom embedding training or local model hosting.

### 21.1 Components

| Step | Provider | Responsibility |
|------|----------|----------------|
| 1. Document ingest | **JINA Reader** (best-effort) + **`pdf-parse`** (reliable local fallback) | PDF → clean text, then ~700-char chunks with page tracking |
| 2. Indexing | **JINA Embeddings** API (`jina-embeddings-v3`, `dimensions=1024`) | chunk → 1024-dim dense vector, persisted in Supabase `rag_chunks` |
| 3. Retrieval | **Postgres `<=>` cosine** via pgvector (HNSW), fallback in-memory cosine | top-k most similar chunks for the user query |
| 4. Generation | **DeepSeek API** (`deepseek-v4-flash`, `deepseek-v4-pro` compatible) | compose the grounded answer from retrieved chunks + chat context |
| 5. Serving | api-server routes | `chat` / `status` / `documents` / `ingest` |

Implementation: `artifacts/api-server/src/lib/rag-runtime.ts` (pipeline + generation),
`artifacts/api-server/src/lib/rag-store.ts` (pgvector persistence), frontend
`artifacts/it-operations-control-tower/src/hooks/use-rag.ts` + `src/App.tsx` (`/assistant`).

### 21.2 Data flow

```
User prompt (chatbox at /assistant)
   │
   ▼
POST /api/rag/chat { question, history?: [...] }
   │
   ├─ embed question via JINA Embeddings (1024-dim)
   ├─ top-k similar chunks:  pgvector `embedding <=> $1::vector` (or in-memory cosine)
   ├─ threshold gate (live ≥ 0.25; stub fallback ≥ 0.78)
   ├─ build prompt: [system: ground rules + sources] + retrieved chunks + history + question
   └─ DeepSeek chat completion  ──►  { answer, confidence, citations: [{document, section, page, excerpt}] }
```

Answers carry a **confidence score** (`1 − cosine distance`) and **citations** with the exact source
section/page, e.g. *"A HKD 300,000 purchase order falls under Level 2 … (SOP-MAT-003 §2.1)"*.

### 21.3 The three PDFs (knowledge base)

Placed at the repo root `docs/`, resolved from the module location (`resolvePdfPath`) so the bundle
works regardless of launch directory:

- `docs/SOP-IT-001-v3.2_IT_Department_SOP.pdf` — release control, change management
- `docs/SOP-MAT-003-v2.0_Enterprise_IT_Approval_Matrix.pdf` — tiered approval limits, dual control
- `docs/SOP-PROC-002-v2.1_IT_Procurement_Vendor_Management.pdf` — procurement, three-way matching, vendor access

Ingestion is automatic on first index build (chunks PDFs → embeds → persists). `POST /api/rag/ingest`
re-parses, wipes the persisted store and reseeds it.

### 21.4 Env / config (`/.env`, template in `/.env.example`)

```
JINA_API_KEY=...
JINA_READER_URL=https://r.jina.ai/          # best-effort PDF extraction
JINA_EMBEDDING_MODEL=jina-embeddings-v3     # 1024-dim output
DEEPSEEK_API_KEY=...
DEEPSEEK_MODEL=deepseek-v4-flash             # deepseek-v4-pro also verified working
RAG_VECTOR_STORE=pgvector                    # pgvector (Supabase, persisted) | memory
```

`RAG_VECTOR_STORE=memory` forces the legacy in-memory index; the default `pgvector` degrades to
in-memory automatically when the database is unreachable (RAG never breaks a deployment without a DB).

### 21.5 Contract

```
POST /api/rag/chat
  req:  { question: string, history?: {role:"user"|"assistant"|"system", content:string}[], topK?: number }
  res:  { answer: string, confidence: number, citations: { document, section, page, excerpt }[] }

GET /api/rag/status        # { configured, live, documents[], chunks, readerOk, embedOk, generation, store }
GET /api/rag/documents     # { documents: RagDocument[], live }   (RagDocument = {id, document, section, page, content})
POST /api/rag/ingest {}    # wipe + reseed the store, returns the status payload
```

### 21.6 Decisions

- **PDF text extraction**: JINA Reader is tried first (fast, time-boxed) but can sit behind a
  Cloudflare challenge from server environments, so **`pdf-parse` is the reliable fallback** and the
  actual path used in production; `readerOk` reflects at least one PDF yielding text.
- **Embeddings**: `jina-embeddings-v3` fixed to 1024-dim (`dimensions` flag) to match `vector(1024)`.
- **Retrieval**: Postgres `<=>` cosine distance over normalized vectors — identical math to the
  in-memory cosine path, so confidence is comparable across stores. Retrieval stops at the first
  provider that returns rows; the in-memory index is always a fallback.
- **Generation**: DeepSeek, `temperature 0.2`, `max_tokens 1500`; if the reasoning model returns an
  empty `content`, `reasoning_content` is used, and a stale-but-accurate fallback keeps the answer
  non-blank.
- **Source grounding**: the system prompt forbids answering outside the provided SOURCES, and every
  answer ends by citing the relevant document section(s).

### 21.7 pgvector persistence (implemented)

- Table `public.rag_chunks` (bigserial PK, `source_pdf`, `document`, `section`, `page`, `content`,
  `embedding vector(1024)`, `created_at`) with **HNSW** index
  `(embedding vector_cosine_ops)` and RLS (`SELECT` for anon, writes via service role).
- **Auto-provisioned** idempotently at runtime (`CREATE EXTENSION IF NOT EXISTS vector`, table,
  policy, index) through the app's lazy Supabase pool (`lib/rag-store.ts` `provision()`), so no manual
  migration is required; the standalone DDL is `lib/db/sql/rag_chunks.sql` for manual application.
- **Boot**: if the store has rows, the index is loaded from the DB (no PDF re-read, no re-embed —
  verified: restart loads 27 chunks in ~0.0s); an empty store is seeded from the PDFs on first boot.
- **Ingest**: `saveChunks` replaces the whole store in one transaction (drop + insert);
  `POST /api/rag/ingest` clears the table before reseeding.

---

## 20. v5 verification

- `artifacts/api-server` — `pnpm typecheck` green.
- `artifacts/it-operations-control-tower` — `pnpm typecheck` green.
- Round-trip contract: exported CSV/XLSX header `Fiscal Year, Category, Description, Allocated (HKD)`
  matches the importer's 4-column parse, and the importer skips a leading header line, so
  export → import is lossless.
- **RAG live smoke** (real keys, Supabase):
  - `/api/rag/status` → `configured: true, live: true, readerOk: true, embedOk: true, chunks: 27,
    generation: deepseek, store: pgvector`.
  - `/api/rag/chat` returns a grounded DeepSeek answer with 5 citations and confidence ≈ 0.70–0.76
    (e.g. approval-level and dual-sign-off questions).
  - **Restart persistence**: after wiping the store, boot 1 reseeded 27 chunks into `rag_chunks`;
    boot 2 loaded them from pgvector in <1s and answered correctly without re-reading the PDFs.
    DB confirmed: `vector` extension 0.8.2 + `rag_chunks` HNSW index present.

---

*Generated from `docs/prompt_v4.md` — v5 adds the budget import/export feature (backend endpoints +
importable export format, CSV/XLSX parsing + upsert, React toolbar + hook), and fully implements the
RAG chatbox (JINA AI embeddings + DeepSeek generation over three PDFs) with a persistent pgvector
store on Supabase and an in-memory fallback, updating the build state and verification accordingly.*