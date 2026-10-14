import { getOpenAI, SPEECH_MODEL } from "./openaiClient";
import { KioskError } from "./errors";
import type { ClarificationSpeechInputSpeed } from "@workspace/api-zod";

const READING_SPEED: Record<ClarificationSpeechInputSpeed, number> = { slow: 0.8, normal: 1 };

export interface SpeechService {
  synthesize(text: string, signal: AbortSignal, speed?: ClarificationSpeechInputSpeed): Promise<Buffer>;
}

/** Transient request bytes only: no filesystem, database or cross-customer cache. */
export class OpenAISpeechService implements SpeechService {
  constructor(private client = getOpenAI) {}

  async synthesize(text: string, signal: AbortSignal, speed: ClarificationSpeechInputSpeed = "normal"): Promise<Buffer> {
    if (speed !== "slow" && speed !== "normal") {
      throw new KioskError("INVALID_INPUT", "질문 읽기 속도는 느리게 또는 보통으로 선택해주세요.");
    }
    const response = await this.client().audio.speech.create({
      model: SPEECH_MODEL,
      voice: "coral",
      input: text,
      instructions: "한국어로 또렷하고 친절하게 읽어주세요. 제공된 문구 그대로만 읽고 다른 말은 추가하지 마세요.",
      speed: READING_SPEED[speed],
      response_format: "mp3",
    }, { signal, timeout: 20_000, maxRetries: 0 });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) throw new KioskError("TTS_FAILED", "안내 음성을 만들지 못했어요. 다시 듣기를 누르거나 화면에서 주문해주세요.", 502);
    return bytes;
  }
}

export const speechService: SpeechService = new OpenAISpeechService();
