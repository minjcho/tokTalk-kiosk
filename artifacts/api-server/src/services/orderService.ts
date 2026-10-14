import { applyActions } from "./cartService";
import { orderParser } from "./orderParser";
import { KioskError } from "./errors";
import { debugEvent, ensureCurrent, sessionView, type SessionState } from "./sessionService";
import type { OrderResult } from "./orderTypes";
import { checkPreferences, hasCustomizationEvidence, resolveDraftReply } from "./preferenceService";
import { isMenuCloseRequest, isMenuDisplayRequest } from "./menuCommand";

function rememberResult(session: SessionState, requestId: string, result: OrderResult) {
  if (session.status === "active") session.requests.set(requestId, result);
  // Bounded per-customer idempotency cache, erased on session completion.
  if (session.requests.size > 50) session.requests.delete(session.requests.keys().next().value!);
  return result;
}

/** Called inside the session lock; extraction and cart validation are separate steps. */
export async function processOrder(text: string, session: SessionState, requestId: string): Promise<OrderResult> {
  const uiAction = isMenuDisplayRequest(text) ? "show_menu" :
    isMenuCloseRequest(text) ? "close_menu" : undefined;
  if (uiAction) {
    await ensureCurrent(session);
    // A screen command must not become an answer to the pending drink question,
    // nor overwrite the previous extraction, transcript or conversation history.
    return rememberResult(session, requestId, {
      session: sessionView(session),
      transcript: text,
      message: session.clarification || (uiAction === "show_menu" ? "메뉴를 보여드릴게요." : "메뉴를 닫아드릴게요."),
      needsClarification: Boolean(session.clarification),
      extractedJson: JSON.stringify({ uiAction }),
      uiAction,
    });
  }
  session.lastTranscript = text;
  session.debug.transcript = text;
  const extraction = await orderParser.parse(text, session);
  await ensureCurrent(session);
  let parsed = extraction;
  let needsClarification = extraction.needsClarification;
  let message = extraction.message;
  let updated = session.items;
  try {
    // "No ice" is not the catalog's "less ice". A shape-valid provider
    // substitution must not contaminate the draft and break the next reply.
    if (/얼음\s*(?:없이|없게|없는|빼|제외)|노\s*아이스/.test(text) &&
        extraction.actions.some((a) => a.addOptions.some((id) => id === "less_ice" || id === "extra_ice"))) {
      throw new KioskError("OPTION_UNSUPPORTED", "얼음 없음은 지원하지 않습니다. 얼음 적게 또는 음료 온도를 다시 선택해주세요.");
    }
    const resolved = resolveDraftReply(session.pendingOrder, extraction, session.pendingCustomizationConfirmed);
    const customizationConfirmed = (extraction.customizationConfirmed && hasCustomizationEvidence(text)) ||
      session.pendingCustomizationConfirmed === true;
    const preference = checkPreferences(resolved, extraction.defaultsAccepted, customizationConfirmed);
    parsed = { ...extraction, ...preference.order };
    updated = applyActions(session.items, parsed);
    if (!needsClarification && preference.question) {
      needsClarification = true;
      message = preference.question;
      session.pendingOrder = parsed.actions;
      session.pendingCustomizationConfirmed = customizationConfirmed;
    }
  } catch (error) {
    if (!(error instanceof KioskError)) throw error;
    needsClarification = true;
    message = error.message;
    debugEvent(session, "info", error.code, message);
  }
  const extractedJson = JSON.stringify(parsed, null, 2);
  session.debug.extractedJson = extractedJson;
  if (!needsClarification) {
    session.items = updated;
    session.clarification = null;
    session.pendingOrder = undefined;
    session.pendingCustomizationConfirmed = undefined;
    session.revision++;
    if (parsed.actions.some((a) => a.type === "cancel")) {
      session.status = "cancelled";
      session.items = [];
      session.history = [];
      session.requests.clear();
      session.lastTranscript = null;
      session.debug = { transcript: null, extractedJson: null, events: [] };
      message = "전체 주문을 취소했습니다. 새 주문을 시작해주세요.";
    }
  } else {
    message = (parsed.needsClarification ? parsed.question : null) || message || "메뉴와 수량을 다시 말씀해주세요.";
    session.clarification = message;
  }
  if (session.status === "active") {
    session.history.push({ text, applied: !needsClarification, question: needsClarification ? message : null });
    session.history = session.history.slice(-12);
    debugEvent(session, "info", needsClarification ? "NEEDS_CLARIFICATION" : "ORDER_APPLIED", message);
  }
  const result: OrderResult = { session: sessionView(session), transcript: text, message, needsClarification, extractedJson };
  return rememberResult(session, requestId, result);
}

export const orderService = { process: processOrder };
