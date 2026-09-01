import {
  askRag,
  ingestStatus,
  isRagConfigured,
  RAG_DOCUMENTS,
  reingest,
  type Citation,
  type RagAnswer,
  type RagChatMessage,
  type RagDocument,
  type RagIngestStatus,
} from "../lib/rag-runtime";
import { readEnv, type IntegrationStatus } from "./config";

export type {
  Citation,
  RagAnswer,
  RagChatMessage,
  RagDocument,
  RagIngestStatus,
} from "../lib/rag-runtime";

export { RAG_DOCUMENTS } from "../lib/rag-runtime";

export type DeepSeekConfig = {
  apiKey: string;
  proModel: string;
  flashModel: string;
};

export function getDeepSeekConfig(): Partial<DeepSeekConfig> {
  return {
    apiKey: readEnv("DEEPSEEK_API_KEY"),
    proModel: readEnv("DEEPSEEK_MODEL") ?? readEnv("DEEPSEEK_PRO_MODEL") ?? "deepseek-chat",
    flashModel: readEnv("DEEPSEEK_FLASH_MODEL") ?? "deepseek-chat",
  };
}

export function isDeepSeekConfigured(): boolean {
  return isRagConfigured().deepseek;
}

export async function checkDeepSeekHealth(): Promise<IntegrationStatus> {
  if (!isRagConfigured().deepseek) {
    return {
      name: "deepseek",
      configured: false,
      status: "not_configured",
      message: "DEEPSEEK_API_KEY not configured; using representative RAG data",
    };
  }
  const status = await ingestStatus();
  return {
    name: "deepseek",
    configured: true,
    status: "ok",
    message: status.live
      ? `Live RAG: ${status.chunks} chunks across ${status.documents.length} SOPs`
      : "API key configured (JINA/DeepSeek); PDF ingestion pending",
  };
}

export async function searchKnowledgeBase(query: string): Promise<RagAnswer> {
  return askRag(query, { topK: 5 });
}

export const deepseek = {
  config: getDeepSeekConfig,
  isConfigured: isDeepSeekConfigured,
  health: checkDeepSeekHealth,
  search: searchKnowledgeBase,
  documents: RAG_DOCUMENTS,
  reingest,
  status: ingestStatus,
};
