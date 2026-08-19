export type MarkdownBlock =
  | { kind: "code"; language?: string; value: string }
  | { kind: "heading"; level: 1 | 2 | 3; value: string }
  | { kind: "quote"; value: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "table"; headers: string[]; rows: string[][] }
  | { kind: "paragraph"; value: string };

export type DiffLineTone =
  | "addition"
  | "deletion"
  | "hunk"
  | "metadata"
  | "context";

export function projectDiffLines(
  value: string,
): Array<{ value: string; tone: DiffLineTone }> {
  return value.split("\n").map((line) => ({
    value: line,
    tone: diffLineTone(line),
  }));
}

export function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const parsed =
      parseFence(lines, index) ??
      parseHeading(line, index) ??
      parseQuote(lines, index) ??
      parseTable(lines, index) ??
      parseList(lines, index) ??
      parseParagraph(lines, index);
    blocks.push(parsed.block);
    index = parsed.nextIndex;
  }
  return blocks;
}

interface ParsedBlock {
  block: MarkdownBlock;
  nextIndex: number;
}

function parseFence(lines: string[], index: number): ParsedBlock | undefined {
  const fence = (lines[index] ?? "").match(/^```([A-Za-z0-9_+-]{0,32})\s*$/u);
  if (!fence) return undefined;
  const code: string[] = [];
  let nextIndex = index + 1;
  while (
    nextIndex < lines.length &&
    !/^```\s*$/u.test(lines[nextIndex] ?? "")
  ) {
    code.push(lines[nextIndex] ?? "");
    nextIndex += 1;
  }
  if (nextIndex < lines.length) nextIndex += 1;
  return {
    block: {
      kind: "code",
      ...(fence[1] ? { language: fence[1] } : {}),
      value: code.join("\n"),
    },
    nextIndex,
  };
}

function parseHeading(line: string, index: number): ParsedBlock | undefined {
  const heading = line.match(/^(#{1,3})\s+(.+)$/u);
  return heading
    ? {
        block: {
          kind: "heading",
          level: heading[1]!.length as 1 | 2 | 3,
          value: heading[2]!,
        },
        nextIndex: index + 1,
      }
    : undefined;
}

function parseQuote(lines: string[], index: number): ParsedBlock | undefined {
  if (!/^>\s?/u.test(lines[index] ?? "")) return undefined;
  const quote: string[] = [];
  let nextIndex = index;
  while (nextIndex < lines.length && /^>\s?/u.test(lines[nextIndex] ?? "")) {
    quote.push((lines[nextIndex] ?? "").replace(/^>\s?/u, ""));
    nextIndex += 1;
  }
  return {
    block: { kind: "quote", value: quote.join(" ") },
    nextIndex,
  };
}

function parseList(lines: string[], index: number): ParsedBlock | undefined {
  const line = lines[index] ?? "";
  const ordered = /^\s*\d+\.\s+(.+)$/u.test(line);
  const matcher = ordered ? /^\s*\d+\.\s+(.+)$/u : /^\s*[-*]\s+(.+)$/u;
  if (!matcher.test(line)) return undefined;
  const items: string[] = [];
  let nextIndex = index;
  while (nextIndex < lines.length) {
    const match = (lines[nextIndex] ?? "").match(matcher);
    if (!match) break;
    items.push(match[1]!);
    nextIndex += 1;
  }
  return { block: { kind: "list", ordered, items }, nextIndex };
}

function parseTable(lines: string[], index: number): ParsedBlock | undefined {
  const headers = tableCells(lines[index] ?? "");
  const divider = lines[index + 1] ?? "";
  if (
    headers.length === 0 ||
    !/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/u.test(divider)
  ) {
    return undefined;
  }
  const rows: string[][] = [];
  let nextIndex = index + 2;
  while (nextIndex < lines.length && (lines[nextIndex] ?? "").includes("|")) {
    const cells = tableCells(lines[nextIndex] ?? "");
    if (cells.length === 0) break;
    rows.push(
      Array.from(
        { length: headers.length },
        (_, cellIndex) => cells[cellIndex] ?? "",
      ),
    );
    nextIndex += 1;
  }
  return {
    block: { kind: "table", headers, rows },
    nextIndex,
  };
}

function parseParagraph(lines: string[], index: number): ParsedBlock {
  const paragraph = [lines[index] ?? ""];
  let nextIndex = index + 1;
  while (
    nextIndex < lines.length &&
    lines[nextIndex]?.trim() &&
    !isBlockStart(lines[nextIndex] ?? "")
  ) {
    paragraph.push(lines[nextIndex] ?? "");
    nextIndex += 1;
  }
  return {
    block: { kind: "paragraph", value: paragraph.join("\n") },
    nextIndex,
  };
}

function isBlockStart(line: string): boolean {
  return (
    /^```/u.test(line) ||
    /^(#{1,3})\s+/u.test(line) ||
    /^>\s?/u.test(line) ||
    (line.includes("|") && /^.*\|.*$/u.test(line)) ||
    /^\s*(?:[-*]|\d+\.)\s+/u.test(line)
  );
}

function tableCells(line: string): string[] {
  const normalized = line.trim().replace(/^\|/u, "").replace(/\|$/u, "");
  return normalized.includes("|")
    ? normalized.split("|").map((cell) => cell.trim())
    : [];
}

function diffLineTone(line: string): DiffLineTone {
  if (line.startsWith("@@")) return "hunk";
  if (
    /^(?:diff |index |--- |\+\+\+ |new file |deleted file |rename |similarity |\\ No newline)/u.test(
      line,
    )
  ) {
    return "metadata";
  }
  if (line.startsWith("+")) return "addition";
  if (line.startsWith("-")) return "deletion";
  return "context";
}
