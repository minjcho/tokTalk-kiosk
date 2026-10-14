import { after, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { makeItem } from "../services/cartService";
import { orderParser } from "../services/orderParser";
import { ConversationOrderSchema, type OrderAction, type OrderResult, type SessionView } from "../services/orderTypes";
import { requireQuantityEvidence } from "../services/quantityEvidence";
import { createSession, getSession, repository, sessionView, withSessionLock, type SessionState } from "../services/sessionService";
import { kioskRequest } from "./helpers/kiosk-request";

const ids: string[] = [];
after(async () => {
  try { await Promise.all(ids.map((id) => repository.delete(id))); }
  finally { await pool.end(); }
});
function action(type: OrderAction["type"], values: Partial<OrderAction> = {}): OrderAction {
  return { type, menuId: null, targetItemId: null, quantity: null, temperature: null,
    size: null, addOptions: [], removeOptions: [], ...values };
}
const add = (menuId: string, quantity = 1, values: Partial<OrderAction> = {}) => action("add", { menuId, quantity, ...values });
function extraction(actions: OrderAction[], values: Partial<ReturnType<typeof ConversationOrderSchema.parse>> = {}) {
  return ConversationOrderSchema.parse({
    actions, needsClarification: false, question: null, message: "확인했습니다.",
    defaultsAccepted: false, customizationConfirmed: false, ...values,
  });
}
async function conversation(t: TestContext, items: SessionState["items"] = []) {
  const session = await createSession();
  ids.push(session.id);
  if (items.length) await withSessionLock(session, 0, () => { session.items = items; });
  // Stub only AI extraction. Real routes, quantity veto, locks, service,
  // repository serialization and request replay run for every turn.
  let next = extraction([]);
  const parser = t.mock.method(orderParser, "parse", async (text: string, state: SessionState) =>
    requireQuantityEvidence(structuredClone(next), text, state));
  let state = sessionView(session);
  async function say(text: string, parsed: typeof next) {
    next = parsed;
    const request = { text, revision: state.revision, requestId: randomUUID() };
    const response = await kioskRequest<OrderResult>(`preference-${session.id}`, "POST",
      `/kiosk/sessions/${session.id}/text`, request);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    state = response.body.session;
    // Reload from PostgreSQL, not the in-process object.
    const stored = await getSession(session.id).catch(() => undefined);
    if (state.status === "active") assert.deepEqual(sessionView(stored!), state);
    return { ...response.body, request };
  }
  async function unchanged(result: OrderResult, original = items) {
    assert.equal(result.needsClarification, true);
    assert.deepEqual(result.session.items, original);
    assert.equal(result.session.revision, 0);
    const rejected = await kioskRequest<{ code: string }>(`preference-${session.id}`, "POST",
      `/kiosk/sessions/${session.id}/confirm`, { revision: result.session.revision });
    assert.equal(rejected.status, 409);
    assert.equal(rejected.body.code, "PREFERENCES_PENDING");
  }
  return { say, unchanged, parser, get state() { return state; } };
}

test("alternating menu-specific temperature and size replies preserve the existing cart and commit once", async (t) => {
  const existing = [makeItem("green-tea-latte", 1, "hot", "M", ["soy_milk"])];
  const c = await conversation(t, existing);
  await c.unchanged(await c.say("라떼 한 잔과 아메리카노 한 잔 주세요", extraction([add("cafe-latte"), add("americano")])));
  const turns: [string, OrderAction, RegExp][] = [
    ["아메리카노는 아이스로요", action("update", { menuId: "americano", temperature: "ice" }), /카페라떼.*온도/],
    ["라떼는 따뜻하게요", action("update", { menuId: "cafe-latte", temperature: "hot" }), /카페라떼.*크기/],
    ["아메리카노는 레귤러요", action("update", { menuId: "americano", size: "M" }), /카페라떼.*크기/],
    ["라지요", action("update", { size: "L" }), /추가하거나 변경/],
  ];
  for (const [text, change, question] of turns) {
    const result = await c.say(text, extraction([change]));
    await c.unchanged(result);
    assert.match(result.message, question);
  }
  const completed = await c.say("라떼만 오트밀크로요", extraction([
    action("update", { menuId: "cafe-latte", addOptions: ["oat_milk"] }),
  ], { customizationConfirmed: true }));
  assert.equal(completed.needsClarification, false);
  assert.equal(completed.session.itemCount, 3);
  assert.equal(completed.session.total, 14100);
  assert.deepEqual(completed.session.items.find((i) => i.menuId === "green-tea-latte"), existing[0]);
  const latte = completed.session.items.find((i) => i.menuId === "cafe-latte")!;
  assert.deepEqual([latte.temperature, latte.size, latte.quantity, latte.options.map((o) => o.id)], ["hot", "L", 1, ["oat_milk"]]);
  const americano = completed.session.items.find((i) => i.menuId === "americano")!;
  assert.deepEqual([americano.temperature, americano.size, americano.options], ["ice", "M", []]);
  assert.equal(completed.session.revision, 1);
  const count = c.parser.mock.callCount();
  const replay = await kioskRequest<OrderResult>(`preference-${completed.session.id}`, "POST",
    `/kiosk/sessions/${completed.session.id}/text`, completed.request);
  assert.equal(replay.status, 200);
  const { request: _, ...original } = completed;
  assert.deepEqual(replay.body, original);
  assert.equal(c.parser.mock.callCount(), count);
  assert.equal((await getSession(completed.session.id)).pendingOrder, undefined);
});

test("one-cup option and quantity correction during questions preserve null preferences and existing same-menu cups", async (t) => {
  const existing = [makeItem("cafe-latte", 1, "hot", "M", ["soy_milk"])];
  const c = await conversation(t, existing);
  await c.unchanged(await c.say("라떼 두 잔 중 하나만 샷 추가", extraction([
    add("cafe-latte", 2), action("update", { menuId: "cafe-latte", quantity: 1, addOptions: ["shot"] }),
  ], { customizationConfirmed: true })));
  const corrected = await c.say("두 잔 말고 세 잔이요", extraction([
    action("set_quantity", { menuId: "cafe-latte", quantity: 3 }),
  ]));
  await c.unchanged(corrected);
  const pending = (await getSession(c.state.id)).pendingOrder!;
  assert.equal(pending.reduce((n, a) => n + a.quantity!, 0), 3);
  assert.equal(pending.find((a) => a.addOptions.includes("shot"))!.quantity, 1);
  assert.ok(pending.every((a) => a.temperature === null && a.size === null));
  const temperature = await c.say("전부 아이스요", extraction([
    action("update", { menuId: "cafe-latte", temperature: "ice", quantity: 3 }),
  ]));
  await c.unchanged(temperature);
  const complete = await c.say("레귤러요", extraction([
    action("update", { menuId: "cafe-latte", size: "M" }),
  ]));
  assert.equal(complete.needsClarification, false, complete.message);
  assert.equal(complete.session.itemCount, 4);
  assert.deepEqual(complete.session.items.find((i) => i.id === existing[0]!.id), existing[0]);
  assert.equal(complete.session.items.find((i) => i.options.some((o) => o.id === "shot"))!.quantity, 1);
  assert.equal(complete.session.total, 17800);
});

for (const snapshot of [false, true]) {
  test(`combined removal and addition followed by short replies is atomic (${snapshot ? "snapshot" : "delta"})`, async (t) => {
    const existing = [makeItem("americano", 2, "ice", "M", []), makeItem("green-tea-latte", 1, "hot", "L", [])];
    const c = await conversation(t, existing);
    const remove = action("remove", { menuId: "americano", targetItemId: existing[0]!.id, quantity: 1 });
    await c.unchanged(await c.say("아메리카노 한 잔 빼고 초코라떼 한 잔 주세요", extraction([
      remove, add("choco-latte", 1, { targetItemId: "/" }),
    ])));
    assert.equal((await getSession(c.state.id)).pendingOrder!.find((a) => a.type === "add")!.targetItemId, null);
    const hot = await c.say("따뜻하게요", extraction(snapshot
      ? [add("choco-latte", 1, { temperature: "hot" })]
      : [remove, action("update", { temperature: "hot" })], { customizationConfirmed: true }));
    await c.unchanged(hot);
    const size = await c.say("라지요", extraction(snapshot
      ? [add("choco-latte", 1, { size: "L" })]
      : [remove, action("update", { size: "L" })], { customizationConfirmed: true }));
    await c.unchanged(size);
    const complete = await c.say("추가 없이요", extraction([], { customizationConfirmed: true }));
    assert.equal(complete.needsClarification, false, complete.message);
    assert.equal(complete.session.itemCount, 3);
    assert.equal(complete.session.total, 14100);
    assert.equal(complete.session.items.find((i) => i.menuId === "americano")!.quantity, 1);
    assert.deepEqual(complete.session.items.find((i) => i.menuId === "green-tea-latte"), existing[1]);
    const choco = complete.session.items.find((i) => i.menuId === "choco-latte")!;
    assert.deepEqual([choco.temperature, choco.size, choco.quantity], ["hot", "L", 1]);
  });
}

test("invalid and ambiguous replies keep the draft and cart recoverable", async (t) => {
  const existing = [makeItem("americano", 1, "ice", "M", [])];
  const c = await conversation(t, existing);
  await c.unchanged(await c.say("초코라떼 한 잔 주세요", extraction([add("choco-latte")])));
  const original = (await getSession(c.state.id)).pendingOrder;
  const bad = await c.say("샷 추가요", extraction([
    action("update", { menuId: "choco-latte", addOptions: ["shot"] }),
  ], { customizationConfirmed: true }));
  await c.unchanged(bad);
  assert.match(bad.message, /선택할 수 없는 옵션/);
  assert.deepEqual((await getSession(c.state.id)).pendingOrder, original);
  const substituted = await c.say("얼음 없이요", extraction([
    action("update", { menuId: "choco-latte", addOptions: ["less_ice"] }),
  ], { customizationConfirmed: true }));
  await c.unchanged(substituted);
  assert.match(substituted.message, /얼음 없음은 지원하지/);
  assert.deepEqual((await getSession(c.state.id)).pendingOrder, original);
  const unclear = await c.say("네", extraction([], { needsClarification: true, question: "아이스와 따뜻하게 중 골라주세요." }));
  await c.unchanged(unclear);
  assert.deepEqual((await getSession(c.state.id)).pendingOrder, original);
  await c.unchanged(await c.say("따뜻하게요", extraction([action("update", { temperature: "hot" })])));
  const complete = await c.say("나머지는 기본으로요", extraction([], { defaultsAccepted: true }));
  assert.equal(complete.needsClarification, false, complete.message);
  assert.equal(complete.session.itemCount, 2);
  assert.deepEqual(complete.session.items.find((i) => i.menuId === "americano"), existing[0]);
  assert.deepEqual(complete.session.items.find((i) => i.menuId === "choco-latte")!.options, []);
});

test("ambiguous one-cup reply and incomplete snapshots cannot drop a pending menu", async (t) => {
  const c = await conversation(t);
  await c.unchanged(await c.say("라떼 한 잔과 아메리카노 한 잔 주세요", extraction([add("cafe-latte"), add("americano")])));
  const original = (await getSession(c.state.id)).pendingOrder;
  const ambiguous = await c.say("한 잔만 샷 추가요", extraction([
    action("update", { quantity: 1, addOptions: ["shot"] }),
  ], { customizationConfirmed: true }));
  await c.unchanged(ambiguous);
  assert.match(ambiguous.message, /어떤 음료/);
  assert.deepEqual((await getSession(c.state.id)).pendingOrder, original);
  const incomplete = await c.say("아이스요", extraction([
    add("cafe-latte", 1, { temperature: "ice" }),
  ]));
  await c.unchanged(incomplete);
  assert.deepEqual((await getSession(c.state.id)).pendingOrder, original);
  const complete = await c.say("라떼만 샷 추가하고 둘 다 기본으로요", extraction([
    action("update", { menuId: "cafe-latte", quantity: 1, addOptions: ["shot"] }),
  ], { customizationConfirmed: true, defaultsAccepted: true }));
  assert.equal(complete.needsClarification, false);
  assert.equal(complete.session.itemCount, 2);
  assert.equal(complete.session.items.find((i) => i.menuId === "cafe-latte")!.options[0]!.id, "shot");
  assert.deepEqual(complete.session.items.find((i) => i.menuId === "americano")!.options, []);
});

test("an AI snapshot cannot spread an already chosen one-cup option during a temperature reply", async (t) => {
  const c = await conversation(t);
  await c.unchanged(await c.say("라떼 두 잔 중 한 잔만 샷 추가", extraction([
    add("cafe-latte", 1), add("cafe-latte", 1, { addOptions: ["shot"] }),
  ], { customizationConfirmed: true })));
  const before = (await getSession(c.state.id)).pendingOrder;
  const corrupt = await c.say("둘 다 아이스로요", extraction([
    add("cafe-latte", 2, { temperature: "ice", addOptions: ["shot"] }),
  ], { customizationConfirmed: true }));
  await c.unchanged(corrupt);
  assert.match(corrupt.message, /잔별 옵션/);
  assert.deepEqual((await getSession(c.state.id)).pendingOrder, before);
  await c.unchanged(await c.say("둘 다 아이스로요", extraction([
    action("update", { menuId: "cafe-latte", temperature: "ice" }),
  ])));
  const complete = await c.say("레귤러요", extraction([
    action("update", { menuId: "cafe-latte", size: "M" }),
  ]));
  assert.equal(complete.needsClarification, false);
  assert.equal(complete.session.itemCount, 2);
  assert.equal(complete.session.items.find((i) => i.options.length)!.quantity, 1);
});

test("cancelling a pending order erases cart, draft, context and retries without adding cups", async (t) => {
  const c = await conversation(t, [makeItem("americano", 1, "ice", "M", [])]);
  await c.unchanged(await c.say("라떼 한 잔 주세요", extraction([add("cafe-latte")])));
  const cancelled = await c.say("주문 전부 취소해주세요", extraction([action("cancel")]));
  assert.equal(cancelled.needsClarification, false);
  assert.equal(cancelled.session.status, "cancelled");
  assert.equal(cancelled.session.itemCount, 0);
  assert.equal(cancelled.session.lastTranscript, null);
  assert.equal(cancelled.session.clarification, null);
  assert.equal(await repository.find(cancelled.session.id), undefined);
  const late = await kioskRequest<{ code: string }>(`preference-${cancelled.session.id}`, "POST",
    `/kiosk/sessions/${cancelled.session.id}/text`, { text: "아이스요", revision: 0, requestId: randomUUID() });
  assert.equal(late.status, 410);
  assert.equal(late.body.code, "SESSION_EXPIRED");
});
