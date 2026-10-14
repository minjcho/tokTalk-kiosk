import { findMenu } from "./menuService";
import type { ParsedOrder } from "./orderTypes";
import type { OrderAction } from "./orderTypes";
import { editDraft, separateDraft } from "./draftActions";
import { KioskError } from "./errors";

/** Metadata alone must not turn a temperature/size answer into option consent. */
export function hasCustomizationEvidence(text: string) {
  return /샷|디카페인|오트|두유|우유|얼음|덜\s*달|당도|추가\s*없|변경\s*없|옵션\s*없|없어|없습니다|그대로|아니요/.test(text);
}

/** A short reply may be extracted as an update. Apply it to the draft, never the real cart. */
export function resolveDraftReply(
  pending: OrderAction[] | undefined,
  parsed: ParsedOrder & { defaultsAccepted?: boolean; customizationConfirmed?: boolean },
  preserveOptions = false,
): ParsedOrder {
  if (parsed.needsClarification || parsed.actions.some((a) => a.type === "cancel")) return parsed;
  if (!parsed.actions.length) {
    return pending?.length && (parsed.defaultsAccepted || parsed.customizationConfirmed)
      ? { ...parsed, actions: structuredClone(pending) } : parsed;
  }
  if (!pending?.length) {
    const draft = separateDraft(parsed.actions);
    return { ...parsed, actions: [...draft.cartActions, ...draft.additions] };
  }
  const draft = separateDraft(pending);
  if (parsed.actions.some((a) => a.type === "add")) {
    // The parser can return a complete draft snapshot. Retain deferred real-cart
    // edits even if it omits them while reconstructing a short preference reply.
    const snapshot = separateDraft(parsed.actions);
    if (preserveOptions) {
      const optionCounts = (actions: OrderAction[]) => {
        const counts: Record<string, number> = {};
        for (const a of actions) {
          const key = JSON.stringify([a.menuId, [...a.addOptions].sort()]);
          counts[key] = (counts[key] ?? 0) + a.quantity!;
        }
        return Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
      };
      if (JSON.stringify(optionCounts(draft.additions)) !== JSON.stringify(optionCounts(snapshot.additions))) {
        throw new KioskError("DRAFT_OPTIONS_CHANGED", "잔별 옵션을 그대로 보존했습니다. 온도나 크기만 다시 말씀해주세요. 옵션 변경은 메뉴와 잔수를 함께 말씀해주세요.");
      }
    }
    for (const original of draft.additions) {
      const matches = snapshot.additions.filter((a) => a.menuId === original.menuId);
      if (!matches.length) throw new KioskError("DRAFT_INCOMPLETE", "대기 중인 음료가 빠졌습니다. 음료별 설정을 다시 말씀해주세요.");
      const originals = draft.additions.filter((a) => a.menuId === original.menuId);
      if (matches.length === 1 && originals.length === 1) {
        matches[0]!.temperature ??= original.temperature;
        matches[0]!.size ??= original.size;
      }
    }
    for (const action of draft.cartActions) {
      if (!snapshot.cartActions.some((a) => JSON.stringify(a) === JSON.stringify(action))) snapshot.cartActions.push(action);
    }
    return { ...parsed, actions: [...snapshot.cartActions, ...snapshot.additions] };
  }
  for (const action of parsed.actions) {
    if (action.targetItemId || (action.menuId && !draft.additions.some((a) => a.menuId === action.menuId))) {
      if (!draft.cartActions.some((a) => JSON.stringify(a) === JSON.stringify(action))) draft.cartActions.push(action);
    } else {
      let change = action;
      // An unqualified answer to a temperature/size question belongs to the
      // first missing preference, not every menu in the draft.
      if (!action.menuId && action.type === "update" && !action.addOptions.length && !action.removeOptions.length) {
        const next = draft.additions.find((a) => !a.temperature || !a.size);
        if (next) change = { ...action, menuId: next.menuId };
      }
      editDraft(draft.additions, change);
    }
  }
  return { ...parsed, actions: [...draft.cartActions, ...draft.additions] };
}

/** New voice/text additions are drafts until the customer chooses their preferences. */
export function checkPreferences(
  parsed: ParsedOrder,
  defaultsAccepted: boolean,
  customizationConfirmed: boolean,
): { order: ParsedOrder; question: string | null } {
  const order = structuredClone(parsed);
  if (order.needsClarification) return { order, question: null };
  const additions = order.actions.filter((a) => a.type === "add" && a.menuId);
  for (const action of additions) {
    const product = findMenu(action.menuId!);
    if (defaultsAccepted || product.availableTemperatures.length === 1) {
      action.temperature ??= product.defaultTemperature;
    }
    if (defaultsAccepted || product.availableSizes.length === 1) {
      action.size ??= product.availableSizes[0]!.id as "M" | "L";
    }
    if (!action.temperature) {
      return { order, question: `${product.name}는 어떤 온도로 드릴까요? 아이스와 따뜻하게 중 골라주세요.` };
    }
    if (!action.size) {
      const sizes = product.availableSizes.map((s) => `${s.name}${s.price ? ` (+${s.price.toLocaleString("ko-KR")}원)` : ""}`).join(", ");
      return { order, question: `${product.name}는 어떤 크기로 드릴까요? ${sizes} 중 골라주세요.` };
    }
  }
  if (additions.length && !defaultsAccepted && !customizationConfirmed) {
    const choices = [...new Set(additions.flatMap((action) =>
      findMenu(action.menuId!).availableOptions
        .filter((o) => action.temperature !== "hot" || !["less_ice", "extra_ice"].includes(o.id))
        .map((o) => `${o.name}${o.price ? ` (+${o.price.toLocaleString("ko-KR")}원)` : ""}`),
    ))];
    if (choices.length) {
      return { order, question: `추가하거나 변경할 사항이 있으세요? ${choices.join(", ")} 등을 메뉴별로 선택할 수 있어요. 원치 않으시면 “추가 없이”라고 말씀해주세요.` };
    }
  }
  return { order, question: null };
}
