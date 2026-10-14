import { test } from "node:test";
import assert from "node:assert/strict";
import type { OpenAI } from "openai";
import { KioskError } from "../services/errors";
import { OpenAITranscriptionService } from "../services/transcriptionService";
import { validatePcmWav } from "../services/wavValidation";

function wav(seconds: number, amplitude = .004, signalSeconds = seconds, rate = 24_000, channels = 1) {
  const count = Math.round(seconds * rate), signal = Math.round(signalSeconds * rate);
  const b = Buffer.alloc(44 + count * channels * 2);
  b.write("RIFF", 0); b.writeUInt32LE(b.length - 8, 4); b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(channels, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * channels * 2, 28);
  b.writeUInt16LE(channels * 2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(count * channels * 2, 40);
  for (let i = 0; i < signal * channels; i++) b.writeInt16LE(Math.round(amplitude * 32767) * (i % 2 ? 1 : -1), 44 + i * 2);
  return b;
}
const code = (expected: string) => (e: unknown) => e instanceof KioskError && e.code === expected;
test("quiet signal and brief signal in long silence are not discarded", () => {
  assert.equal(validatePcmWav(wav(1, .004)).durationMs, 1000);
  assert.ok(validatePcmWav(wav(20, .004, .2)).signalMs >= 120);
  assert.equal(validatePcmWav(wav(1, .004, 1, 48_000, 2)).durationMs, 1000);
});
test("silence, isolated impulses and duration limits reject before provider call", () => {
  assert.throws(() => validatePcmWav(wav(1, 0)), code("NO_AUDIO"));
  assert.throws(() => validatePcmWav(wav(1, .0005)), code("NO_AUDIO"));
  assert.throws(() => validatePcmWav(wav(1, .1, .02)), code("NO_AUDIO"));
  assert.throws(() => validatePcmWav(wav(.2)), code("NO_AUDIO"));
  assert.throws(() => validatePcmWav(wav(45.1)), code("AUDIO_TOO_LARGE"));
});
test("malformed/truncated WAV and non-PCM16 refuse rather than misread samples", () => {
  const good = wav(1);
  const mutations = [
    (b: Buffer) => b.write("NOPE", 0),
    (b: Buffer) => b.write("XXXX", 8),
    (b: Buffer) => b.writeUInt16LE(3, 20),
    (b: Buffer) => b.writeUInt16LE(32, 34),
    (b: Buffer) => b.writeUInt32LE(0xffffffff, 40),
    (b: Buffer) => b.writeUInt32LE(0, 24),
    (b: Buffer) => b.writeUInt16LE(4, 32),
  ];
  for (const mutate of mutations) { const b = Buffer.from(good); mutate(b); assert.throws(() => validatePcmWav(b), code("AUDIO_FORMAT")); }
  assert.throws(() => validatePcmWav(good.subarray(0, -1)), code("AUDIO_FORMAT"));
});
test("silent or invalid WAV never calls STT; blank STT refuses", async () => {
  let calls = 0;
  const client = () => ({ audio: { transcriptions: { create: async () => { calls++; return { text: " " }; } } } }) as unknown as OpenAI;
  const service = new OpenAITranscriptionService(client);
  await assert.rejects(service.transcribe(wav(1, 0), "audio/wav"), code("NO_AUDIO"));
  await assert.rejects(service.transcribe(Buffer.alloc(2000), "audio/wav"), code("AUDIO_FORMAT"));
  assert.equal(calls, 0);
  await assert.rejects(service.transcribe(wav(1), "audio/wav"), code("NO_SPEECH"));
  assert.equal(calls, 1);
});
test("short-answer STT includes the current question as context, not a fabricated transcript", async () => {
  const question = "카페라떼에 추가하거나 변경할 것이 있나요?";
  const client = () => ({ audio: { transcriptions: { create: async (input: { prompt: string }) => {
    assert.ok(input.prompt.includes(question));
    assert.ok(input.prompt.includes("추가 없이 주세요"));
    assert.ok(input.prompt.includes("실제 들린 발화만"));
    return { text: "추가 없이 주세요." };
  } } } }) as unknown as OpenAI;
  const result = await new OpenAITranscriptionService(client).transcribe(wav(1), "audio/wav", question);
  assert.equal(result, "추가 없이 주세요.");
});
