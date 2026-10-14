import { test } from "node:test";
import assert from "node:assert/strict";
import { applyActions, makeItem } from "../services/cartService";
import { KioskError } from "../services/errors";
import { ParsedOrderSchema, type OrderAction, type ParsedOrder } from "../services/orderTypes";
import { validateSelection } from "../services/menuService";

function action(type: OrderAction["type"], values: Partial<OrderAction> = {}): OrderAction {
  return { type, menuId: null, targetItemId: null, quantity: null, temperature: null, size: null, addOptions: [], removeOptions: [], ...values };
}
function order(...actions: OrderAction[]): ParsedOrder {
  return { needsClarification: false, question: null, message: "처리했습니다.", actions };
}

test("아아 두 잔 → 아이스 아메리카노 2, 7000원", () => {
  const items = applyActions([], order(action("add", { menuId: "americano", quantity: 2, temperature: "ice" })));
  assert.equal(items.length, 1);
  assert.equal(items[0]!.quantity, 2);
  assert.equal(items[0]!.temperature, "ice");
  assert.equal(items[0]!.lineTotal, 7000);
});
test("뜨아 하나 주이소 → 따뜻한 아메리카노 1", () => {
  const items = applyActions([], order(action("add", { menuId: "americano", quantity: 1, temperature: "hot" })));
  assert.equal(items[0]!.temperature, "hot");
});
test("카페라떼 한 잔이랑 아메리카노 두 잔", () => {
  const items = applyActions([], order(action("add", { menuId: "cafe-latte", quantity: 1 }), action("add", { menuId: "americano", quantity: 2 })));
  assert.equal(items.reduce((n, i) => n + i.quantity, 0), 3);
  assert.equal(items.reduce((n, i) => n + i.lineTotal, 0), 11200);
});
test("아메리카노 하나 빼주세요 → 기존 수량 감소", () => {
  const items = applyActions([makeItem("americano", 2, "ice", "M", [])], order(action("remove", { menuId: "americano", quantity: 1 })));
  assert.equal(items[0]!.quantity, 1);
});
test("라떼 두 잔 중 하나는 샷 추가 → 총 2, 샷은 1", () => {
  const items = applyActions([], order(action("add", { menuId: "cafe-latte", quantity: 2 }), action("update", { menuId: "cafe-latte", quantity: 1, addOptions: ["shot"] })));
  assert.equal(items.reduce((n, i) => n + i.quantity, 0), 2);
  assert.equal(items.filter((i) => i.options.some((o) => o.id === "shot"))[0]!.quantity, 1);
  assert.equal(items.reduce((n, i) => n + i.lineTotal, 0), 8900);
});
test("아니 세 잔 말고 두 잔이요 → 최종 수량 2", () => {
  const items = applyActions([makeItem("americano", 3, "ice", "M", [])], order(action("set_quantity", { menuId: "americano", quantity: 2 })));
  assert.equal(items[0]!.quantity, 2);
});
test("문맥 수정: 2잔 → 하나 샷 → 3잔, 샷 한 잔 보존", () => {
  let items = applyActions([], order(action("add", { menuId: "americano", quantity: 2 })));
  items = applyActions(items, order(action("update", { menuId: "americano", quantity: 1, addOptions: ["shot"] })));
  items = applyActions(items, order(action("set_quantity", { menuId: "americano", quantity: 3 })));
  assert.equal(items.reduce((n, i) => n + i.quantity, 0), 3);
  assert.equal(items.find((i) => i.options.length > 0)!.quantity, 1);
});
test("옵션 제거는 해당 음료를 유지", () => {
  const items = applyActions([makeItem("americano", 1, "ice", "M", ["shot"])], order(action("update", { menuId: "americano", removeOptions: ["shot"] })));
  assert.equal(items[0]!.quantity, 1);
  assert.equal(items[0]!.options.length, 0);
});
test("불명확한 대상은 추측하지 않음", () => {
  const items = [makeItem("americano", 1, "ice", "M", []), makeItem("cafe-latte", 1, "ice", "M", [])];
  assert.throws(() => applyActions(items, order(action("update", { quantity: 1, addOptions: ["shot"] }))), KioskError);
  assert.equal(items[0]!.options.length, 0);
});
test("없는 메뉴/수량 미정/옵션 충돌은 반영하지 않음", () => {
  assert.throws(() => applyActions([], order(action("add", { menuId: "unknown", quantity: 1 }))), KioskError);
  assert.throws(() => applyActions([], order(action("add", { menuId: "americano" }))), KioskError);
  assert.throws(() => validateSelection("cafe-latte", "ice", "M", ["oat_milk", "soy_milk"]), KioskError);
  assert.throws(() => validateSelection("americano", "hot", "M", ["less_ice"]), KioskError);
});
test("원자성: 두 번째 작업 실패해도 원래 장바구니는 보존", () => {
  const items = [makeItem("americano", 2, "ice", "M", [])];
  const snapshot = structuredClone(items);
  assert.throws(() => applyActions(items, order(action("remove", { menuId: "americano", quantity: 1 }), action("add", { menuId: "fake", quantity: 1 }))), KioskError);
  assert.deepEqual(items, snapshot);
});
test("잘못된 JSON/추가 필드/잘못된 수량 거부", () => {
  assert.equal(ParsedOrderSchema.safeParse({ actions: [] }).success, false);
  assert.equal(ParsedOrderSchema.safeParse({ ...order(action("add", { quantity: -1 })), unknown: true }).success, false);
});
test("전체 주문 취소 → 빈 장바구니", () => {
  assert.deepEqual(applyActions([makeItem("americano", 1, "ice", "M", [])], order(action("cancel"))), []);
});
