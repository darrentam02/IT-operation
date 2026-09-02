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
    const result = await mod.pool.query(
      `SELECT current_database() AS db,
              current_user AS usr,
              (SELECT count(*) FROM information_schema.tables
                WHERE table_schema='public' AND table_name='budget_lines') AS budget_lines,
              (SELECT count(*) FROM information_schema.tables
                WHERE table_schema='public' AND table_name='payment_schedules') AS payment_schedules,
              (SELECT count(*) FROM information_schema.tables
                WHERE table_schema='public' AND table_name='procurement_records') AS procurement_records`,
    );
    const r0 = result.rows[0] ?? {};
    return {
      name: "database",
      configured: true,
      status: "ok",
      latencyMs: Date.now() - start,
      message: `reachable db=${String(r0.db)} user=${String(r0.usr)} budget_lines=${String(r0.budget_lines)} payment_schedules=${String(r0.payment_schedules)} procurement_records=${String(r0.procurement_records)}`,
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
