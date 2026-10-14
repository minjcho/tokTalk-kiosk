import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express, { type RequestHandler } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool, kioskOrdersTable as orders, kioskOrderEventsTable as events, kioskStaffTable as staff } from "@workspace/db";
import { logger } from "../lib/logger";
import { staffAuthorization, staffRequestBoundary, isActiveStaff } from "../middlewares/requireStaff";
import { createStaffRouter } from "../routes/staff";
import { listStaffOrders, updateStaffOrderStatus } from "../services/staffOrderRepository";
import { makeItem } from "../services/cartService";
import { KioskError } from "../services/errors";
import { ListStaffOrdersResponse, UpdateStaffOrderStatusResponse } from "@workspace/api-zod";

const actor = `user_test${randomUUID().replaceAll("-", "")}`;
const created: bigint[] = [];
const hasCode = (code: string) => (error: unknown) => error instanceof KioskError && error.code === code;
async function member(active = true) {
  await db.insert(staff).values({ userId: actor, active })
    .onConflictDoUpdate({ target: staff.userId, set: { active } });
}
async function fixture() {
  const { id: _id, ...item } = makeItem("cafe-latte", 2, "ice", "L", ["shot"]);
  const [row] = await db.insert(orders).values({
    confirmationKey: randomUUID(), items: [item], total: item.lineTotal, itemCount: 2,
  }).returning();
  created.push(row!.orderNumber);
  return row!;
}
after(async () => {
  try {
    if (created.length) await db.delete(orders).where(inArray(orders.orderNumber, created));
    await db.delete(staff).where(eq(staff.userId, actor));
  } finally { await pool.end(); }
});

async function http(authorization: RequestHandler, run: (base: string) => Promise<void>) {
  const app = express();
  app.use((req, _res, next) => { req.log = logger; next(); });
  app.use(staffRequestBoundary);
  app.use(express.json());
  app.use(createStaffRouter(authorization));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    await run(`http://127.0.0.1:${address.port}`);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

test("직원 인증: 익명/가짜 역할 헤더/주문번호는 조회·변경 권한을 주지 않음", async () => {
  let lookups = 0;
  await http(staffAuthorization(() => null, async () => { lookups++; return true; }), async (base) => {
    for (const path of ["/staff/me", "/staff/orders", "/staff/orders/000001/status"]) {
      const response = await fetch(`${base}${path}`, {
        method: path.endsWith("/status") ? "PATCH" : "GET",
        headers: { "Content-Type": "application/json", "X-Staff-Role": "admin", "X-User-Id": actor },
        ...(path.endsWith("/status") ? { body: JSON.stringify({ status: "completed", expectedVersion: 0 }) } : {}),
      });
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(Object.keys(await response.json() as object).sort(), ["code", "error"]);
    }
  });
  assert.equal(lookups, 0);
});

test("직원 인증: 로그인만 한 계정은 403, 권한 저장소 장애는 503으로 닫힘", async () => {
  await http(staffAuthorization(() => actor, async () => false), async (base) => {
    assert.equal((await fetch(`${base}/staff/orders`)).status, 403);
  });
  await http(staffAuthorization(() => actor, async () => { throw new Error("unavailable"); }), async (base) => {
    const response = await fetch(`${base}/staff/orders`);
    assert.equal(response.status, 503);
    assert.equal((await response.json() as { code: string }).code, "STAFF_STORAGE_UNAVAILABLE");
  });
});

test("승인 및 철회는 요청마다 DB에서 반영; 비활성 기본값은 권한 없음", async () => {
  await member();
  await http(staffAuthorization(() => actor, isActiveStaff), async (base) => {
    const response = await fetch(`${base}/staff/me`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { userId: actor });
    await member(false);
    assert.equal((await fetch(`${base}/staff/me`)).status, 403);
    assert.equal((await fetch(`${base}/staff/orders`)).status, 403);
  });
});

test("쿠키 직원 API: 외부 Origin/교차 사이트/폼 변경 차단, 동일 출처 JSON 허용", async () => {
  await http(staffAuthorization(() => actor, async () => true), async (base) => {
    const path = `${base}/staff/orders/1/status`;
    for (const headers of [{ Origin: "https://evil.example" }, { "Sec-Fetch-Site": "cross-site" }]) {
      assert.equal((await fetch(path, { method: "PATCH", headers: { ...headers, "Content-Type": "application/json" }, body: "{}" })).status, 403);
    }
    assert.equal((await fetch(path, { method: "PATCH", headers: { "Content-Type": "text/plain" }, body: "{}" })).status, 400);
    assert.equal((await fetch(`${base}/staff/me`, { headers: { Origin: base } })).status, 200);
    assert.equal((await fetch(`${base}/staff/me`, { headers: { Origin: base.replace("http:", "https:") } })).status, 403);
  });
});

test("직원 계약: 잘못된 상태/버전/번호/추가 필드를 거절하고 내부 데이터는 응답하지 않음", async () => {
  await member();
  const row = await fixture();
  await http(staffAuthorization(() => actor, isActiveStaff), async (base) => {
    for (const query of ["status=cancelled", "before=abc", "before=9999999999999999999", "customerId=any"]) {
      assert.equal((await fetch(`${base}/staff/orders?${query}`)).status, 400);
    }
    for (const body of [
      { status: "pending", expectedVersion: 0 }, { status: "preparing", expectedVersion: -1 },
      { status: "preparing" }, { status: "preparing", expectedVersion: 0, actorUserId: "spoof" },
    ]) {
      const response = await fetch(`${base}/staff/orders/${row.orderNumber}/status`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      assert.equal(response.status, 400);
    }
    const response = await fetch(`${base}/staff/orders?status=pending`);
    assert.equal(response.status, 200);
    const body = ListStaffOrdersResponse.parse(await response.json());
    const result = body.orders.find((order: { orderNumber: string }) => BigInt(order.orderNumber) === row.orderNumber);
    assert.ok(result);
    for (const privateField of ["confirmationKey", "sessionId", "history", "lastTranscript", "debug"]) {
      assert.equal(JSON.stringify(body).includes(`"${privateField}"`), false);
    }
    assert.equal(result.items[0].options[0].id, "shot");
    assert.equal(result.total, row.total);
    assert.equal(result.confirmedAt, row.completedAt.toISOString());
    const changed = await fetch(`${base}/staff/orders/${row.orderNumber}/status`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "preparing", expectedVersion: 0 }),
    });
    assert.equal(changed.status, 200);
    assert.equal(UpdateStaffOrderStatusResponse.parse(await changed.json()).status, "preparing");
  });
});

