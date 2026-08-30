import { pgTable, uuid, numeric, timestamp, text, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { threeWayMatchStatus } from "./enums";
import { procurementRecords } from "./procurement";
import { paymentSchedules } from "./procurement";
import { profiles } from "./profiles";

export const threeWayMatches = pgTable(
  "three_way_matches",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v4()`),
    procurementId: uuid("procurement_id")
      .notNull()
      .references(() => procurementRecords.id, { onDelete: "cascade" }),
    paymentScheduleId: uuid("payment_schedule_id").references(() => paymentSchedules.id, { onDelete: "set null" }),
    poAmount: numeric("po_amount", { precision: 15, scale: 2 }).notNull(),
    invoiceAmount: numeric("invoice_amount", { precision: 15, scale: 2 }),
    milestoneAmount: numeric("milestone_amount", { precision: 15, scale: 2 }),
    priceVariance: numeric("price_variance", { precision: 15, scale: 2 }),
    shippingTaxVariance: numeric("shipping_tax_variance", { precision: 15, scale: 2 }),
    status: threeWayMatchStatus("status").default("PENDING"),
    matchedAt: timestamp("matched_at", { withTimezone: true }),
    matchedBy: uuid("matched_by").references(() => profiles.id),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).default(sql`NOW()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`NOW()`),
  },
  (table) => [
    index("three_way_matches_procurement_idx").on(table.procurementId),
    uniqueIndex("three_way_matches_proc_pay_key").on(
      table.procurementId,
      table.paymentScheduleId,
    ),
  ],
);

export type ThreeWayMatch = typeof threeWayMatches.$inferSelect;
export type NewThreeWayMatch = typeof threeWayMatches.$inferInsert;