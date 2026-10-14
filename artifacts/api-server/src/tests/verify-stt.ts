/** Real STT + order endpoint check using synthetic Korean speech, not a physical mic. */
import assert from "node:assert/strict";
import { getOpenAI } from "../services/openaiClient";
import { CreateSessionResponse, SubmitVoiceOrderResponse } from "@workspace/api-zod";

const base = "http://localhost:80/api/kiosk";
const created = await fetch(`${base}/sessions`, { method: "POST" });
assert.ok(created.ok);
const session = CreateSessionResponse.parse(await created.json());
try {
  // Bytes are kept only in memory and never written to logs or source control.
  const speech = await getOpenAI().audio.speech.create({
    model: "gpt-4o-mini-tts", voice: "coral", input: "아이스 아메리카노 두 잔 주세요. 나머지는 모두 기본으로 해주세요.",
    instructions: "자연스러운 한국어로 또렷하게 말해주세요.", response_format: "wav",
  });
  const audioBase64 = Buffer.from(await speech.arrayBuffer()).toString("base64");
  const response = await fetch(`${base}/sessions/${session.id}/voice`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audioBase64, mimeType: "audio/wav", revision: session.revision, requestId: crypto.randomUUID() }),
  });
  const body = await response.json();
  assert.ok(response.ok, "STT endpoint failed; check session-scoped debug events");
  const result = SubmitVoiceOrderResponse.parse(body);
  assert.equal(result.needsClarification, false, result.message);
  assert.equal(result.session.itemCount, 2);
  assert.equal(result.session.items[0]?.menuId, "americano");
  assert.equal(result.session.items[0]?.temperature, "ice");
  process.stdout.write(`PASS 합성 한국어 음성 → STT → AI → 아메리카노 2잔 (${result.transcript})\n`);
} finally {
  await fetch(`${base}/sessions/${session.id}`, { method: "DELETE" });
}
