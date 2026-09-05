# IT Operations Control Tower

Enterprise command center for IT staff operations, release governance, procurement approvals, treasury allocation, compliance guidance, and immutable audit activity — with a RAG assistant grounded in the company IT SOPs.

## Highlights

- **Staff shift board** — live staff statuses synced from Jira (`SHIFT`/`Process_Status`), team/region/priority/environment columns, stale-signal detection.
- **Release governance** — environment handoffs, gate checklist, and a pulse score per release column.
- **PR/PO + payment workflow** — create a PR with a budget pre-check, tiered approvals (L1/L2/L3 by HKD band), legal/security review gating, milestones, invoice → auto three-way match, variance resolution, dual sign-off (> HKD 250k), and payment with budget `paid_amount` tracking.
- **Treasury analytics** — paid vs. committed, business-unit allocation, and FX reference rates, with CSV / Excel / PDF export.
- **Compliance assistant** (`/compliance`) — ask a policy question, get a grounded answer with a confidence score and cited source excerpts.
- **RAG assistant** (`/assistant`) — a conversational chatbox over the three IT SOPs; every answer is grounded and carries citations.
- **Vendor portal** (`/vendor-portal`) — external vendors log in with an API key to view their purchase orders and confirm milestones / submit invoices.
- **Administration** — immutable audit log viewer with a delegation/authority posture readout.

## Stack

- pnpm workspaces, Node.js 20, TypeScript 5.9
- Frontend: React (Vite), Lucide icons, TanStack Query
- Backend: Express 5 API server
- Database: PostgreSQL (Supabase), Drizzle ORM, pgvector
- Validation & codegen: Zod (v4), Orval from the OpenAPI spec
- AI / RAG: JINA Reader + `jina-embeddings-v3` (1024-dim), DeepSeek (`deepseek-v4-pro` / `deepseek-v4-flash`)

## Repository layout

| Path | What lives there |
|------|------------------|
| `artifacts/it-operations-control-tower/` | Vite dashboard (all control surfaces + routes) |
| `artifacts/api-server/` | Express API (operations, RAG, Jira, vendor) |
| `lib/` | DB schema, migrations, OpenAPI spec, codegen |
| `docs/` | Product spec (`prompt.md`, `prompt_v2…v5.md`) |
| `policies/` | IT policy PDF drop-zone (consumed by `ingest.js`) |
| `docs/` | Source SOP PDFs (SOP-IT-001, SOP-MAT-003, SOP-PROC-002) |

## Getting started

Create a `.env` from `.env.example` and export the required secrets (see `replit.md` for managed-workflow ports and routing).

```sh
pnpm install
pnpm run typecheck
pnpm run build
```

Run the two services through their managed workflows (see `replit.md`):
- Dashboard on port `21727`, mounted at `/`
- API server on port `8080`, mounted at `/api`

The dashboard's same-origin `/api/*` requests are proxied to the API service in both dev and production preview.

### RAG / compliance assistant

The assistant reads the three SOP PDFs in `docs/`, chunks them, embeds via JINA, and stores vectors in `pgvector` (`public.rag_chunks`) with HNSW indexing. If no database is reachable it degrades gracefully to an in-memory index. DeepSeek generates answers with confidence + citations.

Required env for live RAG:

```
DEEPSEEK_API_KEY=
JINA_API_KEY=
JINA_EMBEDDING_MODEL=jina-embeddings-v3
JINA_READER_URL=https://r.jina.ai/
RAG_VECTOR_STORE=pgvector   # or "memory"
```

Endpoints: `GET /api/rag/status`, `GET /api/rag/documents`, `POST /api/rag/ingest`, `POST /api/rag/search`, `POST /api/rag/chat`.

## Documentation

- Latest product spec: [`docs/prompt_v5.md`](docs/prompt_v5.md) (previous: `prompt_v4.md`, `prompt_v3.md`, `prompt_v2.md`, `prompt.md`)
- Operations / run guide: [`replit.md`](replit.md)
