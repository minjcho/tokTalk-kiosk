import { and, desc, eq, lt, sql } from "drizzle-orm";
import { db, kioskOrdersTable as orders, kioskOrderEventsTable as events, kioskStaffTable as staff } from "@workspace/db";
import { ListStaffOrdersResponse, UpdateStaffOrderStatusResponse } from "@workspace/api-zod";
import { KioskError } from "./errors";

type Status = "pending" | "preparing" | "completed";
// Deliberately exclude the private confirmation key, customer sessions and conversations.
const projection = {
  orderNumber: orders.orderNumber, items: orders.items, total: orders.total, itemCount: orders.itemCount,
  completedAt: orders.completedAt, fulfillmentStatus: orders.fulfillmentStatus,
  fulfillmentVersion: orders.fulfillmentVersion, preparationStartedAt: orders.preparationStartedAt, fulfilledAt: orders.fulfilledAt,
};
type OrderRow = { [K in keyof typeof projection]: (typeof orders.$inferSelect)[K] };

function staffView(row: OrderRow) {
  const orderNumber = row.orderNumber.toString().padStart(6, "0");
  return UpdateStaffOrderStatusResponse.parse({
    orderNumber,
    items: row.items.map((item, index) => ({ ...(item as object), id: `${orderNumber}-${index + 1}` })),
    total: row.total, itemCount: row.itemCount, confirmedAt: row.completedAt.toISOString(),
    status: row.fulfillmentStatus, version: row.fulfillmentVersion,
    preparationStartedAt: row.preparationStartedAt?.toISOString() ?? null,
    fulfilledAt: row.fulfilledAt?.toISOString() ?? null,
  });
}

function orderId(value: string): bigint {
  const id = BigInt(value);
  if (id < 1n || id > 9223372036854775807n) {
    throw new KioskError("STAFF_INVALID_INPUT", "주문번호를 확인해주세요.", 400);
  }
  return id;
}

async function stored<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof KioskError) throw error;
    throw new KioskError("STAFF_STORAGE_UNAVAILABLE", "주문 저장소에 연결하지 못했습니다. 잠시 뒤 다시 시도해주세요.", 503);
  }
}

export async function listStaffOrders(status?: Status, before?: string) {
  const cursor = before === undefined ? undefined : orderId(before);
  return stored(async () => {
    const rows = await db.select(projection).from(orders).where(and(
      status ? eq(orders.fulfillmentStatus, status) : undefined,
      cursor === undefined ? undefined : lt(orders.orderNumber, cursor),
    )).orderBy(desc(orders.orderNumber)).limit(51);
    const page = rows.slice(0, 50);
    return ListStaffOrdersResponse.parse({
      orders: page.map(staffView),
      nextCursor: rows.length > 50 ? page.at(-1)!.orderNumber.toString() : null,
    });
  });
}

export async function updateStaffOrderStatus(orderNumber: string, status: "preparing" | "completed", expectedVersion: number, actorUserId: string) {
  const id = orderId(orderNumber);
  return stored(() => db.transaction(async (tx) => {
    // Recheck under a shared membership lock: revocation and an in-flight write serialize.
    const [member] = await tx.select({ active: staff.active }).from(staff)
      .where(and(eq(staff.userId, actorUserId), eq(staff.active, true))).for("share");
    if (!member) throw new KioskError("STAFF_FORBIDDEN", "직원 권한이 없습니다. 다시 로그인해주세요.", 403);
    const previous: Status = status === "preparing" ? "pending" : "preparing";
    const [updated] = await tx.update(orders).set({
      fulfillmentStatus: status, fulfillmentVersion: sql`${orders.fulfillmentVersion} + 1`,
      ...(status === "preparing" ? { preparationStartedAt: sql`clock_timestamp()` } : { fulfilledAt: sql`clock_timestamp()` }),
    }).where(and(eq(orders.orderNumber, id), eq(orders.fulfillmentStatus, previous), eq(orders.fulfillmentVersion, expectedVersion)))
      .returning(projection);
    if (!updated) {
      const [exists] = await tx.select({ orderNumber: orders.orderNumber }).from(orders).where(eq(orders.orderNumber, id));
      if (!exists) throw new KioskError("STAFF_ORDER_NOT_FOUND", "주문을 찾을 수 없습니다.", 404);
      throw new KioskError("STAFF_ORDER_CONFLICT", "다른 직원이 변경했거나 처리 순서가 맞지 않습니다. 목록을 새로고침해주세요.", 409);
    }
    await tx.insert(events).values({ orderNumber: id, actorUserId, fromStatus: previous, toStatus: status });
    return staffView(updated);
  }));
}
