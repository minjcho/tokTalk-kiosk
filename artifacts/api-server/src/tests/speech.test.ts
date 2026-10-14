import { after, test } from "node:test";
import assert from "node:assert/strict";
import type OpenAI from "openai";
import { pool } from "@workspace/db";
import { repository, type SessionState } from "../services/sessionService";
import { rateLimiter, RateLimitError } from "../services/rateLimitService";
import { OpenAISpeechService, speechService } from "../services/speechService";
import { KioskError } from "../services/errors";
import { kioskRequest } from "./helpers/kiosk-request";
import { GUIDANCE_TEXT } from "../services/guidanceService";

const question = "카페라떼는 어떤 온도로 드릴까요? 아이스 또는 따뜻하게 중에서 골라주세요.";
const path = "/kiosk/sessions/test-speech/speech";
const input = { question, revision: 0 };
function session(): SessionState {
  return {
    id: "test-speech", revision: 0, status: "active", items: [], clarification: question,
    lastTranscript: null, lastActivity: Date.now(), history: [], requests: new Map(), busy: false,
    debug: { transcript: null, extractedJson: null, events: [] },
  };
}
after(async () => { await pool.end(); });

test("TTS adapter sends exact Korean question and abort signal; returns transient MP3", async () => {
  const controller = new AbortController();
  const service = new OpenAISpeechService(() => ({
    audio: { speech: { create: async (body: any, options: any) => {
      assert.equal(body.input, question);
      assert.equal(body.model, "gpt-4o-mini-tts");
      assert.equal(body.response_format, "mp3");
      assert.equal(body.speed, 1);
      assert.equal(options.signal, controller.signal);
      assert.equal(options.maxRetries, 0);
      assert.equal(options.timeout, 20_000);
      return new Response(new Uint8Array([1, 2, 3]));
    } } },
  }) as unknown as OpenAI);
  assert.deepEqual(await service.synthesize(question, controller.signal), Buffer.from([1, 2, 3]));
  const empty = new OpenAISpeechService(() => ({
    audio: { speech: { create: async () => new Response() } },
  }) as unknown as OpenAI);
  await assert.rejects(empty.synthesize(question, controller.signal), (e: unknown) => e instanceof KioskError && e.code === "TTS_FAILED");
});

test("speech route reads server clarification, never touches the cart or stores audio", async (t) => {
  const current = session(), before = structuredClone(current);
  t.mock.method(repository, "find", async () => current);
  const limit = t.mock.method(rateLimiter, "consume", async () => {});
  const audio = Buffer.from("test-only-mp3");
  const synth = t.mock.method(speechService, "synthesize", async (text: string, signal: AbortSignal, speed: string | undefined) => {
    assert.equal(text, current.clarification);
    assert.equal(signal.aborted, false);
    assert.equal(speed, "normal", "existing clients default to normal speed");
    return audio;
  });
  const result = await kioskRequest("test-peer", "POST", path, input);
  assert.equal(result.status, 200);
  assert.equal(result.headers["content-type"], "audio/mpeg");
  assert.equal(result.headers["cache-control"], "no-store, private");
  assert.deepEqual(result.body, audio);
  assert.deepEqual(current, before);
  assert.equal(synth.mock.callCount(), 1);
  assert.equal(limit.mock.callCount(), 1);
});

test("arbitrary text, stale revision, missing question, busy/closed/expired session never call TTS", async (t) => {
  let current: SessionState | undefined = session();
  t.mock.method(repository, "find", async () => current);
  const synth = t.mock.method(speechService, "synthesize", async () => Buffer.alloc(1));
  const limit = t.mock.method(rateLimiter, "consume", async () => {});
  for (const [body, status] of [
    [{ ...input, question: "사용자가 지정한 아무 말" }, 409],
    [{ ...input, revision: 1 }, 409],
    [{ ...input, question: "" }, 400],
    [{ ...input, question: "a".repeat(2001) }, 400],
    [{ question }, 400],
  ] as const) assert.equal((await kioskRequest("test", "POST", path, body)).status, status);
  current.busy = true;
  assert.equal((await kioskRequest("test", "POST", path, input)).status, 409);
  current.busy = false; current.clarification = null;
  assert.equal((await kioskRequest("test", "POST", path, input)).status, 409);
  current.status = "completed";
  assert.equal((await kioskRequest("test", "POST", path, input)).status, 409);
  current = undefined;
  assert.equal((await kioskRequest("test", "POST", path, input)).status, 410);
  assert.equal(synth.mock.callCount(), 0);
  assert.equal(limit.mock.callCount(), 0);
});

