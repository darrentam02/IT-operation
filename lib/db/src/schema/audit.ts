import { pgTable, uuid, text, jsonb, boolean, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { profiles } from "./profiles";

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id")
    .primaryKey()
    .default(sql`uuid_generate_v4()`),
  actorId: uuid("actor_id").references(() => profiles.id),
  actionType: text("action_type").notNull(),
  targetResource: text("target_resource").notNull(),
  oldValue: jsonb("old_value"),
  newValue: jsonb("new_value"),
  actedAsDeputy: boolean("acted_as_deputy").default(false),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`NOW()`),
});
