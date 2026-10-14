import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, pool, kioskSessionsTable as sessions, kioskOrdersTable as orders } from "@workspace/db";
import { makeItem } from "../services/cartService";
import { KioskError } from "../services/errors";
import { PostgresSessionRepository } from "../services/postgresSessionRepository";
import {
  createSession, repository, getSession, sessionView, confirmSession, withSessionLock,
  ensureCurrent, changed, type SessionState,
} from "../services/sessionService";

// Integration tests use only this run's UUIDs; never clear unrelated kiosk data.
const ids: string[] = [];
const key = (id: string) => createHash("sha256").update(id).digest("hex");
const hasCode = (code: string) => (error: unknown) => error instanceof KioskError && error.code === code;
async function fixture() {
  const state = await createSession();
  ids.push(state.id);
  return state;
}
async function add(state: SessionState) {
  await withSessionLock(state, state.revision, () => {
    state.items = [makeItem("cafe-latte", 2, "ice", "L", ["shot"])];
    changed(state);
  });
}
async function confirm(state: SessionState) {
  return withSessionLock(state, state.revision, () => confirmSession(state));
}
after(async () => {
  try {
    for (const id of ids) {
      await db.delete(sessions).where(eq(sessions.id, id));
      await db.delete(orders).where(eq(orders.confirmationKey, key(id)));
    }
  } finally { await pool.end(); }
});

test("확인 중인 음료 초안은 공유 저장소에서 유지되고 미응답 확정은 차단", async () => {
  const state = await fixture();
  await add(state);
  await withSessionLock(state, state.revision, () => {
    state.pendingOrder = [{ type: "add", menuId: "americano", quantity: 1, targetItemId: null,
      temperature: "hot", size: null, addOptions: [], removeOptions: [] }];
    state.clarification = "어떤 크기로 드릴까요?";
  });
  const restored = await new PostgresSessionRepository().find(state.id);
  assert.equal(restored!.pendingOrder![0]!.temperature, "hot");
  assert.equal(restored!.items[0]!.quantity, 2);
  await assert.rejects(confirm(restored!), hasCode("PREFERENCES_PENDING"));
  await withSessionLock(restored!, restored!.revision, () => changed(restored!));
  assert.equal((await getSession(state.id)).pendingOrder, undefined);
});

test("공유 저장소: 새 저장소에서도 장바구니/문맥/재시도 결과 보존, 고객별 격리", async () => {
  const a = await fixture(), b = await fixture();
  await withSessionLock(a, 0, () => {
    a.items = [makeItem("americano", 1, "ice", "M", [])];
    changed(a);
    a.lastTranscript = "테스트 고객 발화";
    a.history.push({ text: a.lastTranscript, applied: true, question: null });
    a.debug.transcript = a.lastTranscript;
    a.debug.extractedJson = "{}";
    a.requests.set("test-replay", {
      session: sessionView(a), transcript: a.lastTranscript, message: "처리", needsClarification: false, extractedJson: "{}",
    });
  });
  const second = new PostgresSessionRepository();
  const restored = (await second.find(a.id))!;
  assert.notEqual(restored, a);
  assert.equal(restored.items[0]!.lineTotal, 3500);
  assert.equal(restored.history[0]!.text, "테스트 고객 발화");
  assert.equal(restored.requests.get("test-replay")!.session.revision, 1);
  assert.equal((await second.find(b.id))!.items.length, 0);
  restored.items.length = 0;
  assert.equal((await repository.find(a.id))!.items.length, 1, "Detached reads cannot mutate shared storage");
});

