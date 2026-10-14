export class KioskError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

export function publicError(error: unknown): KioskError {
  if (error instanceof KioskError) return error;
  const status = (error as { status?: number } | null)?.status;
  if (status === 401 || status === 403) {
    return new KioskError("API_AUTH", "AI 연결 설정을 확인해야 합니다. 화면에서 메뉴를 선택해 주문해주세요.", 503);
  }
  if (status === 429) {
    return new KioskError("API_LIMIT", "AI 이용 한도에 도달했습니다. 잠시 뒤 다시 시도하거나 화면에서 주문해주세요.", 503);
  }
  return new KioskError("AI_UNAVAILABLE", "음성·AI 분석에 연결하지 못했습니다. 잠시 뒤 다시 시도하거나 화면에서 주문해주세요.", 502);
}
