import { pgTable, uuid, text, jsonb, integer, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { profiles } from "./profiles";

export const dlqEntries = pgTable(
  "dlq_entries",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v4()`),
    status: text("status").notNull().default("PENDING"),
    payload: jsonb("payload").notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    retryCount: integer("retry_count").notNull().default(0),
    maxRetries: integer("max_retries").notNull().default(5),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by").references(() => profiles.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).default(sql`NOW()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`NOW()`),
  },
  (table) => [
    index("idx_dlq_status").on(table.status),
    index("idx_dlq_created").on(table.createdAt),
  ],
);

export type DlqEntry = typeof dlqEntries.$inferSelect;
export type NewDlqEntry = typeof dlqEntries.$inferInsert;
