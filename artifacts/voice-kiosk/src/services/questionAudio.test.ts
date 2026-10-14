import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QuestionAudio, type SpeechState } from './questionAudio.ts';
import { SpeechAutoplayPolicy } from './speechPolicy.ts';

class FakeAudio {
  src = '';
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  paused = false;
  plays = 0;
  fail: string | null = null;
  play() { this.plays++; return this.fail ? Promise.reject(Object.assign(new Error(), { name: this.fail })) : Promise.resolve(); }
  pause() { this.paused = true; }
  removeAttribute() { this.src = ''; }
  load() {}
}
const blob = () => new Blob(['fake mp3'], { type: 'audio/mpeg' });
function setup() {
  const states: SpeechState[] = [], audios: FakeAudio[] = [], revoked: string[] = [];
  let failure: string | null = null;
  const player = new QuestionAudio((s) => states.push(s), {
    createAudio: () => { const audio = new FakeAudio(); audio.fail = failure; audios.push(audio); return audio as any; },
    createUrl: () => `blob:${audios.length}`,
    revokeUrl: (url) => revoked.push(url),
  });
  return { player, states, audios, revoked, fail: (name: string | null) => { failure = name; } };
}

test('question is read and replay uses only current in-memory audio; completion releases URLs', async () => {
  const s = setup(); let calls = 0;
  s.player.setQuestion(async () => { calls++; return blob(); });
  await s.player.play();
  assert.equal(s.states.at(-1), 'playing');
  s.audios[0]!.onended!();
  assert.equal(s.states.at(-1), 'done');
  assert.deepEqual(s.revoked, ['blob:1']);
  const replay = s.player.play();
  assert.equal(s.audios[1]!.plays, 1, 'cached replay calls play synchronously in click gesture');
  await replay;
  assert.equal(calls, 1);
  s.player.setQuestion(null);
  assert.equal(s.audios[1]!.paused, true);
  await s.player.play();
  assert.equal(s.audios.length, 2);
});

test('mic/mute/stop cancels pending request and late bytes can never play', async () => {
  for (const forget of [false, true]) {
    const s = setup(); let resolve!: (b: Blob) => void; let signal!: AbortSignal;
    s.player.setQuestion((value) => { signal = value; return new Promise((r) => { resolve = r; }); });
    const pending = s.player.play();
    s.player.stop(forget);
    assert.equal(signal.aborted, true);
    resolve(blob()); await pending;
    assert.equal(s.audios.length, 0);
    assert.equal(s.states.at(-1), 'idle');
  }
});

test('new question, reset and session expiry discard old audio even if fetch ignores abort', async () => {
  const s = setup(); let resolve!: (b: Blob) => void;
  s.player.setQuestion(() => new Promise((r) => { resolve = r; }));
  const old = s.player.play();
  s.player.setQuestion(async () => blob());
  await s.player.play();
  resolve(blob()); await old;
  assert.equal(s.audios.length, 1);
  assert.equal(s.states.at(-1), 'playing');
  const oldEnd = s.audios[0]!.onended!;
  s.player.setQuestion(null);
  oldEnd();
  assert.equal(s.states.at(-1), 'idle');
  assert.equal(s.audios[0]!.paused, true);
  assert.equal(s.audios[0]!.src, '');
});

test('autoplay rejection offers gesture replay without another provider call', async () => {
  const s = setup(); let calls = 0;
  s.fail('NotAllowedError');
  s.player.setQuestion(async () => { calls++; return blob(); });
  await s.player.play();
  assert.equal(s.states.at(-1), 'blocked');
  s.fail(null);
  const retry = s.player.play();
  assert.equal(s.audios[1]!.plays, 1);
  await retry;
  assert.equal(s.states.at(-1), 'playing');
  assert.equal(calls, 1);
  s.player.stop(true);
});

test('network and decode errors remain recoverable; touch order is not involved', async () => {
  const s = setup(); let calls = 0;
  s.player.setQuestion(async () => {
    if (++calls === 1) throw new Error('network');
    return blob();
  });
  await s.player.play();
  assert.equal(s.states.at(-1), 'error');
  await s.player.play();
  assert.equal(s.states.at(-1), 'playing');
  s.audios[0]!.onerror!();
  assert.equal(s.states.at(-1), 'error');
  await s.player.play();
  assert.equal(calls, 3);
  assert.equal(s.states.at(-1), 'playing');
  s.player.stop(true);
});

test('request deadline aborts hung TTS and invalidates late bytes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const s = setup(); let resolve!: (b: Blob) => void; let signal!: AbortSignal;
  s.player.setQuestion((v) => { signal = v; return new Promise((r) => { resolve = r; }); });
  const pending = s.player.play();
  t.mock.timers.tick(30_000);
  assert.equal(signal.aborted, true);
  assert.equal(s.states.at(-1), 'error');
  resolve(blob()); await pending;
  assert.equal(s.audios.length, 0);
});

