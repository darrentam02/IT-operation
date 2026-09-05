import { readEnv } from "./config";

// Raw-fetch Supabase Storage client (service-role Bearer JWT), matching the
// style of supabase-auth.ts — no @supabase/supabase-js dependency server-side.
// The bucket `sop-library` feeds the Storage → pgvector indexing pipeline.

export const STORAGE_BUCKET = "sop-library";

export type StorageFileInfo = {
  name: string;
  updatedAt: string;
  size: number;
  mimetype: string | null;
};

function baseUrl(): string {
  return (readEnv("SUPABASE_URL") || "").replace(/\/$/, "");
}

function serviceRoleKey(): string | undefined {
  return readEnv("SUPABASE_SERVICE_ROLE_KEY");
}

export function isStorageConfigured(): boolean {
  return Boolean(baseUrl() && serviceRoleKey());
}

function authHeaders(): Record<string, string> {
  const key = serviceRoleKey() ?? "";
  return {
    Authorization: `Bearer ${key}`,
    apikey: key,
    "Content-Type": "application/json",
  };
}

export async function ensureStorageBucket(): Promise<void> {
  try {
    await fetch(`${baseUrl()}/storage/v1/bucket`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: STORAGE_BUCKET, public: false, file_size_limit: 25 * 1024 * 1024 }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    // 409/400 (already exists) or network error: both harmless — listing later
    // will surface whether the bucket is usable.
  }
}

export async function listStorageFiles(): Promise<StorageFileInfo[]> {
  const res = await fetch(`${baseUrl()}/storage/v1/object/list/${STORAGE_BUCKET}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      prefix: "",
      limit: 500,
      offset: 0,
      sortBy: { column: "name", order: "asc" },
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    name?: string;
    updated_at?: string;
    metadata?: { size?: number; mimetype?: string | null };
  }[];
  return (data ?? [])
    .filter((f) => typeof f.name === "string" && !String(f.name).endsWith("/"))
    .map((f) => ({
      name: String(f.name),
      updatedAt: String(f.updated_at ?? ""),
      size: Number(f.metadata?.size ?? 0),
      mimetype: f.metadata?.mimetype ?? null,
    }));
}

export async function downloadStorageFile(name: string): Promise<Buffer | null> {
  const encoded = name.split("/").map(encodeURIComponent).join("/");
  const res = await fetch(`${baseUrl()}/storage/v1/object/${STORAGE_BUCKET}/${encoded}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${serviceRoleKey() ?? ""}`,
      apikey: serviceRoleKey() ?? "",
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length ? buf : null;
}