test("제작 순서와 시각·버전·감사기록 저장, 확정 영수증/가격은 불변", async () => {
  await member();
  const row = await fixture();
  assert.equal(row.fulfillmentStatus, "pending");
  await assert.rejects(updateStaffOrderStatus(String(row.orderNumber), "completed", 0, actor), hasCode("STAFF_ORDER_CONFLICT"));
  const preparing = await updateStaffOrderStatus(String(row.orderNumber), "preparing", 0, actor);
  assert.equal(preparing.version, 1);
  assert.ok(preparing.preparationStartedAt);
  assert.equal(preparing.fulfilledAt, null);
  const completed = await updateStaffOrderStatus(preparing.orderNumber, "completed", 1, actor);
  assert.equal(completed.status, "completed");
  assert.equal(completed.version, 2);
  assert.ok(completed.fulfilledAt);
  assert.equal(completed.preparationStartedAt, preparing.preparationStartedAt);
  const [saved] = await db.select().from(orders).where(eq(orders.orderNumber, row.orderNumber));
  assert.equal(saved!.completedAt.toISOString(), row.completedAt.toISOString());
  assert.equal(saved!.total, row.total);
  assert.deepEqual(saved!.items, row.items);
  assert.equal(saved!.confirmationKey, row.confirmationKey);
  const audit = await db.select().from(events).where(eq(events.orderNumber, row.orderNumber)).orderBy(events.id);
  assert.deepEqual(audit.map((event) => [event.fromStatus, event.toStatus, event.actorUserId]), [
    ["pending", "preparing", actor], ["preparing", "completed", actor],
  ]);
  await assert.rejects(updateStaffOrderStatus(preparing.orderNumber, "preparing", 2, actor), hasCode("STAFF_ORDER_CONFLICT"));
  await assert.rejects(updateStaffOrderStatus(preparing.orderNumber, "completed", 1, actor), hasCode("STAFF_ORDER_CONFLICT"));
});

test("동시 직원 변경은 하나만 반영하고 중복 감사기록 없이 409 반환", async () => {
  await member();
  const row = await fixture();
  const results = await Promise.allSettled([
    updateStaffOrderStatus(String(row.orderNumber), "preparing", 0, actor),
    updateStaffOrderStatus(String(row.orderNumber), "preparing", 0, actor),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
  assert.ok(hasCode("STAFF_ORDER_CONFLICT")(rejected.reason));
  assert.equal((await db.select().from(events).where(eq(events.orderNumber, row.orderNumber))).length, 1);
});

test("없는 주문은 404, 철회된 직원은 서비스 계층에서도 변경 불가", async () => {
  await member();
  await assert.rejects(updateStaffOrderStatus("9223372036854775807", "preparing", 0, actor), hasCode("STAFF_ORDER_NOT_FOUND"));
  const row = await fixture();
  await member(false);
  await assert.rejects(updateStaffOrderStatus(String(row.orderNumber), "preparing", 0, actor), hasCode("STAFF_FORBIDDEN"));
  const [saved] = await db.select().from(orders).where(eq(orders.orderNumber, row.orderNumber));
  assert.equal(saved!.fulfillmentStatus, "pending");
});

test("목록은 50개씩 번호 커서로 제한하며 상태 필터와 재조회에 영구 반영", async () => {
  const { id: _id, ...item } = makeItem("americano", 1, "hot", "M", []);
  const rows = await db.insert(orders).values(Array.from({ length: 52 }, () => ({
    confirmationKey: randomUUID(), items: [item], total: item.lineTotal, itemCount: 1,
    fulfillmentStatus: "completed" as const,
  }))).returning({ orderNumber: orders.orderNumber });
  created.push(...rows.map((row) => row.orderNumber));
  const first = await listStaffOrders("completed");
  assert.equal(first.orders.length, 50);
  assert.ok(first.nextCursor);
  assert.ok(first.orders.every((order) => order.status === "completed"));
  const second = await listStaffOrders("completed", first.nextCursor!);
  assert.ok(second.orders.every((order) => BigInt(order.orderNumber) < BigInt(first.nextCursor!)));
  assert.ok(first.orders.every((order) => !second.orders.some((other) => other.orderNumber === order.orderNumber)));
  const ownIds = new Set(rows.map((row) => row.orderNumber.toString()));
  assert.equal([...first.orders, ...second.orders].filter((order) => ownIds.has(BigInt(order.orderNumber).toString())).length, 52);
  assert.equal((await db.select().from(orders).where(and(inArray(orders.orderNumber, [...ownIds].map(BigInt)), eq(orders.fulfillmentStatus, "completed")))).length, 52);
});
