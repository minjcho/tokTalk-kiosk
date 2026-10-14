import { createClerkClient } from "@clerk/express";
import { db, pool, kioskStaffTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

// Operator-only CLI. No HTTP grant endpoint; public signup never grants access.
const [action, userId, ...extra] = process.argv.slice(2);
try {
  if (!["grant", "revoke"].includes(action ?? "") || !/^user_[A-Za-z0-9]{1,120}$/.test(userId ?? "") || extra.length) {
    throw new Error("Usage: pnpm --filter @workspace/api-server staff:access <grant|revoke> <Clerk user ID>");
  }
  if (action === "grant") {
    const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
    // Prevent typo grants and mixing IDs between development and production tenants.
    await clerk.users.getUser(userId!);
    await db.insert(kioskStaffTable).values({ userId: userId!, active: true })
      .onConflictDoUpdate({ target: kioskStaffTable.userId, set: { active: true, updatedAt: new Date() } });
  } else {
    await db.update(kioskStaffTable).set({ active: false, updatedAt: new Date() }).where(eq(kioskStaffTable.userId, userId!));
  }
  logger.info({ action }, "Staff access updated");
} catch {
  logger.error("Staff access change failed. Check the command, Clerk user ID and database/auth configuration.");
  process.exitCode = 1;
} finally {
  await pool.end();
}
