import { z } from "zod";
import { makeItem } from "../services/cartService";
import type { CartItem } from "../services/orderTypes";

export const SlotSchema = z.strictObject({
  menuId: z.string(), quantity: z.number().int().min(1).max(20),
  temperature: z.enum(["ice", "hot"]), size: z.enum(["M", "L"]), options: z.array(z.string()),
});
export type Slots = z.infer<typeof SlotSchema>;
export const ExpectedSchema = z.strictObject({
  cart: z.array(SlotSchema), needsClarification: z.boolean(),
  rejectionCodes: z.array(z.enum(["NO_AUDIO", "NO_SPEECH", "AUDIO_FORMAT", "AUDIO_TOO_LARGE"])).default([]),
});
export const GroupSchema = z.strictObject({
  dialect: z.enum(["standard", "gyeongsang", "jeolla", "chungcheong"]),
  condition: z.enum(["normal", "quiet", "fast", "noisy", "no-speech", "ambiguous"]),
});
const ConsentSchema = z.strictObject({
  purposeAgreed: z.literal(true), externalProcessingAgreed: z.literal(true),
  deidentifiedReviewed: z.literal(true), withdrawn: z.literal(false),
  recordedAt: z.string().datetime(), deleteBy: z.string().datetime(),
});
export const CorpusSchema = z.strictObject({
  version: z.literal(1),
  cases: z.array(z.strictObject({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    group: GroupSchema,
    device: z.strictObject({ os: z.string().max(80), browser: z.string().max(80), microphone: z.string().max(80) }),
    consent: ConsentSchema,
    initialCart: z.array(SlotSchema).default([]),
    turns: z.array(z.strictObject({
      audioFile: z.string().min(1), expected: ExpectedSchema,
    })).min(1),
  })).min(1),
});
export type Corpus = z.infer<typeof CorpusSchema>;
export type Group = z.infer<typeof GroupSchema>;
export type Expected = z.infer<typeof ExpectedSchema>;

export function assertConsent(consent: Corpus["cases"][number]["consent"], now = Date.now()) {
  if (!consent.purposeAgreed || !consent.externalProcessingAgreed || !consent.deidentifiedReviewed || consent.withdrawn) {
    throw new Error("CONSENT_REQUIRED");
  }
  const recorded = Date.parse(consent.recordedAt), expires = Date.parse(consent.deleteBy);
  if (!Number.isFinite(recorded) || !Number.isFinite(expires) || recorded > now ||
      expires <= now || expires <= recorded || expires - recorded > 7 * 24 * 60 * 60 * 1000) {
    throw new Error("CONSENT_EXPIRED_OR_INVALID");
  }
}

export function validateSlots(slots: Slots[]) {
  for (const s of slots) makeItem(s.menuId, s.quantity, s.temperature, s.size, s.options);
}

export function fromCart(items: CartItem[]): Slots[] {
  return items.map((i) => ({
    menuId: i.menuId, quantity: i.quantity, temperature: i.temperature,
    size: i.size as Slots["size"], options: i.options.map((o) => o.id),
  }));
}

function aggregate(items: Slots[], key: (item: Slots) => string) {
  const totals = new Map<string, number>();
  for (const item of items) totals.set(key(item), (totals.get(key(item)) ?? 0) + item.quantity);
  return JSON.stringify([...totals].sort(([a], [b]) => a.localeCompare(b)));
}
const signature = (i: Slots) => JSON.stringify([i.menuId, i.temperature, i.size, [...i.options].sort()]);
export function sameCart(actual: Slots[], expected: Slots[]) {
  return aggregate(actual, signature) === aggregate(expected, signature);
}
export function scoreCart(actual: Slots[], expected: Slots[]) {
  const menus = (items: Slots[]) => JSON.stringify([...new Set(items.map((i) => i.menuId))].sort());
  return {
    exactCart: sameCart(actual, expected),
    menuCorrect: menus(actual) === menus(expected),
    quantityCorrect: aggregate(actual, (i) => i.menuId) === aggregate(expected, (i) => i.menuId),
    optionsCorrect: aggregate(actual, signature) === aggregate(expected, signature),
  };
}
