import { bigint, bigserial, boolean, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import type { z } from "zod/v4";
import { kioskOrdersTable } from "./kiosk-orders";

/** Provisioned by an operator, never through public signup or client metadata. */
export const kioskStaffTable = pgTable("kiosk_staff", {
  userId: varchar("user_id", { length: 128 }).primaryKey(),
  active: boolean("active").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertKioskStaffSchema = createInsertSchema(kioskStaffTable);
export type InsertKioskStaff = z.infer<typeof insertKioskStaffSchema>;
export type KioskStaffRecord = typeof kioskStaffTable.$inferSelect;

/** Written in the same transaction as each fulfillment transition. */
export const kioskOrderEventsTable = pgTable("kiosk_order_events", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  orderNumber: bigint("order_number", { mode: "bigint" }).notNull().references(() => kioskOrdersTable.orderNumber, { onDelete: "cascade" }),
  actorUserId: varchar("actor_user_id", { length: 128 }).notNull(),
  fromStatus: varchar("from_status", { length: 16 }).notNull(),
  toStatus: varchar("to_status", { length: 16 }).notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertKioskOrderEventSchema = createInsertSchema(kioskOrderEventsTable).omit({ id: true, changedAt: true });
export type InsertKioskOrderEvent = z.infer<typeof insertKioskOrderEventSchema>;
export type KioskOrderEventRecord = typeof kioskOrderEventsTable.$inferSelect;
