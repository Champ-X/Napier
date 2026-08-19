import type { ReactNode } from "react";

import { highlightMessageCode } from "./message-code-highlighting";
import {
  parseMarkdownBlocks,
  projectDiffLines,
} from "./message-markdown-parser";
import "./message-markdown.css";

export type { DiffLineTone } from "./message-markdown-parser";
export {
  parseMarkdownBlocks,
  projectDiffLines,
} from "./message-markdown-parser";

export interface MessageWorkspaceLink {
  path: string;
  targetId: string;
}

export interface MessageCitationLink {
  citationId: string;
  targetId: string;
  index: number;
}

export interface MessageMarkdownProps {
  text: string;
  workspaceLinks?: readonly MessageWorkspaceLink[];
  citationLinks?: readonly MessageCitationLink[];
}

export function MessageMarkdown({
  text,
  workspaceLinks = [],
  citationLinks = [],
}: MessageMarkdownProps) {
  const workspaceTargets = new Map(
    workspaceLinks.map((link) => [link.path, link.targetId]),
  );
  const citationTargets = new Map(
    citationLinks.map((link) => [link.citationId, link]),
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
          const highlighted = diffLines
            ? undefined
            : highlightMessageCode(block.value, language);
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
                  : highlighted
                    ? highlighted.map((token, tokenIndex) =>
                        token.tone ? (
                          <span
                            className={`message-code-token is-${token.tone}`}
                            key={`${key}-token-${String(tokenIndex)}`}
                          >
                            {token.value}
                          </span>
                        ) : (
                          token.value
                        ),
                      )
                    : block.value}
              </code>
            </pre>
          );
        }
        if (block.kind === "heading") {
          const Heading = `h${String(block.level + 2)}` as "h3" | "h4" | "h5";
          return (
            <Heading key={key}>
              {inlineMarkdown(block.value, workspaceTargets, citationTargets)}
            </Heading>
          );
        }
        if (block.kind === "quote") {
          return (
            <blockquote key={key}>
              {inlineMarkdown(block.value, workspaceTargets, citationTargets)}
            </blockquote>
          );
        }
        if (block.kind === "list") {
          const List = block.ordered ? "ol" : "ul";
          return (
            <List key={key}>
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${String(itemIndex)}`}>
                  {inlineMarkdown(item, workspaceTargets, citationTargets)}
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
                        {inlineMarkdown(
                          header,
                          workspaceTargets,
                          citationTargets,
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={`${key}-row-${String(rowIndex)}`}>
                      {row.map((cell, cellIndex) => (
                        <td
                          key={`${key}-cell-${String(rowIndex)}-${String(cellIndex)}`}
                        >
                          {inlineMarkdown(
                            cell,
                            workspaceTargets,
                            citationTargets,
                          )}
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
          <p key={key}>
            {inlineMarkdown(block.value, workspaceTargets, citationTargets)}
          </p>
        );
      })}
    </>
  );
}

function inlineMarkdown(
  value: string,
  workspaceTargets: ReadonlyMap<string, string>,
  citationTargets: ReadonlyMap<string, MessageCitationLink>,
): ReactNode[] {
  const tokens =
    /(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^\s)]+\)|\[citation:citation_[a-z0-9]{8,80}\])/gu;
  const output: ReactNode[] = [];
  let cursor = 0;
  for (const match of value.matchAll(tokens)) {
    const start = match.index;
    if (start > cursor) output.push(value.slice(cursor, start));
    const token = match[0];
    if (token.startsWith("[citation:")) {
      const citationId = token.slice("[citation:".length, -1);
      const citation = citationTargets.get(citationId);
      output.push(
        citation ? (
          <a
            className="message-citation-link"
            href={`#${citation.targetId}`}
            key={`${start}-citation`}
            aria-label={`Citation ${citation.index}`}
          >
            [{citation.index}]
          </a>
        ) : (
          token
        ),
      );
    } else if (token.startsWith("`")) {
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
      output.push(
        <strong key={`${start}-strong`}>{token.slice(2, -2)}</strong>,
      );
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
