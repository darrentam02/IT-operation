import { readEnv, type IntegrationStatus } from "./config";

export type SupabaseConfig = {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  databaseUrl: string;
};

export function getSupabaseConfig(): Partial<SupabaseConfig> {
  return {
    url: readEnv("SUPABASE_URL"),
    anonKey: readEnv("SUPABASE_ANON_KEY"),
    serviceRoleKey: readEnv("SUPABASE_SERVICE_ROLE_KEY"),
    databaseUrl: readEnv("DATABASE_URL"),
  };
}

export function isSupabaseConfigured(): boolean {
  const cfg = getSupabaseConfig();
  return Boolean(cfg.url && cfg.anonKey && cfg.serviceRoleKey);
}

export async function checkSupabaseHealth(): Promise<IntegrationStatus> {
  const cfg = getSupabaseConfig();
  if (!isSupabaseConfigured()) {
    return {
      name: "supabase",
      configured: false,
      status: "not_configured",
      message: "SUPABASE_URL / keys not configured",
    };
  }
  const start = Date.now();
  try {
    const res = await fetch(`${cfg.url}/auth/v1/settings`, {
      headers: { apikey: cfg.anonKey as string },
    });
    return {
      name: "supabase",
      configured: true,
      status: res.ok ? "ok" : "error",
      latencyMs: Date.now() - start,
      message: res.ok ? "Auth API reachable" : `Auth API returned ${res.status}`,
    };
  } catch (err) {
    return {
      name: "supabase",
      configured: true,
      status: "error",
      latencyMs: Date.now() - start,
      message: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export const supabase = {
  config: getSupabaseConfig,
  isConfigured: isSupabaseConfigured,
  health: checkSupabaseHealth,
};
