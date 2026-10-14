import type { ParsedOrder } from "./orderTypes";
import type { SessionState } from "./sessionService";

// This is a conservative veto, not a Korean order parser. It never supplies a
// quantity/menu and does not treat "두유", "하나님" or an old applied turn as a count.
const EXPLICIT_COUNT = /(?:\d+\s*(?:잔|개|컵)|(?:한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|열한|열두|스무)\s*(?:잔|개|컵)|(?:하나|둘|셋|넷|다섯|여섯|일곱|여덟|아홉|열)(?:만|는|씩|요|이요|이유)?(?=$|[\s,.!?])|(?:^|\s)\d+(?=$|[\s,.!?]))/;

export function requireQuantityEvidence<T extends ParsedOrder>(parsed: T, text: string, session: SessionState): T {
  if (parsed.needsClarification) return parsed;
  // Do not silently put the option on every cup when the customer said just one.
  if (/(?:하나만|한\s*잔만)\s*샷\s*추가/.test(text) &&
      parsed.actions.some((a) => a.type === "update" && a.addOptions.includes("shot") && a.quantity !== 1)) {
    return { ...parsed, needsClarification: true, actions: [], question: "샷을 한 잔에만 추가할까요?", message: "샷을 추가할 잔수를 확인해주세요." };
  }
  if (!parsed.actions.some((a) => a.type === "add")) return parsed;
  const last = session.history.at(-1);
  const pendingText = session.clarification && last && !last.applied ? last.text : "";
  if (EXPLICIT_COUNT.test(text)) return parsed;
  // A validated, uncommitted draft may span several preference replies. Only
  // reuse its known menu quantities, never an applied cart or a new drink/count.
  const additions = parsed.actions.filter((a) => a.type === "add");
  if (session.pendingOrder?.length && additions.every((a) => {
    const known = session.pendingOrder!.filter((d) => d.type === "add" && d.menuId === a.menuId)
      .reduce((n, d) => n + (d.quantity ?? 0), 0);
    const requested = additions.filter((d) => d.menuId === a.menuId)
      .reduce((n, d) => n + (d.quantity ?? 0), 0);
    return a.quantity !== null && known > 0 && requested === known;
  }) && session.pendingOrder.filter((a) => a.type === "add")
    .every((a) => additions.some((d) => d.menuId === a.menuId))) return parsed;
  if (!session.pendingOrder?.length && EXPLICIT_COUNT.test(pendingText)) return parsed;
  return {
    ...parsed, needsClarification: true, actions: [],
    question: "몇 잔을 주문하시겠어요?",
    message: "수량을 듣지 못했어요. 몇 잔을 주문하시겠어요?",
  };
}
