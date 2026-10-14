import OpenAI from "openai";
import { KioskError } from "./errors";

export const TRANSCRIPTION_MODEL = process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-transcribe";
export const PARSER_MODEL = process.env.OPENAI_ORDER_MODEL || "gpt-5-mini";
export const SPEECH_MODEL = "gpt-4o-mini-tts";

export function getOpenAI(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new KioskError("API_KEY_MISSING", "AI 주문 기능이 아직 연결되지 않았습니다. 화면에서 메뉴를 선택해주세요.", 503);
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 55_000, maxRetries: 1 });
}
