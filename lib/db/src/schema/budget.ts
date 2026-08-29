import { pgTable, uuid, integer, text, numeric, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { budgetCategory } from "./enums";
import { profiles } from "./profiles";

export const budgetLines = pgTable(
  "budget_lines",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v4()`),
    fiscalYear: integer("fiscal_year").notNull(),
    category: budgetCategory("category").notNull(),
    description: text("description"),
    allocatedAmount: numeric("allocated_amount", { precision: 15, scale: 2 }).notNull().default("0"),
    incurredAmount: numeric("incurred_amount", { precision: 15, scale: 2 }).notNull().default("0"),
    paidAmount: numeric("paid_amount", { precision: 15, scale: 2 }).notNull().default("0"),
    createdBy: uuid("created_by").references(() => profiles.id),
    createdAt: timestamp("created_at", { withTimezone: true }).default(sql`NOW()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`NOW()`),
  },
  (table) => [uniqueIndex("budget_lines_year_cat_key").on(table.fiscalYear, table.category)],
);

export type BudgetLine = typeof budgetLines.$inferSelect;
export type NewBudgetLine = typeof budgetLines.$inferInsert;