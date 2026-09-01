import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

/*
 * RAG assistant client for the integration endpoints added on the api-server
 * (/api/rag/chat, /api/rag/status, /api/rag/documents, /api/rag/ingest).
 * These sit outside the generated @workspace/api-client-react surface, so we
 * fetch the relative /api paths directly (Vite proxies them to the api-server).
 */

export type Citation = {
  document: string;
  section: string;
  page: number;
  excerpt: string;
};

export type RagAnswer = {
  answer: string;
  confidence: number;
  citations: Citation[];
};

export type RagChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export type RagDocument = {
  id: string;
  document: string;
  section: string;
  page: number;
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
  store: 'pgvector' | 'memory';
};

type ChatResponse = RagAnswer;
type DocumentsResponse = { documents: RagDocument[]; live: boolean };

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`);
  return (await res.json()) as T;
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`);
  return (await res.json()) as T;
}

function getRagStatus() {
  return getJSON<RagIngestStatus>('/api/rag/status');
}
function getRagDocuments() {
  return getJSON<DocumentsResponse>('/api/rag/documents');
}

export const ragStatusKey = ['rag', 'status'] as const;
export const ragDocumentsKey = ['rag', 'documents'] as const;

export function useRagStatus() {
  return useQuery({
    queryKey: ragStatusKey,
    queryFn: getRagStatus,
    refetchInterval: 60000,
  });
}

export function useRagDocuments() {
  return useQuery({
    queryKey: ragDocumentsKey,
    queryFn: getRagDocuments,
    staleTime: 60000,
  });
}

export function useRagChat() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { question: string; history?: RagChatMessage[] }) =>
      postJSON<ChatResponse>('/api/rag/chat', {
        question: input.question,
        history: input.history ?? [],
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['rag', 'status'] });
    },
  });
}

export function useRagIngest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => postJSON<RagIngestStatus>('/api/rag/ingest', {}),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['rag', 'status'] });
      void client.invalidateQueries({ queryKey: ['rag', 'documents'] });
    },
  });
}
