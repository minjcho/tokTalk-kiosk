import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPreferences, resolveDraftReply } from "../services/preferenceService";
import { applyActions } from "../services/cartService";
import type { OrderAction, ParsedOrder } from "../services/orderTypes";
import { conversationOrderSchemaFor } from "../services/orderTypes";

function draft(values: Partial<OrderAction> = {}): ParsedOrder {
  return {
    needsClarification: false, question: null, message: "확인",
    actions: [{ type: "add", menuId: "cafe-latte", quantity: 1, targetItemId: null,
      temperature: null, size: null, addOptions: [], removeOptions: [], ...values }],
  };
}
test("missing temperature, then size, then customization are checked in order", () => {
  assert.match(checkPreferences(draft(), false, false).question!, /어떤 온도로/);
  assert.match(checkPreferences(draft({ temperature: "hot" }), false, false).question!, /어떤 크기로/);
  assert.match(checkPreferences(draft({ temperature: "hot", size: "L" }), false, false).question!, /추가하거나 변경/);
  assert.equal(checkPreferences(draft({ temperature: "hot", size: "L" }), false, true).question, null);
});
test("explicit defaults fill only missing choices and keep customization", () => {
  const r = checkPreferences(draft({ size: "L", addOptions: ["shot"] }), true, false);
  assert.equal(r.question, null);
  const [item] = applyActions([], r.order);
  assert.equal(item!.temperature, "ice");
  assert.equal(item!.size, "L");
  assert.equal(item!.unitPrice, 5400);
});
test("cappuccino defaults remain hot only after customer authorizes defaults", () => {
  const d = draft({ menuId: "cappuccino" });
  assert.match(checkPreferences(d, false, false).question!, /온도로/);
  const r = checkPreferences(d, true, false);
  assert.equal(r.order.actions[0]!.temperature, "hot");
});
test("hot drinks do not offer ice options, non-coffee does not offer shots", () => {
  const hot = checkPreferences(draft({ temperature: "hot", size: "M" }), false, false);
  assert.doesNotMatch(hot.question!, /얼음/);
  const cocoa = checkPreferences(draft({ menuId: "choco-latte", temperature: "ice", size: "M" }), false, false);
  assert.doesNotMatch(cocoa.question!, /샷 추가|디카페인/);
});
test("existing-item edits are not asked new-drink preferences", () => {
  const d = draft({ type: "set_quantity", quantity: 2 });
  assert.equal(checkPreferences(d, false, false).question, null);
});
test("clarification and originals stay unchanged; multi-drink defaults keep every item", () => {
  const d = draft(); d.actions.push({ ...d.actions[0]!, menuId: "americano", quantity: 2 });
  const r = checkPreferences(d, true, false);
  assert.equal(d.actions[0]!.temperature, null);
  assert.equal(applyActions([], r.order).reduce((n, i) => n + i.quantity, 0), 3);
  const ambiguous = { ...d, needsClarification: true, question: "어떤 메뉴인가요?" };
  assert.equal(checkPreferences(ambiguous, false, false).question, null);
});

test("short customization update completes the draft rather than editing an empty/previous cart", () => {
  const pending = draft({ temperature: "hot", size: "L" }).actions;
  const reply = draft({ type: "update", quantity: null, addOptions: ["oat_milk"] });
  const resolved = resolveDraftReply(pending, reply);
  const completed = checkPreferences(resolved, false, true);
  assert.equal(completed.question, null);
  const [item] = applyActions([], completed.order);
  assert.equal(item!.quantity, 1);
  assert.equal(item!.temperature, "hot");
  assert.equal(item!.size, "L");
  assert.equal(item!.unitPrice, 5400);
  assert.deepEqual(pending[0]!.addOptions, []);
});
test("short temperature reply preserves missing size instead of filling it implicitly", () => {
  const reply = draft({ type: "update", quantity: null, temperature: "hot" });
  const resolved = resolveDraftReply(draft().actions, reply);
  assert.equal(resolved.actions[0]!.size, null);
  assert.match(checkPreferences(resolved, false, false).question!, /어떤 크기로/);
});

test("a one-cup customization keeps the other cup's missing preferences distinct", () => {
  const pending = draft({ quantity: 2 }).actions;
  const customized = resolveDraftReply(pending, draft({ type: "update", quantity: 1, addOptions: ["shot"] }));
  assert.equal(customized.actions.length, 2);
  assert.ok(customized.actions.every((a) => a.temperature === null && a.size === null));
  const plainHot = resolveDraftReply(customized.actions, draft({
    type: "update", quantity: null, temperature: "hot", removeOptions: ["shot"],
  }));
  const hot = plainHot.actions.find((a) => a.temperature === "hot")!;
  assert.equal(hot.size, null);
  assert.equal(hot.quantity, 1);
  assert.equal(plainHot.actions.find((a) => a.temperature === null)!.size, null);
  assert.deepEqual(pending, draft({ quantity: 2 }).actions);
});

test("draft ambiguity and invalid options leave the input draft unchanged", () => {
  const pending = draft().actions;
  pending.push({ ...pending[0]!, menuId: "americano" });
  const original = structuredClone(pending);
  assert.throws(() => resolveDraftReply(pending, draft({
    type: "update", menuId: null, quantity: 1, addOptions: ["shot"],
  })), /어떤 음료/);
  assert.deepEqual(pending, original);
});

test("AI targets are constrained to actual cart IDs, not fabricated draft placeholders", () => {
  const values = { ...draft({ type: "update" }), defaultsAccepted: false, customizationConfirmed: false };
  for (const ids of [[], ["real-cart-row"]]) {
    const schema = conversationOrderSchemaFor(ids);
    assert.equal(schema.safeParse(values).success, true);
    for (const targetItemId of ["/", "", "invented-row"]) {
      assert.equal(schema.safeParse({ ...values, actions: [{ ...values.actions[0]!, targetItemId }] }).success, false);
    }
  }
  assert.equal(conversationOrderSchemaFor(["real-cart-row"]).safeParse({
    ...values, actions: [{ ...values.actions[0]!, targetItemId: "real-cart-row" }],
  }).success, true);
});
