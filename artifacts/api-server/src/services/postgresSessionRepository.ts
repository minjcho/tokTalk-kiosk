import { createHash, randomUUID } from "node:crypto";
import { and, eq, gt, lte, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db, kioskSessionsTable as sessions, kioskOrdersTable as orders,
  type KioskSessionRecord, type KioskOrderRecord,
} from "@workspace/db";
import { GetSessionResponse, GetSessionDebugResponse, SubmitTextOrderResponse, ConfirmOrderResponse } from "@workspace/api-zod";
import { KioskError } from "./errors";
import type { SessionRepository, SessionState } from "./sessionService";
import type { Receipt } from "./orderTypes";
import { ActionSchema } from "./orderTypes";

const IDLE_INTERVAL = sql`interval '180 seconds'`;
const LEASE_INTERVAL = sql`interval '30 seconds'`;
const now = sql`clock_timestamp()`;
const live = gt(sessions.lastActivity, sql`${now} - ${IDLE_INTERVAL}`);
const emptyData = {
  items: [], lastTranscript: null, clarification: null, pendingOrder: [], history: [],
  debug: { transcript: null, extractedJson: null, events: [] }, requests: [],
};
const storedData = z.object({
  items: GetSessionResponse.shape.items,
  lastTranscript: z.string().nullable(),
  clarification: z.string().nullable(),
  pendingOrder: z.array(ActionSchema).optional(),
  pendingCustomizationConfirmed: z.boolean().optional(),
  history: z.array(z.object({ text: z.string(), applied: z.boolean(), question: z.string().nullable() })),
  debug: GetSessionDebugResponse,
  requests: z.array(z.tuple([z.string(), SubmitTextOrderResponse])),
});
const validId = (id: string) => z.string().uuid().safeParse(id).success;
const confirmationKey = (id: string) => createHash("sha256").update(id).digest("hex");
const expired = () => new KioskError("SESSION_EXPIRED", "주문 시간이 종료되었습니다. 새 주문을 시작해주세요.", 410);
const closed = () => new KioskError("SESSION_CLOSED", "종료되었거나 처리 시간이 지난 주문입니다. 새 주문을 시작해주세요.", 409);

function encode(session: SessionState): Record<string, unknown> {
  return {
    items: session.items, lastTranscript: session.lastTranscript, clarification: session.clarification,
    history: session.history, pendingOrder: session.pendingOrder,
    pendingCustomizationConfirmed: session.pendingCustomizationConfirmed,
    debug: session.debug, requests: [...session.requests],
  };
}

function decode(row: KioskSessionRecord): SessionState {
  const data = storedData.parse(row.data);
  return {
    ...data, id: row.id, revision: row.revision, status: row.status, lastActivity: row.lastActivity.getTime(),
    busy: row.lockToken !== null, lockToken: undefined, requests: new Map(data.requests),
  };
}

function receipt(row: KioskOrderRecord): Receipt {
  const orderNumber = row.orderNumber.toString().padStart(6, "0");
  return ConfirmOrderResponse.parse({
    orderNumber, items: row.items.map((item, index) => ({ ...(item as object), id: `${orderNumber}-${index + 1}` })),
    total: row.total, itemCount: row.itemCount, completedAt: row.completedAt.toISOString(),
  });
}

