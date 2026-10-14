import { index, integer, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import type { z } from "zod/v4";

/** Short-lived counters only; never store IPs, audio, transcripts or request IDs. */
export const kioskRateLimitsTable = pgTable("kiosk_rate_limits", {
  key: varchar("key", { length: 64 }).primaryKey(),
  count: integer("count").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [index("kiosk_rate_limits_expiry_idx").on(table.expiresAt)]);

export const insertKioskRateLimitSchema = createInsertSchema(kioskRateLimitsTable);
export type InsertKioskRateLimit = z.infer<typeof insertKioskRateLimitSchema>;
export type KioskRateLimit = typeof kioskRateLimitsTable.$inferSelect;
