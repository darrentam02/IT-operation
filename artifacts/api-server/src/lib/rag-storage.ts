import { logger } from "./logger";
import { resolveStore, saveDocumentChunks, removeIndexedSource, listIndexedSources, recordStorageIndex } from "./rag-store";
import { indexPdfBuffer } from "./rag-runtime";
import {
  STORAGE_BUCKET,
  ensureStorageBucket,
  isStorageConfigured,
  listStorageFiles,
  downloadStorageFile,
  type StorageFileInfo,
} from "../integrations/supabase-storage";

// Storage → pgvector sweep.
//
// Scans the `sop-library` bucket, diffs against the last-indexed cursor
// (rag_storage_docs.name → updated_at), indexes new/changed PDFs into
// rag_chunks via the per-document upsert path, and drops chunks for files
// removed from the bucket. Runs on a timer at boot (RAG_STORAGE_SYNC_MS) and
// on demand via POST /api/rag/storage/sync. Failures are logged, never fatal.

export type StorageSyncResult = {
  scanned: number;
  indexed: number;
  updated: number;
  removed: number;
  errors: string[];
};

function isPdf(file: StorageFileInfo): boolean {
  if (file.mimetype && !file.mimetype.includes("pdf")) return false;
  return /\.pdf$/i.test(file.name);
}

export async function runStorageSync(): Promise<StorageSyncResult> {
  const result: StorageSyncResult = { scanned: 0, indexed: 0, updated: 0, removed: 0, errors: [] };

  if (!isStorageConfigured()) {
    result.errors.push("Storage not configured (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required)");
    return result;
  }

  const store = await resolveStore();
  if (store.mode !== "pgvector" || !store.pool) {
    result.errors.push("Storage sync requires the pgvector store (RAG_VECTOR_STORE=pgvector)");
    return result;
  }

  try {
    await ensureStorageBucket();
    const files = (await listStorageFiles()).filter(isPdf);
    const indexed = await listIndexedSources(store.pool);

    const fileNames = new Set(files.map((f) => f.name));

    for (const name of indexed.keys()) {
      if (!fileNames.has(name)) {
        await removeIndexedSource(store.pool, name);
        result.removed += 1;
      }
    }

    const batchErrors: string[] = [];
    for (const file of files) {
      const known = indexed.get(file.name);
      if (known === file.updatedAt) {
        result.scanned += 1;
        continue;
      }
      const buffer = await downloadStorageFile(file.name);
      if (!buffer) {
        batchErrors.push(`download failed: ${file.name}`);
        continue;
      }
      const chunks = await indexPdfBuffer(buffer, file.name);
      if (!chunks || !chunks.length) {
        batchErrors.push(`extract/embed failed: ${file.name}`);
        continue;
      }
      const saved = await saveDocumentChunks(store.pool, file.name, chunks);
      if (!saved) {
        batchErrors.push(`persist failed: ${file.name}`);
        continue;
      }
      await recordStorageIndex(store.pool, file.name, file.updatedAt, chunks.length);
      if (known === undefined) result.indexed += 1;
      else result.updated += 1;
      result.scanned += 1;
    }

    result.errors = batchErrors.slice(0, 10);
    if (result.indexed || result.updated || result.removed || result.errors.length) {
      logger.info(
        { bucket: STORAGE_BUCKET, scanned: result.scanned, indexed: result.indexed, updated: result.updated, removed: result.removed, errors: result.errors.length },
        "Storage → pgvector sweep complete",
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    result.errors.push(message);
    logger.error({ err: error }, "Storage → pgvector sweep failed");
  }

  return result;
}