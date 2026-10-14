/**
 * Real OpenAI contract checks. This explicitly consumes OpenAI API usage.
 * Run against the running app with pnpm --filter @workspace/api-server run test:ai.
 * No secrets, speech recordings or provider response objects are printed.
 */
import assert from "node:assert/strict";
import type { SessionView, OrderResult } from "../services/orderTypes";

const BASE = "http://localhost:80/api/kiosk";
type LiveSession = SessionView;
async function request<T = unknown>(path: string, method = "GET", body?: object): Promise<T> {
  const response = await fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = response.status === 204 ? null : await response.json();
  const message = data && typeof data === "object" && "error" in data ? String(data.error) : "요청 실패";
  assert.ok(response.ok, `HTTP ${response.status}: ${message}`);
  return data as T;
}
async function utterance(s: LiveSession, text: string): Promise<LiveSession> {
  let result = await request<OrderResult>(`/sessions/${s.id}/text`, "POST", { text, revision: s.revision, requestId: crypto.randomUUID() });
  if (result.needsClarification && /어떤 온도로|어떤 크기로|추가하거나 변경/.test(result.message)) {
    result = await request<OrderResult>(`/sessions/${s.id}/text`, "POST", {
      text: "말하지 않은 설정은 모두 기본으로 해주세요",
      revision: result.session.revision, requestId: crypto.randomUUID(),
    });
  }
  assert.equal(result.needsClarification, false, `${text}: ${result.message}`);
  return result.session;
}
const checks = [
  ["아아 두 잔 주세요", (s: LiveSession) => { assert.equal(s.itemCount, 2); assert.equal(s.items[0]!.menuId, "americano"); assert.equal(s.items[0]!.temperature, "ice"); }],
  ["뜨아 하나 주이소", (s: LiveSession) => { assert.equal(s.itemCount, 1); assert.equal(s.items[0]!.temperature, "hot"); }],
  ["카페라떼 한 잔이랑 아메리카노 두 잔", (s: LiveSession) => { assert.equal(s.itemCount, 3); assert.equal(s.items.find((i) => i.menuId === "americano")!.quantity, 2); assert.equal(s.items.find((i) => i.menuId === "cafe-latte")!.quantity, 1); }],
  ["라떼 두 잔 중에 하나는 샷 추가요", (s: LiveSession) => { assert.equal(s.itemCount, 2); assert.equal(s.items.filter((i) => i.options.some((o) => o.id === "shot")).reduce((n, i) => n + i.quantity, 0), 1); }],
] as const;
for (const [text, check] of checks) {
  let s = await request<LiveSession>("/sessions", "POST");
  try { s = await utterance(s, text); check(s); process.stdout.write(`PASS ${text}\n`); }
  finally { await request(`/sessions/${s.id}`, "DELETE"); }
}
let s = await request<LiveSession>("/sessions", "POST");
try {
  s = await utterance(s, "아메리카노 세 잔 주세요");
  s = await utterance(s, "아메리카노 하나 빼주세요");
  assert.equal(s.itemCount, 2);
  process.stdout.write("PASS 아메리카노 하나 빼주세요\n");
  s = await utterance(s, "아니 세 잔 말고 두 잔이요");
  assert.equal(s.itemCount, 2);
  process.stdout.write("PASS 아니 세 잔 말고 두 잔이요\n");
} finally { await request(`/sessions/${s.id}`, "DELETE"); }
s = await request<LiveSession>("/sessions", "POST");
try {
  s = await utterance(s, "아메리카노 두 잔 주세요");
  s = await utterance(s, "하나는 샷 추가해주세요");
  s = await utterance(s, "아니 두 잔 말고 세 잔이요");
  assert.equal(s.itemCount, 3);
  assert.equal(s.items.filter((i) => i.options.some((o) => o.id === "shot")).reduce((n, i) => n + i.quantity, 0), 1);
  process.stdout.write("PASS 여러 발화 문맥 및 한 잔 옵션 보존\n");
  const before = JSON.stringify(s.items);
  const unknown = await request<OrderResult>(`/sessions/${s.id}/text`, "POST", { text: "딸기 주스 한 잔", revision: s.revision, requestId: crypto.randomUUID() });
  assert.equal(unknown.needsClarification, true);
  assert.equal(JSON.stringify(unknown.session.items), before);
  process.stdout.write("PASS 없는 메뉴는 확인 요청, 장바구니 유지\n");
} finally { await request(`/sessions/${s.id}`, "DELETE"); }
