import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { OrderResult, OrderSession } from '@workspace/api-client-react';
import { menuVisibilityForResult } from './menuUiAction.ts';

const session: OrderSession = {
  id: 'current-customer', status: 'active', revision: 3, items: [], total: 0,
  itemCount: 0, expiresAt: '2099-01-01T00:00:00Z',
  lastTranscript: '아메리카노 두 잔', clarification: '온도를 알려주세요.',
};
function result(uiAction?: OrderResult['uiAction']): OrderResult {
  return {
    session: structuredClone(session), uiAction, transcript: '메뉴 닫아줘',
    needsClarification: true, message: session.clarification!, extractedJson: '{}',
  };
}

test('current screen commands and duplicate responses are idempotent without changing order context', () => {
  const before = structuredClone(session);
  for (const [action, visible] of [['show_menu', true], ['close_menu', false]] as const) {
    const r = result(action), snapshot = structuredClone(r);
    assert.equal(menuVisibilityForResult(r, session), visible);
    assert.equal(menuVisibilityForResult(r, session), visible);
    assert.deepEqual(r, snapshot);
  }
  assert.deepEqual(session, before);
  assert.equal(menuVisibilityForResult(result(), session), undefined, 'legacy order result is not a screen command');
});

test('old/new revisions, previous customer, closed sessions and reset cannot change menu visibility', () => {
  for (const action of ['show_menu', 'close_menu'] as const) {
    for (const patch of [
      { revision: 2 }, { revision: 4 }, { id: 'previous-customer' },
      { status: 'cancelled' as const }, { status: 'completed' as const },
    ]) {
      const r = result(action);
      Object.assign(r.session, patch);
      assert.equal(menuVisibilityForResult(r, session), undefined);
    }
    assert.equal(menuVisibilityForResult(result(action), null), undefined);
    assert.equal(menuVisibilityForResult(result(action), { ...session, status: 'cancelled' }), undefined);
  }
});
