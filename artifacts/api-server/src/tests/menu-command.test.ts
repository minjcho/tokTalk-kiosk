import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { makeItem } from "../services/cartService";
import { isMenuCloseRequest, isMenuDisplayRequest } from "../services/menuCommand";
import { SubmitTextOrderResponse, SubmitVoiceOrderResponse } from "@workspace/api-zod";
import { orderParser } from "../services/orderParser";
import { ConversationOrderSchema, type OrderResult } from "../services/orderTypes";
import { createSession, getSession, repository, withSessionLock, type SessionState } from "../services/sessionService";
import { transcriptionService } from "../services/transcriptionService";
import { kioskRequest } from "./helpers/kiosk-request";
import { counter, peer, removeCounters } from "./helpers/rate-limit-fixtures";

const ids: string[] = [];
const path = (id: string, kind: string) => `/kiosk/sessions/${id}/${kind}`;
after(async () => {
  try {
    for (const id of ids) await repository.delete(id);
    await removeCounters();
  } finally { await pool.end(); }
});

test("명확한 메뉴 표시 요청만 인식하고 부정형·혼합 주문·인용은 제외", () => {
  for (const text of [
    "메뉴 보여줘", "메뉴판 보여주세요", "메뉴를 좀 보여 주세요!",
    "혹시 메뉴판을 보여주실 수 있나요?", "메뉴 보고 싶어요",
    "메뉴 볼 수 있을까요?", "메뉴판 띄워주세요", "메뉴 좀 볼게요",
  ]) assert.equal(isMenuDisplayRequest(text), true, text);
  for (const text of [
    "메뉴 보여주지 마", "메뉴 안 보여줘도 돼요", "메뉴 보여줄 필요 없어요",
    "메뉴 보여줘 그리고 아아 한 잔", "아아 하나랑 메뉴 보여주세요",
    "메뉴 보여줘. 주문 취소", "메뉴 보여줘 말고 라떼 두 잔",
    "메뉴 추천해주세요", "메뉴가 뭐예요", "메뉴", "보여줘",
    "메뉴 보여줘라고 했어요", "누가 메뉴 보여달라고 했어", "",
  ]) assert.equal(isMenuDisplayRequest(text), false, text);
});

test("명시적인 메뉴 닫기만 인식하고 부정형·인용·주문 혼합·확정·취소는 제외", () => {
  for (const text of [
    "메뉴 닫아줘", "메뉴판 닫아주세요", "메뉴를 좀 닫아 주세요!",
    "혹시 메뉴판을 닫아주실 수 있나요?", "저기요 메뉴 접어주세요.",
    "메뉴 숨겨줘", "메뉴판 한 번 접어 주실래요?", "메뉴 닫아주십시오",
    "메뉴 닫아주시겠어요", "메뉴 닫아줄래요", "메뉴 닫아주실 수 있을까요", "메뉴 닫아줘요?",
    "  메뉴　닫아줘！ ",
  ]) {
    assert.equal(isMenuCloseRequest(text), true, text);
    assert.equal(isMenuDisplayRequest(text), false, text);
  }
  for (const text of [
    "메뉴 닫지 마", "메뉴 닫아주지 마세요", "메뉴 안 닫아줘도 돼요",
    "메뉴 닫을 필요 없어요", "메뉴 닫아줘 아니 닫지 마", "메뉴 숨기지 마",
    "메뉴 접어주지 마", "메뉴 닫아줘 그리고 아아 한 잔",
    "아아 하나랑 메뉴 닫아주세요", "메뉴 닫아줘. 라떼 아이스로 바꿔줘",
    "메뉴 닫아줘 말고 라떼 두 잔", "메뉴 닫아줘. 주문 취소",
    "메뉴 닫아줘 주문 확정", "메뉴 닫아줘라고 했어요",
    "누가 메뉴 닫아달라고 했어", "'메뉴 닫아줘'", "“메뉴 닫아줘”",
    "메뉴 닫아줄까요", "주문 취소", "주문 확정",
    "메뉴", "닫아줘", "주문 화면으로 돌아가줘", "",
  ]) assert.equal(isMenuCloseRequest(text), false, text);
});

