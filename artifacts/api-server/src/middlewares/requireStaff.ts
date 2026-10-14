import { getAuth } from "@clerk/express";
import { and, eq } from "drizzle-orm";
import type { Request, RequestHandler } from "express";
import { db, kioskStaffTable } from "@workspace/db";
import { getClerkProxyHost } from "./clerkProxyMiddleware";

export async function isActiveStaff(userId: string): Promise<boolean> {
  const [member] = await db.select({ userId: kioskStaffTable.userId }).from(kioskStaffTable)
    .where(and(eq(kioskStaffTable.userId, userId), eq(kioskStaffTable.active, true))).limit(1);
  return Boolean(member);
}

// Dependency injection permits deterministic denial tests, not a runtime bypass.
export function staffAuthorization(
  readUser: (req: Request) => string | null,
  approved: (userId: string) => Promise<boolean>,
): RequestHandler {
  return async (req, res, next): Promise<void> => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Vary", "Cookie");
    let userId: string | null;
    try { userId = readUser(req); }
    catch { res.status(401).json({ code: "STAFF_UNAUTHENTICATED", error: "직원 로그인이 필요합니다." }); return; }
    if (!userId) {
      res.status(401).json({ code: "STAFF_UNAUTHENTICATED", error: "직원 로그인이 필요합니다." });
      return;
    }
    try {
      if (!await approved(userId)) {
        res.status(403).json({ code: "STAFF_FORBIDDEN", error: "직원으로 승인된 계정만 이용할 수 있습니다." });
        return;
      }
    } catch {
      req.log.warn({ code: "STAFF_STORAGE_UNAVAILABLE" }, "Staff authorization unavailable");
      res.status(503).json({ code: "STAFF_STORAGE_UNAVAILABLE", error: "직원 권한을 확인할 수 없습니다. 잠시 뒤 다시 시도해주세요." });
      return;
    }
    res.locals.staffUserId = userId;
    next();
  };
}

export const requireStaff = staffAuthorization((req) => getAuth(req).userId ?? null, isActiveStaff);

/** Cookie authentication requires same-origin JSON writes, not permissive CORS. */
export const staffRequestBoundary: RequestHandler = (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Vary", "Cookie");
  const origin = req.get("origin");
  let foreignOrigin = false;
  if (origin) {
    try {
      const parsed = new URL(origin);
      const protocol = req.get("x-forwarded-proto")?.split(",")[0]?.trim() || req.protocol;
      foreignOrigin = parsed.host !== getClerkProxyHost(req) || parsed.protocol !== `${protocol}:`;
    } catch { foreignOrigin = true; }
  }
  if (foreignOrigin || req.get("sec-fetch-site") === "cross-site") {
    res.status(403).json({ code: "STAFF_CROSS_SITE", error: "직원 화면에서 다시 요청해주세요." });
    return;
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !req.is("application/json")) {
    res.status(400).json({ code: "STAFF_INVALID_INPUT", error: "JSON 요청이 필요합니다." });
    return;
  }
  next();
};
