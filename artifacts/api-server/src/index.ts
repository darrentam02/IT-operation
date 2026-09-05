import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

// Resolve the repo-root .env regardless of the process cwd (pnpm runs from
// the package dir). Fallbacks: cwd ".env", then up from dist/ to repo root.
function resolveEnvPath(): string | undefined {
  const fromDist = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(".env"),
    resolve(fromDist, "..", "..", "..", ".env"),
    resolve("/root/projects/IT-Operations-Control-Tower/.env"),
  ];
  return candidates.find((p) => existsSync(p));
}

try {
  const envPath = resolveEnvPath();
  if (envPath) {
    process.loadEnvFile?.(envPath);
  }
} catch {
  // ignore missing/invalid .env; env vars may come from the environment
}

import app from "./app";
import { logger } from "./lib/logger";
import { readEnv } from "./integrations/config";
import { runStorageSync } from "./lib/rag-storage";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Storage → pgvector sweep: index new/changed PDFs in `sop-library` and drop
  // chunks for removed files. Cadence is configurable; unref so it never
  // holds the process open. Failures are logged inside the sweep.
  const syncMs = Number(readEnv("RAG_STORAGE_SYNC_MS")) || 300_000;
  const storageTimer = setInterval(() => {
    void runStorageSync()
      .then(() => {})
      .catch((syncErr) => logger.error({ err: syncErr }, "Storage sweep error"));
  }, syncMs);
  storageTimer.unref();
});