test('welcome, recovery and question share one cancellable slot; repeated recovery is manual only', async () => {
  const s = setup(), policy = new SpeechAutoplayPolicy();
  let calls = 0;
  const load = async () => { calls++; return blob(); };
  s.player.setQuestion(load);
  if (policy.claim('session', 'guide:welcome')) await s.player.play();
  assert.equal(s.audios.length, 1);
  s.player.stop(); // microphone starts: welcome must stop immediately
  assert.equal(s.audios[0]!.paused, true);
  s.player.setQuestion(load); // first STT failure
  if (policy.claim('session', 'guide:no-speech')) await s.player.play();
  assert.equal(s.audios.length, 2);
  s.player.setQuestion(null); // next microphone recording forgets recovery bytes
  s.player.setQuestion(load); // same STT failure after another recording
  if (policy.claim('session', 'guide:no-speech')) await s.player.play();
  assert.equal(s.audios.length, 2);
  await s.player.play(); // user explicitly requests recovery replay
  assert.equal(s.audios.length, 3);
  s.player.setQuestion(load); // question replaces recovery; never two players
  assert.equal(s.audios[2]!.paused, true);
  await s.player.play();
  s.player.setQuestion(null); // new session/receipt drops last bytes and URL
  assert.equal(s.audios[3]!.paused, true);
  assert.equal(calls, 4);
  assert.equal(s.revoked.length, 4);
});

test('changing pace cancels playing audio and discards cached bytes, even when switching back', async () => {
  const s = setup();
  const speeds: string[] = [];
  s.player.setQuestion(async (_signal, speed) => { speeds.push(speed); return blob(); });
  await s.player.play();
  const oldEnd = s.audios[0]!.onended!;
  assert.equal(s.player.setSpeed('slow'), true);
  assert.equal(s.audios[0]!.paused, true);
  assert.equal(s.audios[0]!.src, '');
  assert.deepEqual(s.revoked, ['blob:1']);
  await s.player.play();
  oldEnd();
  assert.equal(s.states.at(-1), 'playing', 'late old events cannot stop the new pace');
  await s.player.play();
  assert.deepEqual(speeds, ['normal', 'slow'], 'only current-pace replay may reuse bytes');
  assert.equal(s.player.setSpeed('slow'), false, 'selecting current pace does not interrupt');
  assert.equal(s.states.at(-1), 'playing');
  s.player.setSpeed('normal');
  await s.player.play();
  assert.deepEqual(speeds, ['normal', 'slow', 'normal'], 'old normal bytes are not retained');
  s.player.stop(true);
});

test('rapid pace changes abort each request and only the latest pace can play late responses', async () => {
  const s = setup();
  const requests: { signal: AbortSignal; speed: string; resolve: (b: Blob) => void }[] = [];
  s.player.setQuestion((signal, speed) => new Promise((resolve) => { requests.push({ signal, speed, resolve }); }));
  const normal = s.player.play();
  s.player.setSpeed('slow');
  const slow = s.player.play();
  s.player.setSpeed('normal');
  const latest = s.player.play();
  assert.deepEqual(requests.map((r) => r.speed), ['normal', 'slow', 'normal']);
  assert.equal(requests[0]!.signal.aborted, true);
  assert.equal(requests[1]!.signal.aborted, true);
  requests[2]!.resolve(blob()); await latest;
  requests[1]!.resolve(blob()); await slow;
  requests[0]!.resolve(blob()); await normal;
  assert.equal(s.audios.length, 1);
  assert.equal(s.states.at(-1), 'playing');
  s.player.stop(true);
});

test('pace changes do not start playback themselves and never revive a cleared customer question', async () => {
  const s = setup(); let calls = 0;
  s.player.setQuestion(async () => { calls++; return blob(); });
  await s.player.play();
  s.player.stop(); // mute or microphone startup
  s.player.setSpeed('slow');
  assert.equal(calls, 1);
  assert.equal(s.states.at(-1), 'idle');
  s.player.setQuestion(null); // cancel, confirmation or expiry
  s.player.setSpeed('normal');
  await s.player.play();
  assert.equal(calls, 1);
  assert.equal(s.audios.length, 1);
  s.player.setQuestion(async () => { calls++; return blob(); });
  await s.player.play();
  assert.equal(calls, 2, 'same wording in a new session must fetch fresh audio');
  s.player.stop(true);
});

test('microphone/stop after a pace change aborts replacement speech and prevents late playback', async () => {
  const s = setup(); let resolve!: (b: Blob) => void; let signal!: AbortSignal;
  s.player.setSpeed('slow');
  s.player.setQuestion((value) => { signal = value; return new Promise((r) => { resolve = r; }); });
  const pending = s.player.play();
  s.player.stop();
  assert.equal(signal.aborted, true);
  resolve(blob()); await pending;
  assert.equal(s.audios.length, 0);
  assert.equal(s.states.at(-1), 'idle');
});
