import { pgTable, uuid, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { envType } from "./enums";
import { profiles } from "./profiles";

export const staffStatuses = pgTable("staff_statuses", {
  id: uuid("id")
    .primaryKey()
    .default(sql`uuid_generate_v4()`),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => profiles.id, { onDelete: "cascade" }),
  statusText: text("status_text").notNull(),
  activeTicketId: text("active_ticket_id"),
  environment: envType("environment").default("SIT"),
  etaCompletion: timestamp("eta_completion", { withTimezone: true }),
  isStale: boolean("is_stale").default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`NOW()`),
});