test("확정 후 최소 주문만 영구 보관, 문맥 삭제, 새 저장소에서 같은 영수증 재시도", async () => {
  const a = await fixture();
  await add(a);
  await withSessionLock(a, a.revision, () => {
    a.lastTranscript = "보관하지 않을 발화";
    a.history.push({ text: a.lastTranscript, applied: true, question: null });
    a.debug.transcript = a.lastTranscript;
  });
  const result = await confirm(a);
  assert.equal(result.total, 10800);
  assert.equal(result.itemCount, 2);
  assert.equal(result.items[0]!.options[0]!.id, "shot");
  assert.match(result.orderNumber, /^\d{6,}$/);
  assert.equal(a.items.length, 0);
  assert.equal(a.lastTranscript, null);
  assert.equal(a.history.length, 0);
  assert.equal(a.requests.size, 0);
  await assert.rejects(getSession(a.id, true), hasCode("SESSION_CLOSED"));
  const second = new PostgresSessionRepository();
  const restored = (await second.find(a.id))!;
  assert.deepEqual(await second.confirm(restored), result);
  assert.deepEqual(restored.debug, { transcript: null, extractedJson: null, events: [] });
  const [stored] = await db.select().from(orders).where(eq(orders.confirmationKey, key(a.id)));
  assert.deepEqual(Object.keys(stored!).sort(), [
    "completedAt", "confirmationKey", "fulfilledAt", "fulfillmentStatus", "fulfillmentVersion",
    "itemCount", "items", "orderNumber", "preparationStartedAt", "total",
  ]);
  assert.equal(stored!.fulfillmentStatus, "pending");
  assert.equal(stored!.fulfillmentVersion, 0);
  assert.equal(stored!.preparationStartedAt, null);
  assert.equal(stored!.fulfilledAt, null);
  assert.ok(!JSON.stringify(stored, (_k, v) => typeof v === "bigint" ? v.toString() : v).includes("보관하지 않을 발화"));
  assert.equal("id" in (stored!.items[0] as object), false);
  await repository.delete(a.id);
  assert.equal(await repository.find(a.id), undefined);
  assert.equal((await db.select().from(orders).where(eq(orders.confirmationKey, key(a.id)))).length, 1);
});

test("180초 무입력은 읽기/진단 조회로 연장되지 않고 삭제", async () => {
  const a = await fixture();
  const initial = a.lastActivity;
  await repository.find(a.id);
  await getSession(a.id);
  assert.equal((await repository.find(a.id))!.lastActivity, initial);
  await db.update(sessions).set({ lastActivity: sql`clock_timestamp() - interval '180 seconds'` }).where(eq(sessions.id, a.id));
  await assert.rejects(getSession(a.id), hasCode("SESSION_EXPIRED"));
  assert.equal((await db.select().from(sessions).where(eq(sessions.id, a.id))).length, 0);
});

test("확정 주문은 임시 세션 만료/정리 이후에도 유지", async () => {
  const a = await fixture();
  await add(a);
  const result = await confirm(a);
  await db.update(sessions).set({ lastActivity: sql`clock_timestamp() - interval '181 seconds'` }).where(eq(sessions.id, a.id));
  await repository.cleanup();
  assert.equal(await repository.find(a.id), undefined);
  const [stored] = await db.select().from(orders).where(eq(orders.confirmationKey, key(a.id)));
  assert.equal(stored!.orderNumber.toString().padStart(6, "0"), result.orderNumber);
  const next = await fixture();
  assert.equal(next.items.length, 0);
  assert.equal(next.lastTranscript, null);
});

test("다중 서버 동시 잠금은 한 요청만 허용하고 오래된 revision 거부", async () => {
  const a = await fixture();
  const other = new PostgresSessionRepository();
  const b = (await other.find(a.id))!;
  const outcomes = await Promise.allSettled([repository.acquire(a, 0), other.acquire(b, 0)]);
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((r) => r.status === "rejected" && hasCode("SESSION_BUSY")(r.reason)).length, 1);
  const owner = outcomes[0]!.status === "fulfilled" ? a : b;
  changed(owner);
  await repository.release(owner);
  await assert.rejects(other.acquire(b, 0), hasCode("REVISION_CONFLICT"));
  assert.equal((await repository.find(a.id))!.revision, 1);
});

test("서버 장애로 lease 만료 시 다른 서버 재개, 이전 작업의 늦은 저장 차단", async () => {
  const a = await fixture();
  await repository.acquire(a, 0);
  await db.update(sessions).set({ lockUntil: sql`clock_timestamp() - interval '1 second'` }).where(eq(sessions.id, a.id));
  const second = new PostgresSessionRepository();
  const b = (await second.find(a.id))!;
  await second.acquire(b, 0);
  a.items = [makeItem("americano", 10, "ice", "M", [])];
  await assert.rejects(repository.release(a), hasCode("SESSION_CLOSED"));
  await assert.rejects(ensureCurrent(a), hasCode("SESSION_CLOSED"));
  await second.release(b);
  assert.equal((await second.find(a.id))!.items.length, 0);
});

test("취소 중 AI 처리의 늦은 응답은 세션을 복원하거나 주문 생성하지 못함", async () => {
  const a = await fixture();
  await add(a);
  await repository.acquire(a, a.revision);
  await new PostgresSessionRepository().delete(a.id);
  await assert.rejects(ensureCurrent(a), hasCode("SESSION_CLOSED"));
  await assert.rejects(repository.release(a), hasCode("SESSION_CLOSED"));
  await assert.rejects(confirmSession(a), hasCode("SESSION_EXPIRED"));
  assert.equal((await db.select().from(orders).where(eq(orders.confirmationKey, key(a.id)))).length, 0);
});