/** All checks use the DB clock, not an individual server's clock. No memory fallback. */
export class PostgresSessionRepository implements SessionRepository {
  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      if (error instanceof KioskError) throw error;
      throw new KioskError("STORAGE_UNAVAILABLE", "주문 저장소에 연결하지 못했습니다. 확정 여부를 확인하려면 잠시 뒤 다시 시도해주세요.", 503);
    }
  }

  private owned(session: SessionState) {
    if (!session.lockToken) return sql`false`;
    return and(
      eq(sessions.id, session.id), eq(sessions.status, "active"), live,
      eq(sessions.lockToken, session.lockToken), gt(sessions.lockUntil, now),
    );
  }

  async save(session: SessionState): Promise<void> {
    await this.run(async () => {
      if (session.lockToken) {
        const [saved] = await db.update(sessions).set({ data: encode(session), revision: session.revision })
          .where(this.owned(session)).returning();
        if (!saved) throw closed();
      } else {
        // Inserts only: an old detached snapshot must never resurrect a deleted session.
        const [saved] = await db.insert(sessions).values({ id: session.id, data: encode(session) }).returning();
        session.lastActivity = saved!.lastActivity.getTime();
      }
    });
  }

  async find(id: string): Promise<SessionState | undefined> {
    if (!validId(id)) return undefined;
    return this.run(async () => {
      await db.delete(sessions).where(and(eq(sessions.id, id), lte(sessions.lastActivity, sql`${now} - ${IDLE_INTERVAL}`)));
      const [row] = await db.select().from(sessions).where(and(eq(sessions.id, id), live));
      if (!row) return undefined;
      const state = decode(row);
      if (row.status === "completed") {
        const [order] = await db.select().from(orders).where(eq(orders.confirmationKey, confirmationKey(id)));
        if (!order) throw new Error("Completed session has no order");
        state.receipt = receipt(order);
      }
      return state;
    });
  }

  async delete(id: string): Promise<void> {
    if (!validId(id)) return;
    await this.run(async () => { await db.delete(sessions).where(eq(sessions.id, id)); });
  }

  async all(): Promise<IterableIterator<SessionState>> {
    return this.run(async () => (await db.select().from(sessions).where(live)).map(decode).values());
  }

  async acquire(session: SessionState, revision?: number): Promise<void> {
    await this.run(() => db.transaction(async (tx) => {
      const [row] = await tx.select().from(sessions).where(and(eq(sessions.id, session.id), live)).for("update");
      if (!row) throw expired();
      if (row.status !== "active") throw closed();
      // Evaluated by PostgreSQL after the row lock is acquired.
      const [lease] = await tx.select({ busy: sql<boolean>`${sessions.lockUntil} > ${now}` }).from(sessions).where(eq(sessions.id, row.id));
      if (row.lockToken && lease?.busy) throw new KioskError("SESSION_BUSY", "이전 주문을 처리 중입니다. 잠시 기다려주세요.", 409);
      if (revision !== undefined && row.revision !== revision) {
        throw new KioskError("REVISION_CONFLICT", "장바구니가 변경되었습니다. 현재 내용을 확인하고 다시 시도해주세요.", 409);
      }
      const token = randomUUID();
      const [locked] = await tx.update(sessions).set({ lockToken: token, lockUntil: sql`${now} + ${LEASE_INTERVAL}`, lastActivity: now })
        .where(and(eq(sessions.id, row.id), live)).returning();
      if (!locked) throw expired();
      Object.assign(session, decode(locked), { busy: true, lockToken: token });
    }));
  }

  async release(session: SessionState): Promise<void> {
    if (!session.lockToken) return;
    await this.run(async () => {
      if (session.status === "cancelled") {
        const [deleted] = await db.delete(sessions).where(this.owned(session)).returning({ id: sessions.id });
        if (!deleted) throw closed();
      } else {
        const [saved] = await db.update(sessions).set({
          data: encode(session), revision: session.revision, lockToken: null, lockUntil: null,
        }).where(this.owned(session)).returning();
        if (!saved) throw closed();
        session.lastActivity = saved.lastActivity.getTime();
      }
      session.busy = false;
      session.lockToken = undefined;
    });
  }

  async renew(session: SessionState): Promise<void> {
    if (!session.lockToken) return;
    await this.run(async () => {
      const [renewed] = await db.update(sessions).set({ lockUntil: sql`${now} + ${LEASE_INTERVAL}` })
        .where(this.owned(session)).returning({ id: sessions.id });
      if (!renewed) throw closed();
    });
  }

  async isCurrent(session: SessionState): Promise<boolean> {
    return this.run(async () => (await db.select({ id: sessions.id }).from(sessions).where(this.owned(session))).length === 1);
  }

  async touch(id: string): Promise<SessionState> {
    if (!validId(id)) throw expired();
    return this.run(async () => {
      const [row] = await db.update(sessions).set({ lastActivity: now })
        .where(and(eq(sessions.id, id), eq(sessions.status, "active"), live)).returning();
      if (!row) throw expired();
      return decode(row);
    });
  }

  async confirm(session: SessionState): Promise<Receipt> {
    const result = await this.run(() => db.transaction(async (tx) => {
      const [row] = await tx.select().from(sessions).where(and(eq(sessions.id, session.id), live)).for("update");
      if (!row) throw expired();
      const key = confirmationKey(session.id);
      const [existing] = await tx.select().from(orders).where(eq(orders.confirmationKey, key));
      if (existing) return { order: existing, revision: row.revision, lastActivity: row.lastActivity };
      if (row.status !== "active" || !session.lockToken || row.lockToken !== session.lockToken) throw closed();
      const [owned] = await tx.select({ id: sessions.id }).from(sessions).where(this.owned(session));
      if (!owned) throw closed();
      // Confirm the authoritative persisted cart, never a stale caller's copy.
      const current = decode(row);
      if (!current.items.length) throw new KioskError("EMPTY_CART", "주문할 메뉴를 먼저 선택해주세요.");
      const [order] = await tx.insert(orders).values({
        confirmationKey: key,
        items: current.items.map(({ id: _id, ...item }) => item),
        total: current.items.reduce((sum, item) => sum + item.lineTotal, 0),
        itemCount: current.items.reduce((sum, item) => sum + item.quantity, 0),
      }).returning();
      const [completed] = await tx.update(sessions).set({
        data: emptyData, status: "completed", revision: row.revision + 1, lastActivity: now,
        lockToken: null, lockUntil: null,
      }).where(this.owned(session)).returning();
      if (!completed || !order) throw closed(); // Rolls back the order too.
      return { order, revision: completed.revision, lastActivity: completed.lastActivity };
    }));
    const confirmed = receipt(result.order);
    Object.assign(session, {
      ...structuredClone(emptyData), status: "completed", revision: result.revision,
      lastActivity: result.lastActivity.getTime(), busy: false, lockToken: undefined,
      requests: new Map(), receipt: confirmed,
    });
    return confirmed;
  }

  async cleanup(): Promise<void> {
    await this.run(async () => { await db.delete(sessions).where(lte(sessions.lastActivity, sql`${now} - ${IDLE_INTERVAL}`)); });
  }
}
