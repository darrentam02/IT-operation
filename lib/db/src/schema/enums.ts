import { pgEnum } from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", [
  "SUPER_ADMIN",
  "DEPUTY_HEAD_OF_IT",
  "TEAM_LEAD",
  "IT_COLLEAGUE",
  "FINANCE_AUDITOR",
  "VENDOR_API",
]);

export const regionCode = pgEnum("region_code", ["HK", "CN", "MY", "ID"]);

export const envType = pgEnum("env_type", ["SIT", "UAT", "STAGING", "PROD"]);

export const prPoStatus = pgEnum("pr_po_status", [
  "PR_DRAFT",
  "PR_APPROVED",
  "PO_ISSUED",
  "MILESTONE_RECEIVED",
  "INVOICE_PENDING",
  "VARIANCE_BLOCKED",
  "PAYMENT_APPROVED",
  "PAID",
]);

export const budgetCategory = pgEnum("budget_category", [
  "HARDWARE",
  "SOFTWARE",
  "DATA",
  "SERVICES",
]);
