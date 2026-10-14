import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, kioskRateLimitsTable as limits } from "@workspace/db";
import { KioskError } from "./errors";
import { logger } from "../lib/logger";

export const AI_RATE_LIMIT = 30;
export const AI_RATE_WINDOW_SECONDS = 60;
const now = sql`statement_timestamp()`;

export class RateLimitError extends KioskError {
  constructor(public readonly retryAfterSeconds: number) {
    super("TOO_MANY_REQUESTS", "주문 요청이 많습니다. 잠시 뒤 다시 시도하거나 화면에서 주문해주세요.", 429);
  }
}

/** Preserve the existing per-peer scope without trusting caller-supplied forwarding headers. */
export function rateLimitKey(peer: string): string {
  return createHash("sha256").update(`kiosk-ai:v1:${peer}`).digest("hex");
}

export class PostgresRateLimiter {
  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      if (error instanceof KioskError) throw error;
      // A shared-store outage must not silently remove the AI spending limit.
      throw new KioskError("STORAGE_UNAVAILABLE", "요청 한도를 확인하지 못했습니다. 잠시 뒤 다시 시도하거나 화면에서 주문해주세요.", 503);
    }
  }

  async consume(peer: string): Promise<void> {
    await this.run(async () => {
      const expired = sql`${limits.expiresAt} <= ${now}`;
      const nextExpiry = sql`${now} + ${AI_RATE_WINDOW_SECONDS} * interval '1 second'`;
      // PostgreSQL serializes conflicting upserts on the primary key. No preceding
      // read, local cache, server clock or startup reset can admit extra requests.
      // Saturate denied counts and never slide the window on a rejected request.
      const [entry] = await db.insert(limits).values({
        key: rateLimitKey(peer), count: 1, expiresAt: nextExpiry,
      }).onConflictDoUpdate({
        target: limits.key,
        set: {
          count: sql`case when ${expired} then 1 else least(${limits.count} + 1, ${AI_RATE_LIMIT + 1}) end`,
          expiresAt: sql`case when ${expired} then ${nextExpiry} else ${limits.expiresAt} end`,
        },
      }).returning({
        count: limits.count,
        retryAfter: sql<number>`greatest(1, ceil(extract(epoch from (${limits.expiresAt} - ${now}))))::integer`,
      });
      if (!entry) throw new Error("Rate limit counter was not returned");
      if (entry.count > AI_RATE_LIMIT) throw new RateLimitError(entry.retryAfter);
    });
  }

  async cleanup(): Promise<void> {
    await this.run(async () => {
      // Bounded indexed batches. Recheck expiry on the target row after waiting
      // for a concurrent upsert, so a newly renewed window cannot be deleted.
      await db.execute(sql`
        delete from ${limits}
        where ${limits.key} in (
          select ${limits.key} from ${limits}
          where ${limits.expiresAt} <= ${now}
          order by ${limits.expiresAt} limit 1000
        ) and ${limits.expiresAt} <= ${now}
      `);
    });
  }
}

export const rateLimiter = new PostgresRateLimiter();

export function startRateLimitCleanup() {
  let running = false;
  const sweep = async () => {
    if (running) return;
    running = true;
    try { await rateLimiter.cleanup(); }
    catch {
      logger.warn({ code: "RATE_LIMIT_CLEANUP_FAILED" }, "Expired rate limit cleanup failed");
    } finally { running = false; }
  };
  void sweep();
  const timer = setInterval(() => { void sweep(); }, 60_000);
  timer.unref();
  return timer;
}
