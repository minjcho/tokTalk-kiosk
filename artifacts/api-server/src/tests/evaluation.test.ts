import { test } from "node:test";
import assert from "node:assert/strict";
import { assertConsent, CorpusSchema, sameCart, scoreCart, type Slots } from "../evaluation/criteria";
import { textCases } from "../evaluation/textCases";

const cup: Slots = { menuId: "americano", quantity: 1, temperature: "ice", size: "M", options: [] };
test("slot comparison ignores row ID/order/splits but never wrong quantities or options", () => {
  assert.equal(sameCart([cup, cup], [{ ...cup, quantity: 2 }]), true);
  assert.equal(scoreCart([cup], [{ ...cup, quantity: 2 }]).quantityCorrect, false);
  const wrong = scoreCart([{ ...cup, options: ["shot"] }], [cup]);
  assert.equal(wrong.menuCorrect, true); assert.equal(wrong.quantityCorrect, true);
  assert.equal(wrong.optionsCorrect, false); assert.equal(wrong.exactCart, false);
  assert.equal(sameCart([cup], [{ ...cup, temperature: "hot" }]), false);
});
test("consent blocks withdrawn, missing external processing and expiry or >7-day retention", () => {
  const now = Date.UTC(2026, 9, 14);
  const consent = { purposeAgreed: true as const, externalProcessingAgreed: true as const,
    deidentifiedReviewed: true as const, withdrawn: false as const,
    recordedAt: new Date(now - 1000).toISOString(), deleteBy: new Date(now + 1000).toISOString() };
  assert.doesNotThrow(() => assertConsent(consent, now));
  assert.throws(() => assertConsent({ ...consent, deleteBy: new Date(now).toISOString() }, now));
  assert.throws(() => assertConsent({ ...consent, deleteBy: new Date(now + 8 * 86400_000).toISOString() }, now));
  assert.throws(() => assertConsent({ ...consent, withdrawn: true } as any, now));
  assert.throws(() => assertConsent({ ...consent, externalProcessingAgreed: false } as any, now));
  assert.equal(CorpusSchema.safeParse({ version: 1, cases: [] }).success, false);
});
test("dialect text fixtures are labeled text-only and clarification never mutates expected cart", () => {
  assert.deepEqual([...new Set(textCases.map((c) => c.group.dialect))].sort(), ["chungcheong", "gyeongsang", "jeolla", "standard"]);
  for (const c of textCases) {
    let before = c.initialCart;
    for (const t of c.turns) {
      if (t.expected.needsClarification) assert.equal(sameCart(before, t.expected.cart), true, c.id);
      before = t.expected.cart;
    }
  }
});
