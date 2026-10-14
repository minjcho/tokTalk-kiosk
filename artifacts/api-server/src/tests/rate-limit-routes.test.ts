import { after, test } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import { CreateSessionResponse } from "@workspace/api-zod";
import { makeItem } from "../services/cartService";
import { orderService } from "../services/orderService";
import { rateLimiter } from "../services/rateLimitService";
import { createSession, getSession, repository, sessionView, withSessionLock, type SessionState } from "../services/sessionService";
import { transcriptionService } from "../services/transcriptionService";
import type { OrderResult, SessionView } from "../services/orderTypes";
import { counter, peer, removeCounters, worker } from "./helpers/rate-limit-fixtures";
import { kioskRequest, type KioskReply } from "./helpers/kiosk-request";

const sessionIds: string[] = [];
const voice = { audioBase64: Buffer.alloc(1200, 1).toString("base64"), mimeType: "audio/wav" };
const path = (id: string, suffix = "") => `/kiosk/sessions/${id}${suffix}`;
async function fixture() {
  const session = await createSession();
  sessionIds.push(session.id);
  return session;
}
async function fill(client: string, count: number) {
  for (let i = 0; i < count; i++) await rateLimiter.consume(client);
}
function code(reply: KioskReply) {
  return (reply.body as { code: string }).code;
}
after(async () => {
  try {
    for (const id of sessionIds) await repository.delete(id);
    await removeCounters();
  } finally { await pool.end(); }
});

test("세션 생성·텍스트·음성이 같은 한도 사용; 429 뒤 처리 결과 재시도와 화면 주문은 가능", async (t) => {
  const client = peer();
  const processor = t.mock.method(orderService, "process", async (text: string, session: SessionState, requestId: string) => {
    session.items = [makeItem("americano", 1, "ice", "M", [])];
    session.revision++;
    const result: OrderResult = {
      session: sessionView(session), transcript: text, message: "처리했습니다.", needsClarification: false, extractedJson: "{}",
    };
    session.requests.set(requestId, result);
    return result;
  });
  const transcriber = t.mock.method(transcriptionService, "transcribe", async () => "아아 한 잔");
  const created = await kioskRequest(client, "POST", "/kiosk/sessions");
  assert.equal(created.status, 201);
  const session = CreateSessionResponse.parse(created.body);
  sessionIds.push(session.id);
  const textBody = { text: "아아 한 잔", revision: 0, requestId: "text-done" };
  const text = await kioskRequest(client, "POST", path(session.id, "/text"), textBody);
  assert.equal(text.status, 200);
  const voiceBody = { ...voice, revision: 1, requestId: "voice-done" };
  const spoken = await kioskRequest(client, "POST", path(session.id, "/voice"), voiceBody);
  assert.equal(spoken.status, 200);
  assert.equal((await counter(client))!.count, 3);
  await fill(client, 27);

  for (const kind of ["text", "voice"]) {
    const request = { ...textBody, ...voice, revision: 2, requestId: `blocked-${kind}` };
    const rejected = await kioskRequest(client, "POST", path(session.id, `/${kind}`), request);
    assert.equal(rejected.status, 429);
    assert.equal(code(rejected), "TOO_MANY_REQUESTS");
    assert.ok(Number(rejected.headers["retry-after"]) >= 1);
    assert.ok(Number(rejected.headers["retry-after"]) <= 60);
  }
  const blockedCreation = await kioskRequest(client, "POST", "/kiosk/sessions");
  assert.equal(blockedCreation.status, 429);
  assert.equal(processor.mock.callCount(), 2);
  assert.equal(transcriber.mock.callCount(), 1);
  assert.equal((await getSession(session.id)).revision, 2);
  const countBeforeReplays = (await counter(client))!.count;

  // Fresh processes have no local replay/limit state, and stale revisions are intentional.
  const textReplay = await worker<KioskReply>({ peer: client, request: { method: "POST", url: path(session.id, "/text"), body: textBody } });
  const voiceReplay = await worker<KioskReply>({ peer: client, request: { method: "POST", url: path(session.id, "/voice"), body: voiceBody } });
  assert.equal(textReplay.status, 200);
  assert.equal(voiceReplay.status, 200);
  assert.deepEqual(textReplay.body, text.body);
  assert.deepEqual(voiceReplay.body, spoken.body);
  assert.equal((await counter(client))!.count, countBeforeReplays);

  assert.equal((await kioskRequest(client, "GET", "/kiosk/menu")).status, 200);
  assert.equal((await kioskRequest(client, "GET", "/kiosk/status")).status, 200);
  assert.equal((await kioskRequest(client, "GET", path(session.id))).status, 200);
  assert.equal((await kioskRequest(client, "GET", path(session.id, "/debug"))).status, 200);
  assert.equal((await kioskRequest(client, "POST", path(session.id, "/activity"))).status, 200);
  const added = await kioskRequest<SessionView>(client, "POST", path(session.id, "/items"), {
    revision: 2, menuId: "cafe-latte", quantity: 1, temperature: "hot", size: "M", options: [],
  });
  assert.equal(added.status, 200);
  const item = added.body.items.find((value) => value.menuId === "cafe-latte")!;
  const updated = await kioskRequest<SessionView>(client, "PATCH", path(session.id, `/items/${item.id}`), {
    revision: 3, quantity: 2, temperature: "hot", size: "M", options: [],
  });
  assert.equal(updated.status, 200);
  assert.equal((await kioskRequest(client, "DELETE", path(session.id, `/items/${item.id}`), { revision: 4 })).status, 200);
  assert.equal((await counter(client))!.count, countBeforeReplays, "Touch paths must not consume AI quota");
  assert.equal((await kioskRequest(client, "DELETE", path(session.id))).status, 204);
});

