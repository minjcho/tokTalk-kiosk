import { z } from "zod";
import { GetSessionResponse, ConfirmOrderResponse, SubmitTextOrderResponse, GetSessionDebugResponse } from "@workspace/api-zod";
import { menu } from "./menuService";

export type SessionView = z.infer<typeof GetSessionResponse>;
export type CartItem = SessionView["items"][number];
export type Receipt = z.infer<typeof ConfirmOrderResponse>;
export type OrderResult = z.infer<typeof SubmitTextOrderResponse>;
export type SessionDebug = z.infer<typeof GetSessionDebugResponse>;

export const ActionSchema = z.strictObject({
  type: z.enum(["add", "remove", "set_quantity", "update", "cancel"]),
  menuId: z.enum(menu.map((m) => m.menuId) as [string, ...string[]]).nullable(),
  targetItemId: z.string().nullable(),
  quantity: z.number().int().min(1).max(20).nullable(),
  temperature: z.enum(["ice", "hot"]).nullable(),
  size: z.enum(["M", "L"]).nullable(),
  addOptions: z.array(z.enum([...new Set(menu.flatMap((m) => m.availableOptions.map((o) => o.id)))] as [string, ...string[]])).max(8),
  removeOptions: z.array(z.enum([...new Set(menu.flatMap((m) => m.availableOptions.map((o) => o.id)))] as [string, ...string[]])).max(8),
});
export const ParsedOrderSchema = z.strictObject({
  needsClarification: z.boolean(),
  question: z.string().nullable(),
  message: z.string(),
  actions: z.array(ActionSchema).max(20),
});
export type OrderAction = z.infer<typeof ActionSchema>;
export type ParsedOrder = z.infer<typeof ParsedOrderSchema>;
// Internal extraction metadata, not an API contract or customer-visible order field.
export const ConversationOrderSchema = ParsedOrderSchema.extend({
  defaultsAccepted: z.boolean(),
  customizationConfirmed: z.boolean(),
});

/** The provider must choose a real cart ID or null, never a fabricated draft ID. */
export function conversationOrderSchemaFor(itemIds: string[]) {
  const targetItemId = itemIds.length
    ? z.enum(itemIds as [string, ...string[]]).nullable()
    : z.null();
  return ConversationOrderSchema.extend({
    actions: z.array(ActionSchema.extend({ targetItemId })).max(20),
  });
}