test("AI 전체취소 상태도 DB에서 즉시 삭제", async () => {
  const a = await fixture();
  await withSessionLock(a, 0, () => { a.status = "cancelled"; a.items = []; });
  assert.equal(await repository.find(a.id), undefined);
});

test("처리/heartbeat 중에도 180초 무입력이면 삭제, 늦은 결과 거부", async () => {
  const a = await fixture();
  await repository.acquire(a, 0);
  const activity = a.lastActivity;
  await repository.renew(a);
  assert.equal((await repository.find(a.id))!.lastActivity, activity);
  await db.update(sessions).set({ lastActivity: sql`clock_timestamp() - interval '181 seconds'` }).where(eq(sessions.id, a.id));
  await repository.cleanup();
  await assert.rejects(repository.release(a), hasCode("SESSION_CLOSED"));
});

test("처리 중 실제 고객 activity와 저장이 경합해도 새 활동시각/장바구니 보존", async () => {
  const a = await fixture();
  await repository.acquire(a, 0);
  await db.update(sessions).set({ lastActivity: sql`clock_timestamp() - interval '120 seconds'` }).where(eq(sessions.id, a.id));
  a.items = [makeItem("americano", 2, "ice", "M", [])];
  changed(a);
  const touched = await new PostgresSessionRepository().touch(a.id);
  await repository.release(a);
  const restored = (await repository.find(a.id))!;
  assert.equal(restored.lastActivity, touched.lastActivity);
  assert.equal(restored.items[0]!.quantity, 2);
});

test("동일 주문 동시 확정/재시도는 DB 행 하나와 동일 주문번호만 반환", async () => {
  const a = await fixture();
  await add(a);
  await repository.acquire(a, a.revision);
  const second = new PostgresSessionRepository();
  const [r1, r2] = await Promise.all([repository.confirm(a), second.confirm({ ...a })]);
  assert.deepEqual(r1, r2);
  assert.equal((await db.select().from(orders).where(eq(orders.confirmationKey, key(a.id)))).length, 1);
});

test("여러 서버의 서로 다른 확정 주문번호는 모두 고유", async () => {
  const customers = await Promise.all(Array.from({ length: 10 }, fixture));
  await Promise.all(customers.map(add));
  const receipts = await Promise.all(customers.map(confirm));
  assert.equal(new Set(receipts.map((r) => r.orderNumber)).size, customers.length);
});

test("빈 장바구니/잠금 없는 확정은 주문을 남기지 않음", async () => {
  const a = await fixture();
  await assert.rejects(confirmSession(a), hasCode("SESSION_CLOSED"));
  await assert.rejects(confirm(a), hasCode("EMPTY_CART"));
  assert.equal((await db.select().from(orders).where(eq(orders.confirmationKey, key(a.id)))).length, 0);
  assert.equal((await repository.find(a.id))!.busy, false);
});

test("DB 장애 시 모의 성공 없이 명확한 저장소 오류, 확정 상태를 바꾸지 않음", async (t) => {
  const a = await fixture();
  await add(a);
  await repository.acquire(a, a.revision);
  const stub = t.mock.method(db, "transaction", async () => { throw new Error("Database connection lost"); });
  await assert.rejects(confirmSession(a), hasCode("STORAGE_UNAVAILABLE"));
  stub.mock.restore();
  assert.equal(a.status, "active");
  assert.equal(a.receipt, undefined);
  assert.equal((await db.select().from(orders).where(eq(orders.confirmationKey, key(a.id)))).length, 0);
  await repository.release(a);
});

test("확정 트랜잭션의 세션 정리 실패 시 주문 INSERT까지 함께 롤백", async (t) => {
  const a = await fixture();
  await add(a);
  await repository.acquire(a, a.revision);
  const transaction = db.transaction.bind(db);
  const stub = t.mock.method(db, "transaction", (operation: Parameters<typeof db.transaction>[0]) => transaction(async (tx) => {
    const update = tx.update;
    tx.update = (() => { throw new Error("Simulated session update failure"); }) as typeof update;
    return operation(tx);
  }));
  await assert.rejects(confirmSession(a), hasCode("STORAGE_UNAVAILABLE"));
  stub.mock.restore();
  assert.equal((await db.select().from(orders).where(eq(orders.confirmationKey, key(a.id)))).length, 0);
  assert.equal((await repository.find(a.id))!.status, "active");
  await repository.release(a);
});