test("changed question (even same revision) and cancelled session discard completed speech", async (t) => {
  let current: SessionState | undefined;
  t.mock.method(repository, "find", async () => current);
  t.mock.method(rateLimiter, "consume", async () => {});
  for (const kind of ["change", "cancel"]) {
    current = session();
    const synth = t.mock.method(speechService, "synthesize", async () => {
      if (kind === "change") current!.clarification = "어떤 크기로 드릴까요?";
      else current = undefined;
      return Buffer.alloc(2);
    });
    const result = await kioskRequest("test", "POST", path, input);
    assert.equal(result.status, kind === "change" ? 409 : 410);
    assert.ok(!Buffer.isBuffer(result.body));
    synth.mock.restore();
  }
});

test("rate limit and provider errors fail safely, without speech bytes or raw provider errors", async (t) => {
  t.mock.method(repository, "find", async () => session());
  const synth = t.mock.method(speechService, "synthesize", async () => { throw new Error("private provider details"); });
  const limit = t.mock.method(rateLimiter, "consume", async () => { throw new RateLimitError(20); });
  const limited = await kioskRequest("test", "POST", path, input);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers["retry-after"], "20");
  assert.equal(synth.mock.callCount(), 0);
  limit.mock.restore();
  t.mock.method(rateLimiter, "consume", async () => {});
  const failed = await kioskRequest("test", "POST", path, input);
  assert.equal(failed.status, 502);
  assert.equal((failed.body as { code: string }).code, "TTS_FAILED");
  assert.ok(!JSON.stringify(failed.body).includes("private provider"));
});

const guidancePath = "/kiosk/sessions/test-speech/guidance-speech";
test("every allowed guide reads exactly the server Korean text and leaves session untouched", async (t) => {
  const current = session();
  current.clarification = null;
  const before = structuredClone(current);
  t.mock.method(repository, "find", async () => current);
  const limit = t.mock.method(rateLimiter, "consume", async () => {});
  const synth = t.mock.method(speechService, "synthesize", async () => Buffer.from("transient-mp3"));
  for (const [guide, text] of Object.entries(GUIDANCE_TEXT)) {
    const result = await kioskRequest("peer", "POST", guidancePath, { guide, revision: 0 });
    assert.equal(result.status, 200);
    assert.equal(result.headers["content-type"], "audio/mpeg");
    assert.equal(result.headers["cache-control"], "no-store, private");
    assert.equal(result.headers["x-content-type-options"], "nosniff");
    const call = synth.mock.calls.at(-1)!;
    assert.equal(call.arguments[0], text);
    assert.match(text, /[가-힣]/);
    assert.equal((call.arguments[1] as AbortSignal).aborted, false);
    assert.deepEqual(current, before, "no audio, activities, history or cart changes saved");
  }
  assert.equal(synth.mock.callCount(), Object.keys(GUIDANCE_TEXT).length);
  assert.equal(limit.mock.callCount(), Object.keys(GUIDANCE_TEXT).length);
});

test("guidance rejects arbitrary text, extra fields, unknown codes and invalid session states before TTS", async (t) => {
  let current: SessionState | undefined = session();
  current.clarification = null;
  t.mock.method(repository, "find", async () => current);
  const synth = t.mock.method(speechService, "synthesize", async () => Buffer.alloc(1));
  const limit = t.mock.method(rateLimiter, "consume", async () => {});
  for (const body of [
    { guide: "임의 문장", revision: 0 }, { guide: "TTS_FAILED", revision: 0 },
    { guide: "welcome", revision: 0, text: "임의 문장" },
    { guide: "welcome", revision: 0, question }, { guide: "welcome" },
    { guide: "welcome", revision: -1 }, { guide: "welcome", revision: "0" },
  ]) assert.equal((await kioskRequest("peer", "POST", guidancePath, body)).status, 400);
  const input = { guide: "welcome", revision: 0 };
  assert.equal((await kioskRequest("peer", "POST", guidancePath, { ...input, revision: 1 })).status, 409);
  current.busy = true;
  assert.equal((await kioskRequest("peer", "POST", guidancePath, input)).status, 409);
  current.busy = false; current.clarification = question;
  assert.equal((await kioskRequest("peer", "POST", guidancePath, input)).status, 409);
  current.clarification = null; current.status = "completed";
  assert.equal((await kioskRequest("peer", "POST", guidancePath, input)).status, 409);
  current = undefined;
  assert.equal((await kioskRequest("peer", "POST", guidancePath, input)).status, 410);
  assert.equal(synth.mock.callCount(), 0);
  assert.equal(limit.mock.callCount(), 0);
});

