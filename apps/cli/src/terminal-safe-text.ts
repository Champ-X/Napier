const TERMINAL_CONTROL =
  /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;
const COMBINING_MARK = /\p{Mark}/u;
const DOUBLE_WIDTH =
  /[\u1100-\u115f\u231a\u231b\u2329\u232a\u23e9-\u23ec\u23f0\u23f3\u25fd\u25fe\u2614\u2615\u2648-\u2653\u267f\u2693\u26a1\u26aa\u26ab\u26bd\u26be\u26c4\u26c5\u26ce\u26d4\u26ea\u26f2\u26f3\u26f5\u26fa\u26fd\u2705\u270a\u270b\u2728\u274c\u274e\u2753-\u2755\u2757\u2795-\u2797\u27b0\u27bf\u2b1b\u2b1c\u2b50\u2b55\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6\u{1f000}-\u{1faff}\u{20000}-\u{3fffd}]/u;

export function terminalSafeText(value: string): string {
  return value
    .replace(/\r\n?/gu, "\n")
    .replace(TERMINAL_CONTROL, visibleCodePoint);
}

export function terminalSafeSingleLine(value: string): string {
  return terminalSafeText(value).replace(/\n/gu, "\\n");
}

export function truncateTerminalText(
  value: string,
  maximumColumns: number,
  suffix = "…",
): string {
  if (maximumColumns <= 0) return "";
  const safe = terminalSafeSingleLine(value);
  if (terminalTextWidth(safe) <= maximumColumns) return safe;
  const suffixWidth = terminalTextWidth(suffix);
  const available = Math.max(0, maximumColumns - suffixWidth);
  let result = "";
  let width = 0;
  for (const character of safe) {
    const characterWidth = terminalCharacterWidth(character);
    if (width + characterWidth > available) break;
    result += character;
    width += characterWidth;
  }
  return `${result}${suffixWidth <= maximumColumns ? suffix : ""}`;
}

export function terminalTextWidth(value: string): number {
  let width = 0;
  for (const character of value) width += terminalCharacterWidth(character);
  return width;
}

function terminalCharacterWidth(character: string): number {
  const codePoint = character.codePointAt(0) ?? 0;
  if (
    codePoint === 0 ||
    codePoint < 32 ||
    (codePoint >= 0x7f && codePoint < 0xa0)
  ) {
    return 0;
  }
  if (COMBINING_MARK.test(character)) return 0;
  return DOUBLE_WIDTH.test(character) ? 2 : 1;
}

function visibleCodePoint(character: string): string {
  const codePoint = character.codePointAt(0) ?? 0xfffd;
  return codePoint <= 0xffff
    ? `\\u${codePoint.toString(16).padStart(4, "0")}`
    : `\\u{${codePoint.toString(16)}}`;
}
