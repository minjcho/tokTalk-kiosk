import { pool } from "@workspace/db";
import { KioskError } from "../../services/errors";
import { PostgresRateLimiter } from "../../services/rateLimitService";
import { kioskRequest } from "./kiosk-request";

export interface RateLimitJob {
  peer: string;
  count?: number;
  request?: { method: string; url: string; body: unknown };
}

process.once("message", async (job: RateLimitJob) => {
  try {
    const limiter = new PostgresRateLimiter();
    let result: unknown;
    if (job.request) {
      result = await kioskRequest(job.peer, job.request.method, job.request.url, job.request.body);
    } else {
      const outcomes = await Promise.all(Array.from({ length: job.count! }, async () => {
        try { await limiter.consume(job.peer); return "allowed"; }
        catch (error) {
          if (error instanceof KioskError && error.code === "TOO_MANY_REQUESTS") return "limited";
          throw error;
        }
      }));
      result = { allowed: outcomes.filter((v) => v === "allowed").length, limited: outcomes.filter((v) => v === "limited").length };
    }
    await pool.end();
    process.send!(result, () => process.disconnect?.());
  } catch {
    await pool.end();
    process.exitCode = 1;
    process.disconnect?.();
  }
});
