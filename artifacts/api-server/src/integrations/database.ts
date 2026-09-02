import { readEnv, type IntegrationStatus } from "./config";

export async function checkDatabaseHealth(): Promise<IntegrationStatus> {
  if (!readEnv("DATABASE_URL")) {
    return {
      name: "database",
      configured: false,
      status: "not_configured",
      message: "DATABASE_URL not configured",
    };
  }
  const start = Date.now();
  try {
    const mod = (await import("@workspace/db")) as {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pool?: { query: (text: string) => Promise<{ rows: any[] }> };
    };
    if (!mod?.pool) {
      return {
        name: "database",
        configured: true,
        status: "error",
        message: "pg pool failed to initialize",
      };
    }
    const result = await mod.pool.query("SELECT 1 AS ok");
    return {
      name: "database",
      configured: true,
      status: "ok",
      latencyMs: Date.now() - start,
      message: `Postgres reachable (${String(result.rows[0]?.ok)})`,
    };
  } catch (err) {
    return {
      name: "database",
      configured: true,
      status: "error",
      latencyMs: Date.now() - start,
      message: err instanceof Error ? err.message.split("\n")[0] : "Unknown error",
    };
  }
}
