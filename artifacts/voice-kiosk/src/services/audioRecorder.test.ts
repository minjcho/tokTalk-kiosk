/** Browser API simulation only; these tests do not certify a physical microphone. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { AudioRecorder, RecorderError } from './audioRecorder.ts';

class Track {
  readyState = 'live';
  onended: (() => void) | null = null;
  stop() { this.readyState = 'ended'; }
}
class Stream {
  track = new Track();
  getTracks() { return [this.track]; }
  getAudioTracks() { return [this.track]; }
}
class Context {
  static instances: Context[] = [];
  state = 'suspended';
  sampleRate = 24_000;
  destination = {};
  closed = false;
  resumed = false;
  processor = { onaudioprocess: null as any, connect() {}, disconnect() {} };
  constructor() { Context.instances.push(this); }
  async resume() { this.resumed = true; this.state = 'running'; }
  async close() { this.closed = true; this.state = 'closed'; }
  createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  createScriptProcessor() { return this.processor; }
  feed(amplitude: number, frames = 4096) {
    this.processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(frames).fill(amplitude) } });
  }
}
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
function setup(getUserMedia: () => Promise<Stream> = async () => new Stream(), secure = true) {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia } } });
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: { AudioContext: Context, isSecureContext: secure } });
  Context.instances = [];
}
afterEach(() => {
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator); else delete (globalThis as any).navigator;
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else delete (globalThis as any).window;
});
const code = (expected: string) => (e: unknown) => e instanceof RecorderError && e.code === expected;
test('quiet signal RMS .004 is preserved, WAV sample duration and cleanup', async () => {
  const stream = new Stream(); setup(async () => stream);
  const recorder = new AudioRecorder();
  await recorder.start();
  const ctx = Context.instances[0]!;
  for (let i = 0; i < 4; i++) ctx.feed(0.004);
  const result = await recorder.stop();
  assert.ok(result.durationMs >= 500);
  const wav = new DataView(await result.blob.arrayBuffer());
  assert.equal(wav.getUint32(24, true), 24_000);
  assert.equal(wav.getUint32(40, true), 4 * 4096 * 2);
  assert.ok(wav.getInt16(44, true) > 0);
  assert.equal(stream.track.readyState, 'ended');
  assert.equal(ctx.closed, true);
  assert.equal(recorder.active, false);
});
test('near-silence and too-short captured data rejected without wall-clock tricks', async () => {
  setup();
  for (const [amplitude, blocks, expected] of [[0, 4, 'no-speech'], [0.0005, 4, 'no-speech'], [0.05, 1, 'too-short']] as const) {
    const r = new AudioRecorder(); await r.start();
    for (let i = 0; i < blocks; i++) Context.instances.at(-1)!.feed(amplitude);
    await assert.rejects(r.stop(), code(expected));
    assert.equal(Context.instances.at(-1)!.closed, true);
  }
});
test('permission and device errors restore cleanup; retry can record', async () => {
  for (const [name, expected] of [['NotAllowedError', 'denied'], ['NotFoundError', 'no-device'], ['NotReadableError', 'device-busy']] as const) {
    setup(async () => { throw Object.assign(new Error(), { name }); });
    const r = new AudioRecorder();
    await assert.rejects(r.start(), code(expected));
    assert.equal(Context.instances.at(-1)!.closed, true);
    setup(); await r.start(); assert.equal(r.active, true); r.cancel();
  }
});
test('insecure context and unsupported browser never request a microphone', async () => {
  setup(async () => { assert.fail('must not request'); }, false);
  await assert.rejects(new AudioRecorder().start(), code('insecure'));
  (globalThis as any).window = { isSecureContext: true };
  await assert.rejects(new AudioRecorder().start(), code('unsupported'));
});
test('permission request timeout releases context and stops late grant', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let grant!: (s: Stream) => void;
  setup(() => new Promise((resolve) => { grant = resolve; }));
  const r = new AudioRecorder();
  const pending = assert.rejects(r.start(), code('permission-timeout'));
  t.mock.timers.tick(20_000); await pending;
  assert.equal(Context.instances[0]!.closed, true);
  const late = new Stream(); grant(late); await Promise.resolve();
  assert.equal(late.track.readyState, 'ended');
  assert.equal(r.active, false);
});
test('cancel during permission then retry; old grant cannot close new recorder', async () => {
  let grant!: (s: Stream) => void; let calls = 0;
  setup(() => ++calls === 1 ? new Promise((resolve) => { grant = resolve; }) : Promise.resolve(new Stream()));
  const r = new AudioRecorder();
  const pending = assert.rejects(r.start(), code('failed'));
  r.cancel(); await pending;
  await r.start();
  const late = new Stream(); grant(late); await Promise.resolve();
  assert.equal(late.track.readyState, 'ended');
  assert.equal(r.active, true);
  assert.equal(Context.instances[1]!.closed, false);
  r.cancel();
});
test('resume begins inside button gesture before delayed permission resolves', async () => {
  let grant!: (s: Stream) => void;
  setup(() => new Promise((resolve) => { grant = resolve; }));
  const r = new AudioRecorder(); const pending = r.start();
  assert.equal(Context.instances[0]!.resumed, true);
  grant(new Stream()); await pending; r.cancel();
});
test('45-second auto-stop cleans up even without UI callback', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const stream = new Stream(); setup(async () => stream);
  const r = new AudioRecorder(); await r.start();
  t.mock.timers.tick(45_000);
  assert.equal(r.active, false);
  assert.equal(stream.track.readyState, 'ended');
  assert.equal(Context.instances[0]!.closed, true);
});
test('capture cap protects against delayed timer; interrupted device does not submit', async () => {
  let stream: Stream; setup(async () => { stream = new Stream(); return stream; });
  const r = new AudioRecorder(); await r.start({ maxMs: 500 });
  for (let i = 0; i < 10; i++) Context.instances[0]!.feed(.004);
  const result = await r.stop();
  assert.equal(result.durationMs, 500);
  let interrupted = 0;
  await r.start({ onInterrupted: () => { interrupted++; } });
  stream!.track.onended?.();
  assert.equal(interrupted, 1);
  assert.equal(r.active, false);
});
