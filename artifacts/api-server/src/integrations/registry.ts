import { checkSupabaseHealth } from "./supabase";
import { checkDeepSeekHealth } from "./deepseek";
import { checkJiraHealth } from "./jira";
import { checkVendorHealth } from "./vendor";
import type { IntegrationStatus } from "./config";

export async function healthRegistry(): Promise<IntegrationStatus[]> {
  const [s, d, j, v] = await Promise.all([
    checkSupabaseHealth(),
    checkDeepSeekHealth(),
    checkJiraHealth(),
    checkVendorHealth(),
  ]);
  return [s, d, j, v];
}
