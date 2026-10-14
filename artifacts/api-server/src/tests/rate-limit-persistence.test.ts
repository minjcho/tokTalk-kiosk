import { after, test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { db, pool, kioskRateLimitsTable as limits } from "@workspace/db";
import { KioskError } from "../services/errors";
import { AI_RATE_LIMIT, AI_RATE_WINDOW_SECONDS, PostgresRateLimiter, RateLimitError, rateLimitKey } from "../services/rateLimitService";
import { counter, peer, removeCounters, worker } from "./helpers/rate-limit-fixtures";

const limiter = new PostgresRateLimiter();
after(async () => {
  try { await removeCounters(); } finally { await pool.end(); }
});

test("정상 짧은 연속 입력 30회 허용, 31회부터 429, 거부로 창이 연장되지 않음", async () => {
  const client = peer();
  for (let i = 0; i < AI_RATE_LIMIT; i++) await limiter.consume(client);
  const before = (await counter(client))!;
  assert.equal(before.count, 30);
  assert.equal(before.key.length, 64);
  assert.ok(!JSON.stringify(before).includes(client));
  for (let i = 0; i < 5; i++) {
    await assert.rejects(limiter.consume(client), (error: unknown) => {
      assert.ok(error instanceof RateLimitError);
      assert.equal(error.status, 429);
      assert.ok(error.retryAfterSeconds >= 1 && error.retryAfterSeconds <= AI_RATE_WINDOW_SECONDS);
      return true;
    });
  }
  const after = (await counter(client))!;
  assert.equal(after.count, 31, "Denied count is bounded");
  assert.equal(after.expiresAt.getTime(), before.expiresAt.getTime());
  const other = peer();
  await limiter.consume(other);
  assert.equal((await counter(other))!.count, 1);
});

test("4개 독립 서버 프로세스의 동시 80회 요청도 총 30회만 허용", async () => {
  const client = peer();
  const outcomes = await Promise.all(Array.from({ length: 4 }, () => worker({ peer: client, count: 20 })));
  assert.equal(outcomes.reduce((sum, value) => sum + value.allowed, 0), 30);
  assert.equal(outcomes.reduce((sum, value) => sum + value.limited, 0), 50);
  assert.equal((await counter(client))!.count, 31);
});

test("서버 종료/재시작 후에도 남은 한도가 그대로 적용", async () => {
  const client = peer();
  assert.deepEqual(await worker({ peer: client, count: 29 }), { allowed: 29, limited: 0 });
  assert.deepEqual(await worker({ peer: client, count: 2 }), { allowed: 1, limited: 1 });
  assert.deepEqual(await worker({ peer: client, count: 1 }), { allowed: 0, limited: 1 });
});

test("DB 만료 경계에서 동시 요청은 새 창 하나만 생성, 서버 시계 변경은 무관", async (t) => {
  const client = peer();
  await limiter.consume(client);
  const originalExpiry = (await counter(client))!.expiresAt.getTime();
  const clock = t.mock.method(Date, "now", () => originalExpiry + 86_400_000);
  await limiter.consume(client);
  assert.equal((await counter(client))!.count, 2, "A fast server clock cannot reset the DB window");
  await db.update(limits).set({ count: 31, expiresAt: sql`statement_timestamp()` }).where(eq(limits.key, rateLimitKey(client)));
  clock.mock.mockImplementation(() => 0);
  const outcomes = await Promise.allSettled(Array.from({ length: 50 }, () => new PostgresRateLimiter().consume(client)));
  assert.equal(outcomes.filter((value) => value.status === "fulfilled").length, 30);
  assert.equal(outcomes.filter((value) => value.status === "rejected" && value.reason instanceof RateLimitError).length, 20);
  clock.mock.restore();
});

test("만료 기록 정리 후 정상 재개; 아직 유효한 제한 기록은 유지", async () => {
  const expired = peer(), active = peer();
  await limiter.consume(expired);
  await limiter.consume(active);
  await db.update(limits).set({ expiresAt: sql`statement_timestamp() - interval '1 second'` }).where(eq(limits.key, rateLimitKey(expired)));
  await Promise.all([limiter.cleanup(), new PostgresRateLimiter().cleanup()]);
  assert.equal(await counter(expired), undefined);
  assert.equal((await counter(active))!.count, 1);
  await limiter.consume(expired);
  assert.equal((await counter(expired))!.count, 1);
});

test("정리와 만료 창 재사용이 경합해도 새 창이 사라지지 않음", async () => {
  const client = peer();
  for (let i = 0; i < 12; i++) {
    await limiter.consume(client);
    await db.update(limits).set({ expiresAt: sql`statement_timestamp() - interval '1 second'` }).where(eq(limits.key, rateLimitKey(client)));
    await Promise.all([limiter.cleanup(), new PostgresRateLimiter().consume(client)]);
    assert.equal((await counter(client))!.count, 1);
  }
});

test("DB 오류는 로컬 우회나 AI 허용 없이 STORAGE_UNAVAILABLE", async (t) => {
  const client = peer();
  const stub = t.mock.method(db, "insert", () => { throw new Error("Simulated store outage"); });
  await assert.rejects(limiter.consume(client), (error: unknown) => error instanceof KioskError && error.code === "STORAGE_UNAVAILABLE" && error.status === 503);
  stub.mock.restore();
  assert.equal(await counter(client), undefined);
});
