import type { Expected, Group, Slots } from "./criteria";

export interface TextCase {
  id: string; group: Group; initialCart: Slots[];
  turns: { text: string; expected: Expected }[];
}
const cup = (menuId: string, quantity = 1, temperature: Slots["temperature"] = "ice", options: string[] = [], size: Slots["size"] = "M"): Slots =>
  ({ menuId, quantity, temperature, options, size });
const expect = (cart: Slots[], needsClarification = false): Expected => ({ cart, needsClarification, rejectionCodes: [] });
const single = (id: string, dialect: Group["dialect"], text: string, cart: Slots[], needsClarification = false): TextCase =>
  ({ id, group: { dialect, condition: needsClarification ? "ambiguous" : "normal" }, initialCart: [],
    turns: [{ text: needsClarification ? text : `${text}. 나머지 설정은 기본으로 해주세요.`, expected: expect(cart, needsClarification) }] });

// These are deliberately text-only probes, not claims about regional accents or STT.
export const textCases: TextCase[] = [
  single("standard-01", "standard", "아아 두 잔 주세요", [cup("americano", 2)]),
  single("gyeongsang-01", "gyeongsang", "뜨아 한 잔 주이소", [cup("americano", 1, "hot")]),
  single("gyeongsang-02", "gyeongsang", "아이스 라떼 두 잔 주이소. 하나만 샷 추가해주이소", [cup("cafe-latte"), cup("cafe-latte", 1, "ice", ["shot"])]),
  single("jeolla-01", "jeolla", "아이스 아메리카노 두 잔 주쇼", [cup("americano", 2)]),
  single("jeolla-02", "jeolla", "바닐라라떼 한 잔 큰 걸로 주랑께. 두유로 바꿔주쇼", [cup("vanilla-latte", 1, "ice", ["soy_milk"], "L")]),
  single("chungcheong-01", "chungcheong", "따뜻한 라떼 한 잔 해주셔유. 오트밀크로 바꿔주셔유", [cup("cafe-latte", 1, "hot", ["oat_milk"])]),
  single("chungcheong-02", "chungcheong", "아아 두 잔 말고 세 잔 주셔유", [cup("americano", 3)]),
  single("mixed-menu", "standard", "카페라떼 한 잔이랑 아메리카노 두 잔 주세요", [cup("cafe-latte"), cup("americano", 2)]),
  single("missing-quantity", "standard", "아메리카노 주세요", [], true),
  single("unclear-quantity", "gyeongsang", "아메리카노 두... 세... 잘 모르겠네", [], true),
  single("undecided-menu", "jeolla", "라떼인지 바닐라라떼인지 한 잔", [], true),
  single("unknown-menu", "chungcheong", "딸기 주스 한 잔 주셔유", [], true),
  single("conflicting-milk", "standard", "라떼 한 잔 우유를 두유하고 오트밀크로 동시에 바꿔주세요", [], true),
  single("noise-quote", "standard", "옆 테이블에서 아아 두 잔이라고 했어", [], true),
  single("irrelevant", "standard", "감사합니다. 좋은 하루 보내세요", [], true),
  {
    id: "clarification-reply-once", group: { dialect: "chungcheong", condition: "ambiguous" }, initialCart: [],
    turns: [
      { text: "아메리카노 주셔유", expected: expect([], true) },
      { text: "두 잔이유. 나머지 설정은 기본으로 해주세요", expected: expect([cup("americano", 2)]) },
    ],
  },
  {
    id: "ambiguous-target", group: { dialect: "standard", condition: "ambiguous" },
    initialCart: [cup("americano"), cup("cafe-latte")],
    turns: [{ text: "하나만 샷 추가해주세요", expected: expect([cup("americano"), cup("cafe-latte")], true) }],
  },
  {
    id: "correct-quantity-keep-option", group: { dialect: "standard", condition: "normal" }, initialCart: [],
    turns: [
      { text: "아메리카노 두 잔 주세요. 나머지 설정은 기본으로 해주세요", expected: expect([cup("americano", 2)]) },
      { text: "하나만 샷 추가해주세요", expected: expect([cup("americano"), cup("americano", 1, "ice", ["shot"])]) },
      { text: "아니 두 잔 말고 세 잔이요", expected: expect([cup("americano", 2), cup("americano", 1, "ice", ["shot"])]) },
      { text: "샷 들어간 아메리카노에서 샷 빼주세요", expected: expect([cup("americano", 3)]) },
    ],
  },
];
