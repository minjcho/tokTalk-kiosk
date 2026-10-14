import { applyActions } from "./cartService";
import { KioskError } from "./errors";
import type { OrderAction, ParsedOrder } from "./orderTypes";

const ambiguous = () => new KioskError("TARGET_AMBIGUOUS", "어떤 음료를 변경할까요? 메뉴와 변경할 잔을 말씀해주세요.");
const order = (actions: OrderAction[]): ParsedOrder => ({
  actions, needsClarification: false, question: null, message: "",
});

/** Keep null preferences distinct from café defaults, including split cups. */
export function editDraft(additions: OrderAction[], action: OrderAction) {
  let selected = additions.filter((a) => !action.menuId || a.menuId === action.menuId);
  if (!selected.length || new Set(selected.map((a) => a.menuId)).size > 1) throw ambiguous();
  if (action.type === "set_quantity") {
    if (action.quantity === null) throw ambiguous();
    const total = selected.reduce((n, a) => n + a.quantity!, 0);
    if (action.quantity === total) return;
    const plain = selected.filter((a) => !a.addOptions.length);
    const target = selected.length === 1 ? selected[0]! : plain.length === 1 ? plain[0]! : null;
    if (!target || target.quantity! + action.quantity - total < 0) throw ambiguous();
    target.quantity = target.quantity! + action.quantity - total;
  } else if (action.type === "remove") {
    if (selected.length !== 1 || action.quantity === null || action.quantity > selected[0]!.quantity!) throw ambiguous();
    selected[0]!.quantity! -= action.quantity;
  } else if (action.type === "update") {
    const allPreferences = selected.length > 1 && !action.addOptions.length && !action.removeOptions.length &&
      (action.quantity === null || action.quantity === selected.reduce((n, a) => n + a.quantity!, 0));
    if (allPreferences) {
      for (const original of selected) {
        const changed = { ...original, temperature: action.temperature ?? original.temperature, size: action.size ?? original.size };
        applyActions([], order([changed]));
        additions.splice(additions.indexOf(original), 1, changed);
      }
      return;
    }
    if (selected.length > 1) {
      selected = selected.filter((a) =>
        action.removeOptions.every((id) => a.addOptions.includes(id)) &&
        action.addOptions.every((id) => !a.addOptions.includes(id)));
    }
    if (selected.length !== 1) throw ambiguous();
    const original = selected[0]!;
    const quantity = action.quantity ?? original.quantity!;
    if (quantity > original.quantity! || action.removeOptions.some((id) => !original.addOptions.includes(id))) throw ambiguous();
    const changed: OrderAction = {
      ...original, quantity,
      temperature: action.temperature ?? original.temperature,
      size: action.size ?? original.size,
      addOptions: [...new Set([...original.addOptions.filter((id) => !action.removeOptions.includes(id)), ...action.addOptions])],
    };
    // Reuse catalog/price/option validation without storing its implicit defaults.
    applyActions([], order([changed]));
    if (quantity === original.quantity) additions.splice(additions.indexOf(original), 1, changed);
    else {
      original.quantity! -= quantity;
      additions.push(changed);
    }
  } else throw ambiguous();
  for (let i = additions.length - 1; i >= 0; i--) {
    if (!additions[i]!.quantity) additions.splice(i, 1);
  }
}

/** Separate real-cart edits from new cups so short replies cannot replay/drop edits. */
export function separateDraft(actions: OrderAction[]) {
  const additions: OrderAction[] = [];
  const cartActions: OrderAction[] = [];
  for (const action of structuredClone(actions)) {
    if (action.type === "add") additions.push({ ...action, targetItemId: null });
    else if (!action.targetItemId && additions.some((a) => !action.menuId || a.menuId === action.menuId)) {
      editDraft(additions, action);
    } else cartActions.push(action);
  }
  return { additions, cartActions };
}
