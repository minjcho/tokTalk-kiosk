import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, kioskRateLimitsTable as limits } from "@workspace/db";
import { rateLimitKey } from "../../services/rateLimitService";
import type { RateLimitJob } from "./rate-limit-worker";

export const peers: string[] = [];
export function peer() {
  const value = `test-peer:${randomUUID()}`;
  peers.push(value);
  return value;
}
export async function counter(value: string) {
  const [row] = await db.select().from(limits).where(eq(limits.key, rateLimitKey(value)));
  return row;
}
export async function removeCounters() {
  for (const value of peers) await db.delete(limits).where(eq(limits.key, rateLimitKey(value)));
}

export function worker<T = { allowed: number; limited: number }>(job: RateLimitJob): Promise<T> {
  return new Promise((resolve, reject) => {
    // Inherit tsx's loader, but not the node:test runner flag.
    const child = fork(new URL("./rate-limit-worker.ts", import.meta.url), [], {
      execArgv: process.execArgv.filter((arg) => arg !== "--test"),
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    let result: T;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Rate limit worker timed out"));
    }, 20_000);
    child.on("message", (message) => { result = message as T; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0 || result === undefined) reject(new Error(`Rate limit worker exited with ${code}`));
      else resolve(result);
    });
    child.send(job);
  });
}
