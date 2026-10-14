import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import type { z } from "zod/v4";

/** Temporary capability-scoped context, including short-lived confirmation replay. */
export const kioskSessionsTable = pgTable("kiosk_sessions", {
  id: uuid("id").primaryKey(),
  revision: integer("revision").notNull().default(0),
  status: text("status", { enum: ["active", "completed"] }).notNull().default("active"),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  lastActivity: timestamp("last_activity", { withTimezone: true }).notNull().defaultNow(),
  lockToken: uuid("lock_token"),
  lockUntil: timestamp("lock_until", { withTimezone: true }),
}, (table) => [index("kiosk_sessions_idle_idx").on(table.lastActivity)]);

export const insertKioskSessionSchema = createInsertSchema(kioskSessionsTable);
export type InsertKioskSession = z.infer<typeof insertKioskSessionSchema>;
export type KioskSessionRecord = typeof kioskSessionsTable.$inferSelect;
