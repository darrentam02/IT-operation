/**
 * Budget import — hand-authored zod schemas.
 *
 * These extend the orval-generated surface in ./generated: the budget
 * import/export feature was added after schema generation. Row keys mirror
 * GetBudgetSummaryResponseItem so import, summary, and export stay symmetric.
 */
import * as zod from "zod";

export const BudgetImportRowSchema = zod.object({
  fiscalYear: zod.number().int().min(2000).max(2100),
  category: zod.string().trim().min(1).max(120),
  allocated: zod.number().min(0),
  incurred: zod.number().min(0).optional(),
});

export const BudgetImportBodySchema = zod.object({
  rows: zod.array(BudgetImportRowSchema).min(1).max(200),
});

export const BudgetImportSuccessSchema = zod.object({
  imported: zod.number(),
  updated: zod.number(),
  years: zod.array(zod.number()),
});

export const BudgetImportErrorItemSchema = zod.object({
  row: zod.number(),
  field: zod.string(),
  message: zod.string(),
});

export const BudgetImportErrorSchema = zod.object({
  errors: zod.array(BudgetImportErrorItemSchema),
});

