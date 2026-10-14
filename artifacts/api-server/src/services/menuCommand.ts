function compactCommand(text: string): string {
  return text.normalize("NFKC").trim()
    .replace(/[.!?。！？~]+$/u, "")
    .replace(/\s+/gu, "");
}

/**
 * Only complete, affirmative display requests bypass order interpretation.
 * Full matching deliberately rejects negation, recommendations and mixed orders.
 */
export function isMenuDisplayRequest(text: string): boolean {
  const compact = compactCommand(text);
  return /^(?:저기요|저기|혹시)?메뉴(?:판)?(?:을|를)?(?:좀|한번)?(?:보여(?:줘|주세요|주실래요|줄래요|주시겠어요|주십시오|주실수있나요|주실수있을까요)|보고싶(?:어|어요)|볼(?:게요|래요|수있나요|수있을까요)|띄워(?:줘|주세요))$/u.test(compact);
}

/** Closing the menu is not cancelling, confirming or editing an order. */
export function isMenuCloseRequest(text: string): boolean {
  const compact = compactCommand(text);
  return /^(?:저기요|저기|혹시)?메뉴(?:판)?(?:을|를)?(?:좀|한번)?(?:닫아|접어|숨겨)(?:줘|줘요|주세요|주실래요|줄래요|주시겠어요|주십시오|주실수있나요|주실수있을까요)$/u.test(compact);
}
