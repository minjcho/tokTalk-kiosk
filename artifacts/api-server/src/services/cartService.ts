import { randomUUID } from "node:crypto";
import { KioskError } from "./errors";
import { findMenu, validateSelection, type Temperature } from "./menuService";
import type { CartItem, OrderAction, ParsedOrder } from "./orderTypes";

export function makeItem(menuId: string, quantity: number, temperature: Temperature, size: string, optionIds: string[], id: string = randomUUID()): CartItem {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
    throw new KioskError("QUANTITY_INVALID", "수량은 1잔부터 20잔까지 선택해주세요.");
  }
  const { product, options, unitPrice } = validateSelection(menuId, temperature, size, optionIds);
  return { id, menuId, name: product.name, quantity, temperature, size, options, unitPrice, lineTotal: unitPrice * quantity };
}

function signature(item: CartItem) {
  return JSON.stringify([item.menuId, item.temperature, item.size, item.options.map((o) => o.id).sort()]);
}

export function normalizeCart(items: CartItem[]): CartItem[] {
  const merged: CartItem[] = [];
  for (const item of items) {
    if (item.quantity <= 0) continue;
    const found = merged.find((other) => signature(other) === signature(item));
    if (found) {
      found.quantity += item.quantity;
      if (found.quantity > 20) throw new KioskError("QUANTITY_LIMIT", "같은 음료는 한 번에 20잔까지 주문할 수 있습니다.");
      found.lineTotal = found.quantity * found.unitPrice;
    } else {
      merged.push({ ...item, options: [...item.options], lineTotal: item.unitPrice * item.quantity });
    }
  }
  if (merged.reduce((sum, i) => sum + i.quantity, 0) > 50) throw new KioskError("CART_LIMIT", "한 주문은 총 50잔까지 가능합니다.");
  return merged;
}

function candidates(items: CartItem[], action: OrderAction) {
  if (action.targetItemId) {
    const found = items.find((i) => i.id === action.targetItemId);
    if (!found || (action.menuId && found.menuId !== action.menuId)) {
      throw new KioskError("TARGET_UNKNOWN", "수정하려는 음료를 찾지 못했습니다. 장바구니에서 선택해주세요.");
    }
    return [found];
  }
  const selected = action.menuId ? items.filter((i) => i.menuId === action.menuId) : items;
  if (!selected.length) throw new KioskError("TARGET_UNKNOWN", "장바구니에 해당 음료가 없습니다. 어떤 음료인지 다시 말씀해주세요.");
  if (!action.menuId && new Set(selected.map((i) => i.menuId)).size > 1) {
    throw new KioskError("TARGET_AMBIGUOUS", "어떤 음료를 수정할까요? 메뉴 이름을 함께 말씀해주세요.");
  }
  return selected;
}

function setGroupQuantity(items: CartItem[], selected: CartItem[], quantity: number) {
  const current = selected.reduce((sum, i) => sum + i.quantity, 0);
  if (current === quantity) return;
  if (selected.length === 1) {
    selected[0]!.quantity = quantity;
    return;
  }
  // Keep explicitly requested options on existing cups. Grow the plain variant only.
  if (quantity > current) {
    const plain = selected.filter((i) => i.options.length === 0);
    if (plain.length !== 1) throw new KioskError("TARGET_AMBIGUOUS", "옵션이 다른 음료가 있습니다. 어떤 음료의 수량을 늘릴까요?");
    plain[0]!.quantity += quantity - current;
  } else {
    const plain = selected.filter((i) => i.options.length === 0);
    const reduction = current - quantity;
    if (plain.length !== 1 || plain[0]!.quantity < reduction) {
      throw new KioskError("TARGET_AMBIGUOUS", "옵션이 다른 음료 중 어떤 음료를 줄일까요? 화면에서 선택해주세요.");
    }
    plain[0]!.quantity -= reduction;
  }
  void items;
}

/** Apply to a copy; never partially commit invalid or ambiguous AI actions. */
export function applyActions(current: CartItem[], parsed: ParsedOrder): CartItem[] {
  if (parsed.needsClarification) throw new KioskError("CLARIFICATION", parsed.question || "주문 내용을 조금 더 자세히 말씀해주세요.");
  if (!parsed.actions.length) throw new KioskError("NO_ORDER", "주문할 메뉴와 수량을 말씀해주세요. 예: 아아 두 잔 주세요.");
  let items = structuredClone(current);
  if (parsed.actions.some((a) => a.type === "cancel")) {
    if (parsed.actions.length !== 1) throw new KioskError("CLARIFICATION", "전체 취소와 새 주문 중 어떤 작업을 원하시나요?");
    return [];
  }
  for (const action of parsed.actions) {
    if (action.type === "add") {
      if (!action.menuId) throw new KioskError("MENU_UNKNOWN", "어떤 메뉴를 주문하시겠어요?");
      if (action.quantity === null) throw new KioskError("QUANTITY_AMBIGUOUS", "몇 잔을 주문하시겠어요?");
      if (action.removeOptions.length) throw new KioskError("OPTION_INVALID", "새 음료에 제거할 옵션이 없습니다.");
      const product = findMenu(action.menuId);
      items.push(makeItem(action.menuId, action.quantity, action.temperature ?? product.defaultTemperature, action.size ?? "M", action.addOptions));
      items = normalizeCart(items);
      continue;
    }
    const selected = candidates(items, action);
    if (action.quantity === null && action.type !== "update") {
      throw new KioskError("QUANTITY_AMBIGUOUS", "몇 잔을 변경하거나 빼시겠어요?");
    }
    if (action.type === "set_quantity") {
      setGroupQuantity(items, selected, action.quantity!);
    } else if (action.type === "remove") {
      if (selected.length > 1) throw new KioskError("TARGET_AMBIGUOUS", "옵션이 다른 음료가 있습니다. 어떤 음료를 빼드릴까요?");
      const item = selected[0]!;
      if (action.quantity! > item.quantity) throw new KioskError("QUANTITY_INVALID", `장바구니에는 ${item.name} ${item.quantity}잔이 있습니다.`);
      item.quantity -= action.quantity!;
    } else if (action.type === "update") {
      if (selected.length > 1) {
        // A request to add/remove an option can uniquely identify an eligible variant.
        const eligible = selected.filter((i) =>
          action.removeOptions.every((id) => i.options.some((o) => o.id === id)) &&
          action.addOptions.every((id) => !i.options.some((o) => o.id === id)));
        if (eligible.length !== 1) throw new KioskError("TARGET_AMBIGUOUS", "어떤 음료의 옵션을 바꿀까요? 장바구니에서 선택해주세요.");
        selected.splice(0, selected.length, eligible[0]!);
      }
      const item = selected[0]!;
      const affected = action.quantity ?? item.quantity;
      if (affected > item.quantity) throw new KioskError("QUANTITY_INVALID", "변경할 수량이 장바구니 수량보다 많습니다.");
      if (action.removeOptions.some((id) => !item.options.some((o) => o.id === id))) {
        throw new KioskError("OPTION_INVALID", "해당 음료에는 제거할 옵션이 없습니다.");
      }
      const options = [...new Set([...item.options.map((o) => o.id).filter((id) => !action.removeOptions.includes(id)), ...action.addOptions])];
      const changed = makeItem(item.menuId, affected, action.temperature ?? item.temperature, action.size ?? item.size, options, affected === item.quantity ? item.id : randomUUID());
      if (affected === item.quantity) items[items.indexOf(item)] = changed;
      else {
        item.quantity -= affected;
        items.push(changed);
      }
    }
    items = normalizeCart(items);
  }
  return normalizeCart(items);
}
