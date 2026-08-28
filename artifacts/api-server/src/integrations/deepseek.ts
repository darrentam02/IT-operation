import { readEnv, type IntegrationStatus } from "./config";

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

export type DeepSeekConfig = {
  apiKey: string;
  proModel: string;
  flashModel: string;
};

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

export function getDeepSeekConfig(): Partial<DeepSeekConfig> {
  return {
    apiKey: readEnv("DEEPSEEK_API_KEY"),
    proModel: readEnv("DEEPSEEK_PRO_MODEL") ?? "deepseek-v4-pro",
    flashModel: readEnv("DEEPSEEK_FLASH_MODEL") ?? "deepseek-v4-flash",
  };
}

export function isDeepSeekConfigured(): boolean {
  return Boolean(getDeepSeekConfig().apiKey);
}

const SIMILARITY_THRESHOLD = 0.78;

export async function checkDeepSeekHealth(): Promise<IntegrationStatus> {
  if (!isDeepSeekConfigured()) {
    return {
      name: "deepseek",
      configured: false,
      status: "not_configured",
      message: "DEEPSEEK_API_KEY not configured; using representative RAG data",
    };
  }
  return {
    name: "deepseek",
    configured: true,
    status: "ok",
    message: "API key configured",
  };
}

function embedStub(text: string): number[] {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return [hash % 100000, text.length % 1000];
}

async function embed(text: string): Promise<number[]> {
  return embedStub(text);
}

function cosine(a: number[], b: number[]): number {
  const norm = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  let dot = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) dot += a[i] * b[i];
  const na = norm(a);
  const nb = norm(b);
  return na && nb ? dot / (na * nb) : 0;
}

type RetrievedChunk = { doc: RagDocument; similarity: number };

async function retrieve(query: string, topK: number): Promise<RetrievedChunk[]> {
  const q = await embed(query);
  return RAG_DOCUMENTS.map((doc) => ({
    doc,
    similarity: cosine(q, embedStub(doc.content)),
  }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);
}

export type RagAnswer = {
  answer: string;
  confidence: number;
  citations: Citation[];
};

export async function searchKnowledgeBase(query: string): Promise<RagAnswer> {
  const chunks = await retrieve(query, 5);

  if (!chunks.length || chunks[0].similarity < SIMILARITY_THRESHOLD) {
    return {
      answer:
        "I cannot find an exact reference in the verified IT procedures manual. Please consult the Head of IT.",
      confidence: 0,
      citations: [],
    };
  }

  return {
    answer: "Representative RAG answer. Connect DeepSeek API + pgvector for live retrieval-augmented generation.",
    confidence: Number(chunks[0].similarity.toFixed(2)),
    citations: chunks.map(({ doc }) => ({
      document: doc.document,
      section: doc.section,
      page: doc.page,
      excerpt: doc.content.slice(0, 140),
    })),
  };
}

export const deepseek = {
  config: getDeepSeekConfig,
  isConfigured: isDeepSeekConfigured,
  health: checkDeepSeekHealth,
  search: searchKnowledgeBase,
  documents: RAG_DOCUMENTS,
};
