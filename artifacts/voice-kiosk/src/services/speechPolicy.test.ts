import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpeechAutoplayPolicy, recoveryGuide } from './speechPolicy.ts';

test('each guide is automatic once per session, not once per recording or revision', () => {
  const policy = new SpeechAutoplayPolicy();
  assert.equal(policy.claim('first', 'guide:welcome'), true);
  assert.equal(policy.claim('first', 'guide:welcome'), false);
  assert.equal(policy.claim('first', 'guide:no-speech'), true);
  assert.equal(policy.claim('first', 'question:0:1:온도'), true);
  assert.equal(policy.claim('first', 'guide:no-speech'), false);
  assert.equal(policy.claim('first', 'guide:mic-denied'), true);
  assert.equal(policy.claim('first', 'guide:no-speech'), false);
  assert.equal(policy.claim('next', 'guide:welcome'), true);
  assert.equal(policy.claim('next', 'guide:no-speech'), true);
});

test('failed/blocked/interrupted automatic attempts do not restart; fresh questions still read', () => {
  const policy = new SpeechAutoplayPolicy();
  for (const state of ['blocked', 'error', 'muted', 'recording']) {
    const key = `question:0:${state}:어떤 온도`;
    assert.equal(policy.claim('session', key), true);
    assert.equal(policy.claim('session', key), false);
  }
  assert.equal(policy.claim('session', 'question:0:next:어떤 크기'), true);
  assert.equal(policy.claim(undefined, 'guide:welcome'), false);
  assert.equal(policy.claim('new-session', 'guide:welcome'), true);
});

test('only selected recovery failures map to approved messages; TTS never recursively announces itself', () => {
  assert.equal(recoveryGuide('denied'), 'mic-denied');
  assert.equal(recoveryGuide('NO_SPEECH'), 'no-speech');
  assert.equal(recoveryGuide('no-speech'), 'no-speech');
  assert.equal(recoveryGuide('NO_AUDIO'), 'no-speech');
  assert.equal(recoveryGuide('too-short'), 'too-short');
  assert.equal(recoveryGuide('STT_FAILED'), 'recognition-failed');
  assert.equal(recoveryGuide('device-busy'), 'mic-unavailable');
  for (const code of [undefined, 'TTS_FAILED', 'RATE_LIMITED', 'SESSION_EXPIRED', 'AI_UNAVAILABLE', 'CUSTOM_ERROR', '임의 문장']) {
    assert.equal(recoveryGuide(code), null);
  }
});
