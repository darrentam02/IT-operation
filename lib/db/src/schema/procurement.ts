import {
  pgTable,
  uuid,
  text,
  varchar,
  numeric,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { regionCode, prPoStatus } from "./enums";
import { profiles } from "./profiles";

export const vendors = pgTable(
  "vendors",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v4()`),
    vendorName: text("vendor_name").notNull(),
    region: regionCode("region").notNull(),
    contact: text("contact"),
    deliveryAddress: text("delivery_address"),
    paymentTerms: text("payment_terms"),
    taxId: text("tax_id"),
    apiKeyHash: text("api_key_hash"),
    createdBy: uuid("created_by").references(() => profiles.id),
    createdAt: timestamp("created_at", { withTimezone: true }).default(sql`NOW()`),
  },
  (table) => [uniqueIndex("vendors_api_key_hash_key").on(table.apiKeyHash)],
);

export const procurementRecords = pgTable(
  "procurement_records",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v4()`),
    prNumber: text("pr_number").notNull(),
    poNumber: text("po_number"),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id),
    region: regionCode("region").notNull(),
    localCurrency: varchar("local_currency", { length: 3 }).notNull(),
    localAmount: numeric("local_amount", { precision: 15, scale: 2 }).notNull(),
    hkdAmount: numeric("hkd_amount", { precision: 15, scale: 2 }).notNull(),
    fxRate: numeric("fx_rate", { precision: 18, scale: 6 }).notNull(),
    paymentTerms: text("payment_terms"),
    deliveryAddress: text("delivery_address"),
    taxId: text("tax_id"),
    status: prPoStatus("status").default("PR_DRAFT"),
    createdBy: uuid("created_by").references(() => profiles.id),
    level1Approver: uuid("level_1_approver").references(() => profiles.id),
    level2Approver: uuid("level_2_approver").references(() => profiles.id),
    level3Approver: uuid("level_3_approver").references(() => profiles.id),
    createdAt: timestamp("created_at", { withTimezone: true }).default(sql`NOW()`),
  },
  (table) => [
    uniqueIndex("procurement_records_pr_number_key").on(table.prNumber),
    uniqueIndex("procurement_records_po_number_key").on(table.poNumber),
  ],
);

export const costAllocations = pgTable(
  "cost_allocations",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v4()`),
    procurementId: uuid("procurement_id").references(() => procurementRecords.id, {
      onDelete: "cascade",
    }),
    businessUnit: text("business_unit").notNull(),
    percentageShare: numeric("percentage_share", { precision: 5, scale: 2 }).notNull(),
  },
  (table) => [
    index("cost_allocations_procurement_id_idx").on(table.procurementId),
    {
      percentageCheck: sql`CHECK (percentage_share > 0 AND percentage_share <= 100)`,
    },
  ],
);

export const paymentSchedules = pgTable(
  "payment_schedules",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v4()`),
    procurementId: uuid("procurement_id").references(() => procurementRecords.id, {
      onDelete: "cascade",
    }),
    dueDate: timestamp("due_date", { mode: "date" }).notNull(),
    amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
    isVarianceDetected: boolean("is_variance_detected").default(false),
    dualSignoffHeadId: uuid("dual_signoff_head_id").references(() => profiles.id),
    dualSignoffFinanceId: uuid("dual_signoff_finance_id").references(
      () => profiles.id,
    ),
    paidAt: timestamp("paid_at", { withTimezone: true }),
  },
  (table) => [index("payment_schedules_procurement_id_idx").on(table.procurementId)],
);
