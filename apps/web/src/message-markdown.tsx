import type { ReactNode } from "react";

type MarkdownBlock =
  | { kind: "code"; language?: string; value: string }
  | { kind: "heading"; level: 1 | 2 | 3; value: string }
  | { kind: "quote"; value: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "table"; headers: string[]; rows: string[][] }
  | { kind: "paragraph"; value: string };

export function MessageMarkdown({ text }: { text: string }) {
  return (
    <>
      {parseMarkdownBlocks(text).map((block, index) => {
        const key = `${block.kind}-${String(index)}`;
        if (block.kind === "code") {
          return (
            <pre
              className={`message-code-block${
                block.language ? ` language-${block.language.toLowerCase()}` : ""
              }`}
              key={key}
            >
              {block.language ? <span>{block.language}</span> : null}
              <code>{block.value}</code>
            </pre>
          );
        }
        if (block.kind === "heading") {
          const Heading = `h${String(block.level + 2)}` as "h3" | "h4" | "h5";
          return <Heading key={key}>{inlineMarkdown(block.value)}</Heading>;
        }
        if (block.kind === "quote") {
          return <blockquote key={key}>{inlineMarkdown(block.value)}</blockquote>;
        }
        if (block.kind === "list") {
          const List = block.ordered ? "ol" : "ul";
          return (
            <List key={key}>
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${String(itemIndex)}`}>
                  {inlineMarkdown(item)}
                </li>
              ))}
            </List>
          );
        }
        if (block.kind === "table") {
          return (
            <div className="message-table-wrap" key={key}>
              <table>
                <thead>
                  <tr>
                    {block.headers.map((header, headerIndex) => (
                      <th key={`${key}-head-${String(headerIndex)}`}>
                        {inlineMarkdown(header)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={`${key}-row-${String(rowIndex)}`}>
                      {row.map((cell, cellIndex) => (
                        <td key={`${key}-cell-${String(rowIndex)}-${String(cellIndex)}`}>
                          {inlineMarkdown(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return <p key={key}>{inlineMarkdown(block.value)}</p>;
      })}
    </>
  );
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
  const fence = (lines[index] ?? "").match(
    /^```([A-Za-z0-9_+-]{0,32})\s*$/u,
  );
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
      Array.from({ length: headers.length }, (_, cellIndex) => cells[cellIndex] ?? ""),
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

function inlineMarkdown(value: string): ReactNode[] {
  const tokens =
    /(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^\s)]+\))/gu;
  const output: ReactNode[] = [];
  let cursor = 0;
  for (const match of value.matchAll(tokens)) {
    const start = match.index;
    if (start > cursor) output.push(value.slice(cursor, start));
    const token = match[0];
    if (token.startsWith("`")) {
      output.push(<code key={`${start}-code`}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      output.push(<strong key={`${start}-strong`}>{token.slice(2, -2)}</strong>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/u);
      const href = link?.[2];
      output.push(
        href && safeExternalHref(href) ? (
          <a
            href={href}
            key={`${start}-link`}
            target="_blank"
            rel="noreferrer noopener"
          >
            {link[1]}
          </a>
        ) : (
          token
        ),
      );
    }
    cursor = start + token.length;
  }
  if (cursor < value.length) output.push(value.slice(cursor));
  return output;
}

function safeExternalHref(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
