export type IntegrationStatus = {
  name: string;
  configured: boolean;
  status: "ok" | "not_configured" | "error";
  latencyMs?: number;
  message?: string;
};

export function readEnv(key: string): string | undefined {
  const value = process.env[key];
  if (!value || value.trim() === "" || value.toUpperCase().includes("PASTE") || value.toUpperCase().includes("YOUR_")) {
    return undefined;
  }
  return value.trim();
}
