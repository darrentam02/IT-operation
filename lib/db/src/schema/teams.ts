import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { profiles } from "./profiles";

// teams.team_lead_id references profiles(id) (defined in profiles.ts);
// the circular FK is only enforced in the SQL migration for profiles.team_id.
export const teams = pgTable("teams", {
  id: uuid("id")
    .primaryKey()
    .default(sql`uuid_generate_v4()`),
  teamName: text("team_name").notNull(),
  teamLeadId: uuid("team_lead_id").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`NOW()`),
});
