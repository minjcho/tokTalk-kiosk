export const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;
export const tempLabel = (t: string) => (t === 'hot' ? '따뜻하게' : '차갑게');

export interface DescribedError { message: string; status?: number; code?: string; transcript?: string }

const CODE_MSG: Record<string, string> = {
  NO_SPEECH: '목소리가 들리지 않았어요. 다시 한번 말씀해 주세요.',
  STT_ERROR: '음성을 글자로 바꾸지 못했어요. 다시 말씀해 주시거나 화면을 눌러 주문해 주세요.',
  AI_UNAVAILABLE: '지금은 음성 주문을 사용할 수 없어요. 화면을 눌러 주문해 주세요.',
  SESSION_EXPIRED: '주문 시간이 지나 처음 화면으로 돌아갑니다.',
};

export function describeError(e: unknown): DescribedError {
  const err = e as { status?: number; data?: { error?: string; code?: string; transcript?: string } } | null;
  const status = err?.status;
  const data = err?.data;
  if (status === undefined && !data) {
    return { message: '네트워크 연결을 확인한 뒤 다시 시도해 주세요.' };
  }
  if (status === 409) {
    return { status, code: data?.code, message: '다른 변경이 먼저 적용되었어요. 장바구니를 새로 불러왔으니 다시 시도해 주세요.' };
  }
  const code = data?.code;
  const message = (code && CODE_MSG[code]) || (data?.error && /[가-힣]/.test(data.error) ? data.error : '처리 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.');
  return { status, code, transcript: data?.transcript, message };
}
