import { pgTable, uuid, text, boolean, timestamp, date } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { userRole, regionCode } from "./enums";

// profiles.id is tied to auth.users(id) in the SQL migration (Supabase auth).
// team_id is a plain column here; its FK to teams is enforced in the SQL
// migration to break the teams<->profiles cycle (see spec guardrail B).
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  fullName: text("full_name").notNull(),
  role: userRole("role").notNull().default("IT_COLLEAGUE"),
  teamId: uuid("team_id"),
  region: regionCode("region").notNull().default("HK"),
  deputyForUserId: uuid("deputy_for_user_id"),
  onLeave: boolean("on_leave").default(false),
  leaveStartDate: date("leave_start_date"),
  leaveEndDate: date("leave_end_date"),
  baseRole: userRole("base_role"),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`NOW()`),
});
