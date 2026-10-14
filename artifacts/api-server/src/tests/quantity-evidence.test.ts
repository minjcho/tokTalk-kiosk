import { test } from "node:test";
import assert from "node:assert/strict";
import { requireQuantityEvidence } from "../services/quantityEvidence";
import type { SessionState } from "../services/sessionService";
import type { ParsedOrder } from "../services/orderTypes";

function createSession(): SessionState {
  return {
    id: "quantity-test", revision: 0, status: "active", items: [], lastActivity: 0,
    lastTranscript: null, clarification: null, history: [], busy: false,
    debug: { transcript: null, extractedJson: null, events: [] }, requests: new Map(),
  };
}
// These are pure parser-safety checks, not persistence tests.
const repository = { delete(_id: string) {} };

const parsed: ParsedOrder = {
  needsClarification: false, question: null, message: "추가", actions: [{
    type: "add", menuId: "cafe-latte", targetItemId: null, quantity: 1,
    temperature: null, size: null, addOptions: [], removeOptions: [],
  }],
};
test("unsaid quantity is vetoed even when the AI fabricates quantity=1", () => {
  const s = createSession();
  try {
    for (const text of ["아메리카노 주세요", "아메리카노 주셔유", "두유로 라떼 주세요", "아메리카노 추가해 주쇼"]) {
      const result = requireQuantityEvidence(parsed, text, s);
      assert.equal(result.needsClarification, true, text);
      assert.deepEqual(result.actions, []);
    }
  } finally { repository.delete(s.id); }
});
test("explicit counts and unresolved clarification keep evidence, not applied past turns", () => {
  const s = createSession();
  try {
    for (const text of ["뜨아 한잔 주이소", "아아 두 잔 주쇼", "라떼 하나", "둘이요", "세 잔이유", "3잔", "라떼 2 주세요"]) {
      assert.equal(requireQuantityEvidence(parsed, text, s), parsed, text);
    }
    s.history = [{ text: "두 잔 주세요", applied: false, question: "어떤 메뉴인가요?" }];
    s.clarification = "어떤 메뉴인가요?";
    assert.equal(requireQuantityEvidence(parsed, "아메리카노요", s), parsed);
    s.history[0]!.applied = true;
    assert.equal(requireQuantityEvidence(parsed, "아메리카노요", s).needsClarification, true);
    s.clarification = null;
    assert.equal(requireQuantityEvidence(parsed, "아메리카노요", s).needsClarification, true);
  } finally { repository.delete(s.id); }
});
test("one-cup shot instruction vetoes AI applying it to the entire group", () => {
  const s = createSession();
  try {
    const update: ParsedOrder = { ...parsed, actions: [{ ...parsed.actions[0]!, type: "update", addOptions: ["shot"], quantity: null }] };
    assert.equal(requireQuantityEvidence(update, "하나만 샷 추가해주세요", s).needsClarification, true);
    const correct: ParsedOrder = { ...update, actions: [{ ...update.actions[0]!, quantity: 1 }] };
    assert.equal(requireQuantityEvidence(correct, "하나만 샷 추가해주세요", s), correct);
  } finally { repository.delete(s.id); }
});
test("preference replies retain validated draft counts and conversation metadata, not new quantities", () => {
  const s = createSession();
  s.pendingOrder = [{ ...parsed.actions[0]!, quantity: 2 }];
  s.history = [{ text: "라지요", applied: false, question: "추가 변경은요?" }];
  s.clarification = "추가 변경은요?";
  const reply = { ...parsed, defaultsAccepted: false, customizationConfirmed: true,
    actions: [{ ...parsed.actions[0]!, quantity: 2, temperature: "ice" as const, size: "L" as const }] };
  assert.equal(requireQuantityEvidence(reply, "추가 없이요", s), reply);
  const inflated = { ...reply, actions: [{ ...reply.actions[0]!, quantity: 3 }] };
  const rejected = requireQuantityEvidence(inflated, "추가 없이요", s);
  assert.equal(rejected.needsClarification, true);
  assert.equal(rejected.customizationConfirmed, true);
  assert.deepEqual(rejected.actions, []);
  const newDrink = { ...reply, actions: [{ ...reply.actions[0]!, menuId: "americano" }] };
  assert.equal(requireQuantityEvidence(newDrink, "추가 없이요", s).needsClarification, true);
  const reduced = { ...reply, actions: [{ ...reply.actions[0]!, quantity: 1 }] };
  assert.equal(requireQuantityEvidence(reduced, "아이스요", s).needsClarification, true);
  // A previous counted utterance must not authorize dropping another pending menu.
  s.pendingOrder.push({ ...parsed.actions[0]!, menuId: "americano", quantity: 1 });
  s.history = [{ text: "라떼 두 잔과 아메리카노 한 잔", applied: false, question: "온도는요?" }];
  assert.equal(requireQuantityEvidence(reply, "아이스요", s).needsClarification, true);
  s.pendingOrder = undefined;
  s.history = [];
  assert.equal(requireQuantityEvidence(reply, "추가 없이요", s).needsClarification, true);
});
