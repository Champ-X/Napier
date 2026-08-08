import type { ReactNode } from "react";

type MarkdownBlock =
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

export interface MessageWorkspaceLink {
  path: string;
  targetId: string;
}

export function MessageMarkdown({
  text,
  workspaceLinks = [],
}: {
  text: string;
  workspaceLinks?: readonly MessageWorkspaceLink[];
}) {
  const workspaceTargets = new Map(
    workspaceLinks.map((link) => [link.path, link.targetId]),
  );
  return (
    <>
      {parseMarkdownBlocks(text).map((block, index) => {
        const key = `${block.kind}-${String(index)}`;
        if (block.kind === "code") {
          const language = block.language?.toLowerCase();
          const diffLines =
            language === "diff" || language === "patch"
              ? projectDiffLines(block.value)
              : undefined;
          return (
            <pre
              className={`message-code-block${
                language ? ` language-${language}` : ""
              }`}
              key={key}
            >
              {block.language ? <span>{block.language}</span> : null}
              <code>
                {diffLines
                  ? diffLines.map((line, lineIndex) => (
                      <span
                        className={`message-diff-line is-${line.tone}`}
                        key={`${key}-line-${String(lineIndex)}`}
                      >
                        {line.value}
                        {lineIndex < diffLines.length - 1 ? "\n" : null}
                      </span>
                    ))
                  : block.value}
              </code>
            </pre>
          );
        }
        if (block.kind === "heading") {
          const Heading = `h${String(block.level + 2)}` as "h3" | "h4" | "h5";
          return (
            <Heading key={key}>
              {inlineMarkdown(block.value, workspaceTargets)}
            </Heading>
          );
        }
        if (block.kind === "quote") {
          return (
            <blockquote key={key}>
              {inlineMarkdown(block.value, workspaceTargets)}
            </blockquote>
          );
        }
        if (block.kind === "list") {
          const List = block.ordered ? "ol" : "ul";
          return (
            <List key={key}>
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${String(itemIndex)}`}>
                  {inlineMarkdown(item, workspaceTargets)}
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
                        {inlineMarkdown(header, workspaceTargets)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={`${key}-row-${String(rowIndex)}`}>
                      {row.map((cell, cellIndex) => (
                        <td key={`${key}-cell-${String(rowIndex)}-${String(cellIndex)}`}>
                          {inlineMarkdown(cell, workspaceTargets)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return (
          <p key={key}>{inlineMarkdown(block.value, workspaceTargets)}</p>
        );
      })}
    </>
  );
}

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

function inlineMarkdown(
  value: string,
  workspaceTargets: ReadonlyMap<string, string>,
): ReactNode[] {
  const tokens =
    /(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^\s)]+\))/gu;
  const output: ReactNode[] = [];
  let cursor = 0;
  for (const match of value.matchAll(tokens)) {
    const start = match.index;
    if (start > cursor) output.push(value.slice(cursor, start));
    const token = match[0];
    if (token.startsWith("`")) {
      const code = token.slice(1, -1);
      const targetId = workspaceTargets.get(code);
      output.push(
        targetId ? (
          <a
            className="message-workspace-link is-code"
            href={`#${targetId}`}
            key={`${start}-workspace-code`}
          >
            <code>{code}</code>
          </a>
        ) : (
          <code key={`${start}-code`}>{code}</code>
        ),
      );
    } else if (token.startsWith("**")) {
      output.push(<strong key={`${start}-strong`}>{token.slice(2, -2)}</strong>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/u);
      const href = link?.[2];
      const targetId = href ? workspaceTargets.get(href) : undefined;
      output.push(
        targetId ? (
          <a
            className="message-workspace-link"
            href={`#${targetId}`}
            key={`${start}-workspace-link`}
          >
            {link?.[1]}
          </a>
        ) : href && safeExternalHref(href) ? (
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
