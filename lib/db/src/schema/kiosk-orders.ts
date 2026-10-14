import { bigserial, integer, jsonb, pgTable, timestamp, varchar, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import type { z } from "zod/v4";

/** Only confirmed order snapshots. No audio, utterances, debug data or customer identity. */
export const kioskOrdersTable = pgTable("kiosk_orders", {
  orderNumber: bigserial("order_number", { mode: "bigint" }).primaryKey(),
  confirmationKey: varchar("confirmation_key", { length: 64 }).notNull().unique(),
  items: jsonb("items").$type<unknown[]>().notNull(),
  total: integer("total").notNull(),
  itemCount: integer("item_count").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
  // completedAt is the legacy customer-confirmation timestamp, NOT fulfillment.
  fulfillmentStatus: varchar("fulfillment_status", { length: 16 }).$type<"pending" | "preparing" | "completed">().notNull().default("pending"),
  fulfillmentVersion: integer("fulfillment_version").notNull().default(0),
  preparationStartedAt: timestamp("preparation_started_at", { withTimezone: true }),
  fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
}, (table) => [
  index("kiosk_orders_fulfillment_queue_idx").on(table.fulfillmentStatus, table.orderNumber),
  check("kiosk_orders_fulfillment_status_check", sql`${table.fulfillmentStatus} in ('pending', 'preparing', 'completed')`),
]);

export const insertKioskOrderSchema = createInsertSchema(kioskOrdersTable).omit({ orderNumber: true, completedAt: true });
export type InsertKioskOrder = z.infer<typeof insertKioskOrderSchema>;
export type KioskOrderRecord = typeof kioskOrdersTable.$inferSelect;
