/** Real AI multi-turn checks; consumes API usage. Deletes only sessions it creates. */
import assert from "node:assert/strict";
import type { OrderResult, SessionView } from "../services/orderTypes";

const base = `https://${process.env.REPLIT_DEV_DOMAIN}/api/kiosk`;
// Resume only failed/unrun live cases without repeating successful AI calls.
const scenarios = ["baseline", "alternating", "one-cup", "swap", "recovery"];
const from = process.argv.find((arg) => arg.startsWith("--from="))?.split("=")[1] ?? "baseline";
assert.ok(scenarios.includes(from), `Unknown scenario: ${from}`);
const run = (scenario: string) => scenarios.indexOf(scenario) >= scenarios.indexOf(from);
const ids: string[] = [];
async function request(path: string, method = "GET", body?: object) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined });
    if (response.status !== 429 || attempt >= 2) return response;
    // A 429 precedes AI/cart processing. Wait for the shared quota, never bypass it.
    const wait = Number(response.headers.get("Retry-After"));
    assert.ok(Number.isFinite(wait) && wait > 0 && wait <= 61);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000 + 100));
  }
}
async function create(): Promise<SessionView> {
  const response = await request("/sessions", "POST");
  assert.ok(response.ok);
  const state = await response.json() as SessionView;
  ids.push(state.id);
  return state;
}
async function say(state: SessionView, text: string, requestId = crypto.randomUUID()): Promise<OrderResult> {
  const response = await request(`/sessions/${state.id}/text`, "POST",
    { text, revision: state.revision, requestId });
  assert.ok(response.ok, `text HTTP ${response.status}`);
  const result = await response.json() as OrderResult;
  if (process.argv.includes("--trace")) console.log(JSON.stringify({ text, message: result.message, extractedJson: result.extractedJson }));
  return result;
}
async function seed(...items: { menuId: string; quantity: number; temperature: "ice" | "hot"; size: "M" | "L"; options: string[] }[]) {
  let state = await create();
  for (const item of items) {
    const response = await request(`/sessions/${state.id}/items`, "POST", { ...item, revision: state.revision });
    assert.ok(response.ok);
    state = await response.json() as SessionView;
  }
  return state;
}
function held(result: OrderResult, original: SessionView) {
  assert.equal(result.needsClarification, true, result.message);
  assert.deepEqual(result.session.items, original.items);
  assert.equal(result.session.revision, original.revision);
}
function cups(state: SessionView) {
  return state.items.map((i) => [i.menuId, i.quantity, i.temperature, i.size, i.options.map((o) => o.id).sort()].join(":")).sort();
}
try {
  if (run("baseline")) {
  const cappuccino = await say(await create(), "카푸치노 한 잔, 모두 기본으로 주세요");
  assert.equal(cappuccino.needsClarification, false, cappuccino.message);
  assert.equal(cappuccino.session.items[0]!.temperature, "hot");
  assert.equal(cappuccino.session.items[0]!.size, "M");
  console.log("PASS explicit defaults preserve menu-specific hot default");

  const multi = await say(await create(), "카페라떼 한 잔이랑 아메리카노 두 잔 주세요");
  assert.equal(multi.needsClarification, true);
  assert.equal(multi.session.itemCount, 0);
  const complete = await say(multi.session, "둘 다 아이스 레귤러로, 추가 없이 주세요");
  assert.equal(complete.needsClarification, false, complete.message);
  assert.equal(complete.session.itemCount, 3);
  assert.equal(complete.session.total, 11200);
  console.log("PASS multi-menu draft retains all items without double-add");

  const pending = await say(complete.session, "초코라떼 한 잔 더 주세요");
  assert.equal(pending.needsClarification, true);
  assert.equal(pending.session.itemCount, 3);
  const confirm = await request(`/sessions/${pending.session.id}/confirm`, "POST", { revision: pending.session.revision });
  assert.equal(confirm.status, 409);
  const rejected = await confirm.json();
  assert.ok(rejected && typeof rejected === "object" && "code" in rejected);
  assert.equal(rejected.code, "PREFERENCES_PENDING");
  console.log("PASS pending preferences preserve cart and block premature confirmation");

  const invalid = await say(await create(), "아이스 라지 초코라떼 한 잔에 샷 추가해주세요");
  assert.equal(invalid.needsClarification, true);
  assert.equal(invalid.session.itemCount, 0);
  console.log("PASS unavailable customization is not silently substituted");
  }

  if (run("alternating")) {
  const original = await seed({ menuId: "green-tea-latte", quantity: 1, temperature: "hot", size: "M", options: ["soy_milk"] });
  let mixed = await say(original, "카페라떼 한 잔과 아메리카노 한 잔 주세요");
  held(mixed, original);
  for (const text of ["아메리카노는 아이스로요", "카페라떼는 따뜻하게요", "아메리카노는 레귤러요", "카페라떼는 라지요"]) {
    mixed = await say(mixed.session, text);
    held(mixed, original);
  }
  const finalText = "카페라떼만 오트밀크로, 아메리카노는 추가 없이요";
  const finalState = mixed.session;
  const finalId = crypto.randomUUID();
  mixed = await say(finalState, finalText, finalId);
  assert.equal(mixed.needsClarification, false, mixed.message);
  assert.deepEqual(cups(mixed.session), [
    "americano:1:ice:M:", "cafe-latte:1:hot:L:oat_milk", "green-tea-latte:1:hot:M:soy_milk",
  ]);
  assert.equal(mixed.session.total, 14100);
  const replay = await say(finalState, finalText, finalId);
  assert.deepEqual(replay, mixed);
  console.log("PASS alternating per-menu replies preserve prior cart, temperatures, sizes and request replay");
  }

  if (run("one-cup")) {
  const oldLatte = await seed({ menuId: "cafe-latte", quantity: 1, temperature: "hot", size: "M", options: ["soy_milk"] });
  let oneCup = await say(oldLatte, "카페라떼 두 잔 더 주세요");
  held(oneCup, oldLatte);
  for (const text of [
    "새로 주문한 카페라떼 두 잔 중 한 잔만 샷 추가해주세요",
    "새로 주문한 카페라떼는 두 잔 말고 세 잔으로요",
    "새로 주문한 세 잔 모두 아이스로요",
  ]) {
    oneCup = await say(oneCup.session, text);
    held(oneCup, oldLatte);
  }
  oneCup = await say(oneCup.session, "새로 주문한 세 잔 모두 레귤러로요");
  assert.equal(oneCup.needsClarification, false, `${oneCup.message}\n${oneCup.extractedJson}`);
  assert.deepEqual(cups(oneCup.session), [
    "cafe-latte:1:hot:M:soy_milk", "cafe-latte:1:ice:M:shot", "cafe-latte:2:ice:M:",
  ]);
  assert.equal(oneCup.session.total, 17800);
  console.log("PASS one-cup customization and corrected draft quantity do not edit existing same-menu cups");
  }

  if (run("swap")) {
  const beforeSwap = await seed(
    { menuId: "americano", quantity: 2, temperature: "ice", size: "M", options: [] },
    { menuId: "green-tea-latte", quantity: 1, temperature: "hot", size: "L", options: [] },
  );
  let swap = await say(beforeSwap, "기존 아메리카노 한 잔 빼고 초코라떼 한 잔 추가해주세요");
  held(swap, beforeSwap);
  for (const text of ["따뜻하게요", "라지요"]) {
    swap = await say(swap.session, text);
    held(swap, beforeSwap);
  }
  swap = await say(swap.session, "추가 없이요");
  assert.equal(swap.needsClarification, false, swap.message);
  assert.deepEqual(cups(swap.session), ["americano:1:ice:M:", "choco-latte:1:hot:L:", "green-tea-latte:1:hot:L:"]);
  assert.equal(swap.session.total, 14100);
  console.log("PASS combined existing-item removal and new drink commit exactly once after short replies");
  }

  if (run("recovery")) {
  const beforeRecovery = await seed({ menuId: "americano", quantity: 1, temperature: "ice", size: "M", options: [] });
  let recovery = await say(beforeRecovery, "카페라떼 한 잔 추가해주세요");
  held(recovery, beforeRecovery);
  recovery = await say(recovery.session, "얼음 없이요");
  held(recovery, beforeRecovery);
  for (const text of ["그럼 따뜻하게요", "레귤러요"]) {
    recovery = await say(recovery.session, text);
    held(recovery, beforeRecovery);
  }
  recovery = await say(recovery.session, "추가 없이요");
  assert.equal(recovery.needsClarification, false, recovery.message);
  assert.deepEqual(cups(recovery.session), ["americano:1:ice:M:", "cafe-latte:1:hot:M:"]);
  console.log("PASS unsupported reply recovers without losing the draft or duplicating previous items");

  const waiting = await say(recovery.session, "초코라떼 한 잔 주세요");
  held(waiting, recovery.session);
  const cancelled = await say(waiting.session, "주문 전부 취소해주세요");
  assert.equal(cancelled.needsClarification, false, cancelled.message);
  assert.equal(cancelled.session.status, "cancelled");
  assert.deepEqual(cancelled.session.items, []);
  assert.equal(cancelled.session.lastTranscript, null);
  assert.equal((await request(`/sessions/${cancelled.session.id}`)).status, 410);
  const late = await request(`/sessions/${cancelled.session.id}/text`, "POST",
    { text: "아이스요", revision: cancelled.session.revision, requestId: crypto.randomUUID() });
  assert.equal(late.status, 410);
  console.log("PASS pending-order cancellation prevents late replies from resurrecting a draft");
  }
} finally {
  await Promise.all(ids.map((id) => request(`/sessions/${id}`, "DELETE")));
}
