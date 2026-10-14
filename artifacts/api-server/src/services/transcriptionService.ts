import { toFile } from "openai";
import { menu } from "./menuService";
import { getOpenAI, TRANSCRIPTION_MODEL } from "./openaiClient";
import { KioskError } from "./errors";
import { validatePcmWav } from "./wavValidation";

export interface TranscriptionService {
  transcribe(audio: Buffer, mimeType: string, clarification?: string | null): Promise<string>;
}

/** Independent adapter: a new STT provider does not affect order parsing. */
export class OpenAITranscriptionService implements TranscriptionService {
  constructor(private client = getOpenAI) {}

  async transcribe(audio: Buffer, mimeType: string, clarification?: string | null): Promise<string> {
    if (audio.length < 1000) throw new KioskError("NO_AUDIO", "목소리가 들리지 않았습니다. 마이크를 누르고 다시 말씀해주세요.");
    if (audio.length > 10_000_000) throw new KioskError("AUDIO_TOO_LARGE", "녹음이 너무 깁니다. 45초 이내로 나누어 말씀해주세요.");
    const extension = ({ "audio/wav": "wav", "audio/webm": "webm", "audio/mp4": "m4a", "audio/ogg": "ogg" } as Record<string, string>)[mimeType];
    if (!extension) throw new KioskError("AUDIO_FORMAT", "지원하지 않는 녹음 형식입니다. 화면에서 주문해주세요.");
    if (mimeType === "audio/wav") validatePcmWav(audio);
    const response = await this.client().audio.transcriptions.create({
      file: await toFile(audio, `order.${extension}`, { type: mimeType }),
      model: TRANSCRIPTION_MODEL,
      language: "ko",
      response_format: "json",
      prompt: `한국 카페의 음료 주문 대화. 발화를 있는 그대로 받아쓰고 침묵이나 배경소리는 주문으로 만들지 않습니다. 사투리 예: 주이소, 주쇼, 해주셔유. 메뉴와 키워드: ${menu.flatMap((m) => m.aliases).join(", ")}, 샷 추가, 디카페인, 오트밀크, 두유, 아이스, 핫, 레귤러, 라지, 하나, 한 잔, 두 잔, 세 잔, 빼주세요, 수정해주세요.
${clarification ? `현재 직원의 확인 질문: ${clarification.slice(0, 2000)}
고객의 짧은 답변을 받아씁니다. 응답 예시: 아이스요, 따뜻하게요, 레귤러요, 라지요, 추가 없이 주세요, 없어요, 샷 추가요. 예시나 질문을 답변으로 복사하지 말고 실제 들린 발화만 기록하세요.` : ""}`,
    });
    const text = response.text?.trim();
    if (!text) throw new KioskError("NO_SPEECH", "주문 내용을 듣지 못했습니다. 다시 말씀해주세요.");
    return text;
  }
}

export const transcriptionService: TranscriptionService = new OpenAITranscriptionService();
