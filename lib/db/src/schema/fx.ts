import { pgTable, uuid, varchar, numeric, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const fxRates = pgTable("fx_rates", {
  id: uuid("id")
    .primaryKey()
    .default(sql`uuid_generate_v4()`),
  baseCurrency: varchar("base_currency", { length: 3 }).notNull().default("HKD"),
  quoteCurrency: varchar("quote_currency", { length: 3 }).notNull(),
  rate: numeric("rate", { precision: 18, scale: 6 }).notNull(),
  effectiveAt: timestamp("effective_at", { withTimezone: true }).default(sql`NOW()`),
});