test("세션 생성 반복은 새 세션으로 우회 불가, 한도 초과 시 DB 세션도 생성 안 함", async (t) => {
  const client = peer();
  const saves = t.mock.method(repository, "save");
  for (let i = 0; i < 30; i++) {
    const reply = await kioskRequest(client, "POST", "/kiosk/sessions");
    assert.equal(reply.status, 201);
    sessionIds.push(CreateSessionResponse.parse(reply.body).id);
  }
  for (let i = 0; i < 3; i++) {
    const reply = await kioskRequest(client, "POST", "/kiosk/sessions");
    assert.equal(reply.status, 429);
    assert.equal(code(reply), "TOO_MANY_REQUESTS");
    assert.equal("id" in (reply.body as object), false);
  }
  assert.equal(saves.mock.callCount(), 30, "Rejected creations must never save a session");
  assert.equal((await counter(client))!.count, 31);
});

test("잘못된 입력·존재하지 않는 세션·잠금·revision 충돌은 한도 소비 안 함", async () => {
  const client = peer(), session = await fixture();
  const text = { text: "아아 한 잔", revision: 0, requestId: "new" };
  assert.equal((await kioskRequest(client, "POST", path(session.id, "/text"), { ...text, text: " " })).status, 400);
  assert.equal((await kioskRequest(client, "POST", path(session.id, "/voice"), { ...voice, revision: 0, requestId: "new", audioBase64: "!!" })).status, 400);
  assert.equal((await kioskRequest(client, "POST", path("missing", "/text"), text)).status, 410);
  await repository.acquire(session, 0);
  for (const kind of ["text", "voice"]) {
    const reply = await kioskRequest(client, "POST", path(session.id, `/${kind}`), { ...text, ...voice });
    assert.equal(code(reply), "SESSION_BUSY");
  }
  await repository.release(session);
  for (const kind of ["text", "voice"]) {
    const reply = await kioskRequest(client, "POST", path(session.id, `/${kind}`), { ...text, ...voice, revision: 123 });
    assert.equal(code(reply), "REVISION_CONFLICT");
  }
  assert.equal(await counter(client), undefined);
});

test("입장 후 DB 한도 확인 실패 시 세션/AI/STT 모두 503, 캐시된 재시도는 정상 반환", async (t) => {
  const client = peer(), session = await fixture();
  const cached: OrderResult = {
    session: sessionView(session), transcript: "처리된 발화", message: "처리했습니다.", needsClarification: false, extractedJson: "{}",
  };
  await withSessionLock(session, 0, () => { session.requests.set("cached", cached); });
  const processor = t.mock.method(orderService, "process", async () => { throw new Error("Must not reach AI"); });
  const transcriber = t.mock.method(transcriptionService, "transcribe", async () => { throw new Error("Must not reach STT"); });
  const storage = t.mock.method(db, "insert", () => { throw new Error("Simulated limit-store outage"); });
  for (const kind of ["text", "voice"]) {
    const body = { text: "아아 한 잔", ...voice, revision: 0, requestId: "new" };
    const reply = await kioskRequest(client, "POST", path(session.id, `/${kind}`), body);
    assert.equal(reply.status, 503);
    assert.equal(code(reply), "STORAGE_UNAVAILABLE");
    const retry = await kioskRequest(client, "POST", path(session.id, `/${kind}`), { ...body, requestId: "cached" });
    assert.equal(retry.status, 200);
    assert.deepEqual(retry.body, cached);
  }
  assert.equal((await kioskRequest(client, "POST", "/kiosk/sessions")).status, 503);
  storage.mock.restore();
  assert.equal(processor.mock.callCount(), 0);
  assert.equal(transcriber.mock.callCount(), 0);
  assert.equal((await getSession(session.id)).busy, false);
  assert.equal((await getSession(session.id)).revision, 0);
});
