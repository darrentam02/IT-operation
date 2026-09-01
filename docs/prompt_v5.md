# Enterprise IT Operations, Staff Monitoring & Vendor Financial Management System - v5

## 1. Changes in v5 (this document)

v5 carries forward the full v4 specification (PR/PO + payment API layer, resilience layer, React wiring)
and adds the **completed Budget import / export (CSV/Excel upload + download)** feature, plus locks the
**RAG chatbox design** (JINA AI + DeepSeek API over three PDFs). The sections below document:

1. The **budget export endpoint** (`GET /api/budget/export`) producing an importable 4-column
   CSV/Excel layout.
2. The **budget import endpoint** (`POST /api/budget/import`) accepting multipart CSV/Excel and
   upserting live `budget_lines` on `(fiscal_year, category)`.
3. The **export/import round-trip contract** — the exported file imports straight back in.
4. The **React toolbar** on the Procurement page (`Import budget`, `CSV`, `Excel`) and its hook.
5. The **RAG chatbox architecture** (§21): JINA AI for PDF ingest + embeddings, DeepSeek API for the
   Q&A generation, over three uploaded PDFs, surfaced in the existing chat surface.
6. An **updated build-state table** (§13) reflecting what is now implemented vs. planned.

The authoritative backend spec remains `docs/prompt_v3.md` §6; the API-layer spec is `docs/prompt_v4.md`
§14. This v5 focuses on the new budget import/export surface, the RAG chatbox design, and the current
build state.

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
| **RAG chatbox (JINA AI + DeepSeek API + 3 PDFs)** | 🔷 Planned — design locked (see §21) |
| Jira API integration | ⬜ Not started |
| Vendor API integration (portal) | ✅ backend + frontend (see v3) |
| Supabase Auth 2FA | ⬜ Not started |
| Supabase Storage → pgvector pipeline | 🔷 Revised — JINA Reader/embeddings replaces raw pgvector-only pipeline (see §21) |
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

## 21. RAG Chatbox — JINA AI + DeepSeek API over three PDFs (design locked)

The chat surface will answer questions grounded in **three reference PDFs** (e.g. IT procurement policy,
vendor/expense policy, service catalog). The pipeline is deliberately simple and outsources the heavy
parsing/embedding steps to **JINA AI**, with **DeepSeek** doing answer generation — no custom
tokenizer/embedding training and no local model hosting.

### 21.1 Components

| Step | Provider | Responsibility |
|------|----------|----------------|
| 1. Document ingest | **JINA Reader** API | PDF → clean text/Markdown chunks and clean source (drop headers/footers, layout noise) |
| 2. Indexing | **JINA Embeddings** API (`jina-embeddings-v3`) | chunk → dense vector (1024-dim), stored/queried for similarity |
| 3. Retrieval | in-app (pgvector or in-memory FAISS) | top-k most similar chunks for the user query |
| 4. Generation | **DeepSeek API** | compose the grounded answer from the retrieved chunks + the original chat context |
| 5. Serving | api-server route | `/api/rag/ask` (POST) + `/api/rag/documents` (ingest/list/delete) |

### 21.2 Data flow

```
User prompt (chatbox)
   │
   ▼
POST /api/rag/ask { question, history? }
   │
   ├─ embed question via JINA Embeddings
   ├─ top-k similar chunks (pgvector / FAISS)
   ├─ build prompt: [system: ground rules + sources] + retrieved chunks + user question
   └─ DeepSeek chat completion  ──►  { answer, sources: [{doc, chunk, score}] }
```

### 21.3 The three PDFs

Three curated operating documents will be placed under `artifacts/api-server/rag-docs/` (or uploaded
through the UI) and chunked+embedded on ingest. They are the knowledge base for all chatbox answers.

### 21.4 Env / config

```
JINA_API_KEY=...
JINA_READER_URL=https://r.jina.ai/          # or direct JINA Reader POST
JINA_EMBEDDING_MODEL=jina-embeddings-v3
DEEPSEEK_API_KEY=...
DEEPSEEK_MODEL=deepseek-chat
RAG_TOP_K=4
```

### 21.5 Contract

```
POST /api/rag/ask
  req:  { question: string, history?: {role:"user"|"assistant", content:string}[] }
  res:  { answer: string, sources: { document: string, chunk: string, score: number }[] }

POST /api/rag/documents    # multipart PDF upload → ingest (Reader → embed → index)
GET  /api/rag/documents    # list ingested docs
DELETE /api/rag/documents/:id
```

### 21.6 Decisions

- **JINA Reader** handles PDF extraction (robust against scanned/OCR and table-heavy docs), so the
  pipeline avoids brittle local PDF parsing.
- **JINA Embeddings** replace a from-scratch embedding model; vectors are 1024-dim and stored either in
  `pgvector` (consistent with the live schema) or an in-memory FAISS index (simplest, no schema change).
- **DeepSeek** is the generator (matches the previously-planned DeepSeek RAG stance); retrieval is
  grounded so answers cite their source document + chunk.
- Chunking: ~800 tokens with overlap, produced by the Reader output; metadata carries the source
  filename and chunk index.

---

## 20. v5 verification

- `artifacts/api-server` — `pnpm typecheck` green.
- `artifacts/it-operations-control-tower` — `pnpm typecheck` green.
- Round-trip contract: exported CSV/XLSX header `Fiscal Year, Category, Description, Allocated (HKD)`
  matches the importer's 4-column parse, and the importer skips a leading header line, so
  export → import is lossless.

---

*Generated from `docs/prompt_v4.md` — v5 adds the budget import/export feature (backend endpoints +
importable export format, CSV/XLSX parsing + upsert, React toolbar + hook), locks the RAG chatbox design
(JINA AI ingest/embeddings + DeepSeek generation over three PDFs), and updates the build state.*
