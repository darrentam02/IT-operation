import { Router, type IRouter } from "express";
import { healthRegistry } from "../integrations/registry";
import { deepseek, type RagAnswer } from "../integrations/deepseek";
import {
  askRag,
  ingestStatus,
  listDocuments,
  reingest,
  type RagChatMessage,
  type RagIngestStatus,
} from "../lib/rag-runtime";
import { listJiraTickets } from "../integrations/jira";
import { listVendorSubmissions } from "../integrations/vendor";

const router: IRouter = Router();

router.get("/health", async (_req, res) => {
  const statuses = await healthRegistry();
  res.json({ integrations: statuses });
});

// List ingested SOP documents (live when JINA Reader loaded the 3 PDFs).
router.get("/rag/documents", async (_req, res) => {
  const { documents, live } = await listDocuments();
  res.json({ documents, live });
});

// RAG ingest status (configured / live / chunk counts).
router.get("/rag/status", async (_req, res) => {
  const status: RagIngestStatus = await ingestStatus();
  res.json(status);
});

// Re-run ingestion of the three PDFs (docs/*.pdf) on demand.
router.post("/rag/ingest", async (_req, res) => {
  const status: RagIngestStatus = await reingest();
  res.json(status);
});

// Compliance-style single-shot search (kept for the existing /compliance page).
router.post("/rag/search", async (req, res) => {
  const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
  if (!query) {
    res.status(400).json({ error: "Enter a compliance question" });
    return;
  }
  const result: RagAnswer = await deepseek.search(query);
  res.json(result);
});

// Chatbox endpoint — question plus optional conversation history.
router.post("/rag/chat", async (req, res) => {
  const body = req.body ?? {};
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) {
    res.status(400).json({ error: "Enter a question" });
    return;
  }
  const rawHistory: unknown = body.history;
  const history: RagChatMessage[] = Array.isArray(rawHistory)
    ? rawHistory
        .filter(
          (m): m is RagChatMessage =>
            !!m &&
            (m as RagChatMessage).role === "user" &&
            typeof (m as RagChatMessage).content === "string",
        )
        .slice(-6)
    : [];
  const result: RagAnswer = await askRag(question, { history, topK: 5 });
  res.json(result);
});

// /api/jira/tickets — work queue from Jira (falls back to representative data)
router.get("/jira/tickets", async (_req, res) => {
  const tickets = await listJiraTickets();
  res.json({ tickets, source: "representative" });
});

// /api/vendor/submissions — vendor invoices/milestones via the vendor API
router.get("/vendor/submissions", async (_req, res) => {
  const submissions = await listVendorSubmissions();
  res.json({ submissions, source: "representative" });
});

export default router;