function conversationState(s: SessionState) {
  return structuredClone({
    revision: s.revision, status: s.status, items: s.items,
    clarification: s.clarification, pendingOrder: s.pendingOrder,
    pendingCustomizationConfirmed: s.pendingCustomizationConfirmed, history: s.history,
    lastTranscript: s.lastTranscript, debug: s.debug,
  });
}

test("텍스트·실제 voice 라우트의 열기·닫기는 잔별 옵션·초안·질문을 유지하고 재요청은 한도 면제", async (t) => {
  const client = peer();
  const session = await createSession();
  ids.push(session.id);
  await withSessionLock(session, 0, () => {
    session.items = [
      makeItem("cafe-latte", 1, "ice", "M", ["shot"]),
      makeItem("cafe-latte", 1, "hot", "L", []),
    ];
    session.pendingOrder = [{
      type: "add", menuId: "americano", quantity: 2, targetItemId: null,
      temperature: null, size: null, addOptions: [], removeOptions: [],
    }];
    session.pendingCustomizationConfirmed = true;
    session.clarification = "아메리카노 두 잔은 아이스로 드릴까요, 따뜻하게 드릴까요?";
    session.history = [{ text: "아메리카노 두 잔", applied: false, question: session.clarification }];
    session.lastTranscript = "아메리카노 두 잔";
    session.debug.transcript = session.lastTranscript;
    session.debug.extractedJson = JSON.stringify(session.pendingOrder);
  });
  const before = conversationState(await getSession(session.id));
  const parser = t.mock.method(orderParser, "parse", async () => { throw new Error("Menu requests must not reach order AI"); });
  let command = "";
  const stt = t.mock.method(transcriptionService, "transcribe", async () => command);
  for (const kind of ["text", "voice"]) {
    for (const [text, action] of [["메뉴 보여줘", "show_menu"], ["메뉴 닫아줘", "close_menu"]] as const) {
      command = text;
      const request = {
        text, revision: 0, requestId: randomUUID(),
        audioBase64: Buffer.alloc(1200, 1).toString("base64"), mimeType: "audio/wav",
      };
      const first = await kioskRequest<OrderResult>(client, "POST", path(session.id, kind), request);
      assert.equal(first.status, 200);
      assert.equal(first.body.uiAction, action);
      assert.equal(first.body.needsClarification, true);
      assert.equal(first.body.message, before.clarification);
      assert.deepEqual(conversationState(await getSession(session.id)), before);
      const countBefore = (await counter(client))!.count;
      const replay = await kioskRequest<OrderResult>(client, "POST", path(session.id, kind), { ...request, revision: 999 });
      assert.equal(replay.status, 200);
      assert.deepEqual(replay.body, first.body);
      assert.equal((await counter(client))!.count, countBefore);
      const stale = await kioskRequest(client, "POST", path(session.id, kind), { ...request, revision: 999, requestId: randomUUID() });
      assert.equal(stale.status, 409);
      assert.equal((await counter(client))!.count, countBefore);
    }
  }
  assert.equal(parser.mock.callCount(), 0);
  assert.equal(stt.mock.callCount(), 2);
  assert.equal((await counter(client))!.count, 4);
  await repository.acquire(session, 0);
  try {
    const busy = await kioskRequest(client, "POST", path(session.id, "text"), { text: "메뉴 닫아줘", revision: 0, requestId: randomUUID() });
    assert.equal(busy.status, 409);
    assert.equal((await counter(client))!.count, 4);
  } finally { await repository.release(session); }
});

