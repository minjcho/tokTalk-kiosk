/** Opt-in real TTS -> short spoken answers -> STT -> draft completion.
 * Synthetic Korean speech, not physical-device or customer usability certification.
 * All audio stays in memory. Only this check's own session is deleted.
 */
import assert from "node:assert/strict";
import { getOpenAI } from "../services/openaiClient";
import { CreateSessionResponse, SubmitTextOrderResponse, SubmitVoiceOrderResponse } from "@workspace/api-zod";

const base = "http://localhost:80/api/kiosk";
async function request(path: string, body: object) {
  return fetch(`${base}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}
// Use a canonical PCM16 WAV, just like the browser recorder. Provider-streamed
// WAV headers may have unknown lengths and must not weaken our upload validation.
function pcmWav(pcm: Buffer) {
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24_000, 24); wav.writeUInt32LE(48_000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(pcm.length, 40); pcm.copy(wav, 44);
  return wav;
}
const created = await fetch(`${base}/sessions`, { method: "POST" });
assert.ok(created.ok, `Session HTTP ${created.status}`);
let session = CreateSessionResponse.parse(await created.json());
try {
  const first = await request(`/sessions/${session.id}/text`, {
    text: "카페라떼 한 잔 주세요", revision: session.revision, requestId: crypto.randomUUID(),
  });
  assert.ok(first.ok, `Initial order HTTP ${first.status}`);
  const result = SubmitTextOrderResponse.parse(await first.json());
  session = result.session;
  assert.ok(result.needsClarification);
  const steps = [
    { expected: "어떤 온도로", answer: "아이스요." },
    { expected: "어떤 크기로", answer: "레귤러요." },
    { expected: "추가하거나 변경", answer: "추가 없이 주세요." },
  ];
  for (const step of steps) {
    assert.ok(session.clarification?.includes(step.expected),
      `Expected ${step.expected}; got question=${session.clarification}, last synthetic transcript=${session.lastTranscript}`);
    assert.equal(session.itemCount, 0, "Unfinished draft must not be committed");
    const speech = await request(`/sessions/${session.id}/speech`, { revision: session.revision, question: session.clarification });
    assert.ok(speech.ok, `Question speech HTTP ${speech.status}`);
    assert.ok(speech.headers.get("content-type")?.startsWith("audio/mpeg"));
    assert.ok(speech.headers.get("cache-control")?.includes("no-store"));
    assert.ok((await speech.arrayBuffer()).byteLength > 1000);
    const answer = await getOpenAI().audio.speech.create({
      model: "gpt-4o-mini-tts", voice: "coral", input: step.answer,
      instructions: "자연스럽고 또렷한 한국어로 말해주세요.", response_format: "pcm",
    });
    const audioBase64 = pcmWav(Buffer.from(await answer.arrayBuffer())).toString("base64");
    const spoken = await request(`/sessions/${session.id}/voice`, {
      audioBase64, mimeType: "audio/wav", revision: session.revision, requestId: crypto.randomUUID(),
    });
    assert.ok(spoken.ok, `Short voice answer HTTP ${spoken.status}`);
    session = SubmitVoiceOrderResponse.parse(await spoken.json()).session;
    process.stdout.write(`PASS ${step.expected} 질문 TTS → 짧은 합성 음성 답변 → STT\n`);
  }
  assert.equal(session.clarification, null);
  assert.equal(session.itemCount, 1);
  assert.equal(session.items[0]?.menuId, "cafe-latte");
  assert.equal(session.items[0]?.temperature, "ice");
  assert.equal(session.items[0]?.size, "M");
  assert.deepEqual(session.items[0]?.options, []);
  process.stdout.write("PASS 라떼 1잔만 아이스·레귤러·추가 없이 담김; 파일 저장 없음\n");
} finally {
  await fetch(`${base}/sessions/${session.id}`, { method: "DELETE" });
}