test("changed revision, welcome becoming obsolete, closed and cancelled sessions discard late guidance", async (t) => {
  let current: SessionState | undefined;
  t.mock.method(repository, "find", async () => current);
  t.mock.method(rateLimiter, "consume", async () => {});
  for (const kind of ["revision", "question", "closed", "cancel"]) {
    current = session(); current.clarification = null;
    const synth = t.mock.method(speechService, "synthesize", async () => {
      if (kind === "revision") current!.revision++;
      else if (kind === "question") current!.clarification = question;
      else if (kind === "closed") current!.status = "completed";
      else current = undefined;
      return Buffer.alloc(2);
    });
    const result = await kioskRequest("peer", "POST", guidancePath, { guide: "welcome", revision: 0 });
    assert.equal(result.status, kind === "cancel" ? 410 : 409);
    assert.ok(!Buffer.isBuffer(result.body));
    synth.mock.restore();
  }
});

test("guidance quota and provider failures do not leak details or return audio", async (t) => {
  t.mock.method(repository, "find", async () => session());
  const synth = t.mock.method(speechService, "synthesize", async () => { throw new Error("private provider details"); });
  const limit = t.mock.method(rateLimiter, "consume", async () => { throw new RateLimitError(15); });
  const input = { guide: "recognition-failed", revision: 0 };
  const limited = await kioskRequest("peer", "POST", guidancePath, input);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers["retry-after"], "15");
  assert.equal(synth.mock.callCount(), 0);
  limit.mock.restore();
  t.mock.method(rateLimiter, "consume", async () => {});
  const failed = await kioskRequest("peer", "POST", guidancePath, input);
  assert.equal(failed.status, 502);
  assert.equal((failed.body as { code: string }).code, "TTS_FAILED");
  assert.ok(!JSON.stringify(failed.body).includes("private provider"));
});

test("TTS adapter maps only allowed reading paces to provider speeds", async () => {
  const speeds: number[] = [];
  const service = new OpenAISpeechService(() => ({
    audio: { speech: { create: async (body: any) => {
      speeds.push(body.speed);
      assert.equal(body.input, question);
      return new Response(new Uint8Array([1, 2, 3]));
    } } },
  }) as unknown as OpenAI);
  const signal = new AbortController().signal;
  await service.synthesize(question, signal, "slow");
  await service.synthesize(question, signal, "normal");
  assert.deepEqual(speeds, [0.8, 1]);
  for (const speed of ["fast", "", 0.8, null, "toString"]) {
    await assert.rejects(service.synthesize(question, signal, speed as any),
      (e: unknown) => e instanceof KioskError && e.code === "INVALID_INPUT");
  }
  assert.equal(speeds.length, 2, "invalid speeds cannot reach the provider");
});


test("speech route accepts slow and normal, rejects arbitrary speeds before quota and synthesis", async (t) => {
  const current = session(), before = structuredClone(current);
  t.mock.method(repository, "find", async () => current);
  const limit = t.mock.method(rateLimiter, "consume", async () => {});
  const speeds: string[] = [];
  t.mock.method(speechService, "synthesize", async (_text: string, _signal: AbortSignal, speed: string) => {
    speeds.push(speed);
    return Buffer.alloc(2);
  });
  for (const speed of ["slow", "normal"]) {
    const result = await kioskRequest("test", "POST", path, { ...input, speed });
    assert.equal(result.status, 200);
    assert.equal(result.headers["cache-control"], "no-store, private");
  }
  for (const speed of ["fast", "", 0.8, 1, null, {}, "toString"]) {
    assert.equal((await kioskRequest("test", "POST", path, { ...input, speed })).status, 400);
  }
  assert.deepEqual(speeds, ["slow", "normal"]);
  assert.equal(limit.mock.callCount(), 2);
  assert.deepEqual(current, before);
});