test("일반 주문과 메뉴·주문 혼합 발화는 기존 주문 분석을 거치며 메뉴 신호로 삼키지 않음", async (t) => {
  const client = peer(), session = await createSession();
  ids.push(session.id);
  const parser = t.mock.method(orderParser, "parse", async () => ConversationOrderSchema.parse({
    needsClarification: true, question: "주문하실 음료를 확인해주세요.", message: "주문 확인",
    actions: [], defaultsAccepted: false, customizationConfirmed: false,
  }));
  const texts = [
    "아아 두 잔", "메뉴 보여줘 그리고 라떼 한 잔", "메뉴 보여주지 마",
    "메뉴 닫아줘 그리고 라떼 한 잔", "메뉴 닫지 마", "'메뉴 닫아줘'",
  ];
  for (const text of texts) {
    const response = await kioskRequest<OrderResult>(client, "POST", path(session.id, "text"), {
      text, revision: 0, requestId: randomUUID(),
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.uiAction, undefined);
    assert.equal(response.body.needsClarification, true);
  }
  assert.equal(parser.mock.callCount(), texts.length);
});

test("빈 주문의 닫기 및 선택적 uiAction 응답 계약은 하위 호환", async (t) => {
  const session = await createSession(), client = peer();
  ids.push(session.id);
  const before = conversationState(session);
  const parser = t.mock.method(orderParser, "parse", async () => { throw new Error("No order AI"); });
  const response = await kioskRequest<OrderResult>(client, "POST", path(session.id, "text"), {
    text: "메뉴 닫아줘", revision: 0, requestId: randomUUID(),
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.message, "메뉴를 닫아드릴게요.");
  assert.equal(response.body.needsClarification, false);
  assert.deepEqual(conversationState(await getSession(session.id)), before);
  const { uiAction, ...legacy } = response.body;
  assert.equal(uiAction, "close_menu");
  for (const schema of [SubmitTextOrderResponse, SubmitVoiceOrderResponse]) {
    assert.equal(schema.safeParse(legacy).success, true);
    assert.equal(schema.safeParse({ ...legacy, uiAction: "show_menu" }).success, true);
    assert.equal(schema.safeParse({ ...legacy, uiAction: "close_menu" }).success, true);
    assert.equal(schema.safeParse({ ...legacy, uiAction: "cancel_order" }).success, false);
  }
  assert.equal(parser.mock.callCount(), 0);
});

test("주문 변경 후 예전 닫기 요청을 재생해도 최신 장바구니를 덮어쓰지 않음", async (t) => {
  const session = await createSession(), client = peer();
  ids.push(session.id);
  const parser = t.mock.method(orderParser, "parse", async () => { throw new Error("No order AI"); });
  const stt = t.mock.method(transcriptionService, "transcribe", async () => "메뉴 닫아줘");
  for (const kind of ["text", "voice"]) {
    const current = await getSession(session.id);
    const request = {
      text: "메뉴 닫아줘", revision: current.revision, requestId: randomUUID(),
      audioBase64: Buffer.alloc(1200, 1).toString("base64"), mimeType: "audio/wav",
    };
    const first = await kioskRequest<OrderResult>(client, "POST", path(session.id, kind), request);
    assert.equal(first.status, 200);
    const changed = await kioskRequest(client, "POST", path(session.id, "items"), {
      menuId: "cafe-latte", quantity: 1, temperature: "ice", size: "M",
      options: ["shot"], revision: current.revision,
    });
    assert.equal(changed.status, 200);
    const latest = conversationState(await getSession(session.id));
    const countBefore = (await counter(client))!.count;
    const replay = await kioskRequest<OrderResult>(client, "POST", path(session.id, kind), request);
    assert.equal(replay.status, 200);
    assert.deepEqual(replay.body, first.body);
    assert.ok(replay.body.session.revision < latest.revision);
    assert.deepEqual(conversationState(await getSession(session.id)), latest);
    assert.equal((await counter(client))!.count, countBefore);
    const stale = await kioskRequest(client, "POST", path(session.id, kind), { ...request, requestId: randomUUID() });
    assert.equal(stale.status, 409);
    assert.deepEqual(conversationState(await getSession(session.id)), latest);
  }
  assert.equal(parser.mock.callCount(), 0);
  assert.equal(stt.mock.callCount(), 1);
});
