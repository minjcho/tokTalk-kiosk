import type { GuidanceSpeechInput } from "@workspace/api-zod";

/** Only these server-authored messages may be synthesized by the guidance route. */
export const GUIDANCE_TEXT: Record<GuidanceSpeechInput["guide"], string> = {
  welcome: "마이크 버튼을 누르고 주문할 메뉴와 수량을 말씀해 주세요. 예를 들어, 아이스 아메리카노 두 잔 주세요. 말씀이 끝나면 버튼을 다시 눌러 주세요. 확인 질문을 듣고 답하거나, 화면에서 메뉴를 선택해 주문할 수도 있어요.",
  "no-speech": "목소리가 들리지 않았어요. 마이크 버튼을 누르고 조금 더 가까이에서 주문할 메뉴와 수량을 다시 말씀해 주세요. 화면에서 주문할 수도 있어요.",
  "too-short": "너무 짧게 녹음되었어요. 마이크 버튼을 누르고 주문할 메뉴와 수량을 끝까지 말씀해 주세요. 말씀이 끝나면 버튼을 다시 눌러 주세요.",
  "mic-denied": "마이크 사용이 허용되지 않았어요. 브라우저 설정에서 마이크를 허용한 뒤 다시 눌러 주세요. 화면에서 메뉴를 선택해 주문할 수도 있어요.",
  "mic-unavailable": "마이크를 사용할 수 없어요. 연결과 브라우저 권한을 확인하거나 화면에서 메뉴를 선택해 주문해 주세요.",
  "recognition-failed": "음성을 글로 바꾸지 못했어요. 마이크 버튼을 누르고 다시 말씀하거나 화면에서 메뉴를 선택해 주문해 주세요.",
};
