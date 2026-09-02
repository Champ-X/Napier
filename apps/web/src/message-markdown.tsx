import type { ArtifactInspection } from "./artifact-inspection";
import { MessageFlowchart } from "./MessageFlowchart";
import { MessageHtmlPreview } from "./MessageHtmlPreview";
import { highlightMessageCode } from "./message-code-highlighting";
import { parseMessageFlowchart } from "./message-flowchart";
import {
  createMessageInlineContext,
  inlineMarkdown,
} from "./message-markdown-inline";
import {
  parseMarkdownBlocks,
  projectDiffLines,
} from "./message-markdown-parser";
import type {
  MessageCitationLink,
  MessageSkillResourceLink,
  MessageWorkspaceLink,
} from "./message-markdown-types";
import "./message-markdown.css";

export type { DiffLineTone } from "./message-markdown-parser";
export type {
  MessageCitationLink,
  MessageSkillResourceLink,
  MessageWorkspaceLink,
} from "./message-markdown-types";
export {
  isWorkspaceFileReference,
  isWorkspaceImageReference,
} from "./message-markdown-inline";
export {
  parseMarkdownBlocks,
  projectDiffLines,
} from "./message-markdown-parser";

export interface MessageMarkdownProps {
  text: string;
  workspaceLinks?: readonly MessageWorkspaceLink[];
  skillResourceLinks?: readonly MessageSkillResourceLink[];
  citationLinks?: readonly MessageCitationLink[];
  onInspectArtifact?(inspection: ArtifactInspection): void;
  onOpenWorkspaceFile?(path: string): void;
  onOpenSkillResource?(reference: MessageSkillResourceLink): void;
}

export function MessageMarkdown({
  text,
  workspaceLinks = [],
  skillResourceLinks = [],
  citationLinks = [],
  onInspectArtifact,
  onOpenWorkspaceFile,
  onOpenSkillResource,
}: MessageMarkdownProps) {
  const inlineContext = createMessageInlineContext({
    workspaceLinks,
    skillResourceLinks,
    citationLinks,
    ...(onInspectArtifact ? { onInspectArtifact } : {}),
    ...(onOpenWorkspaceFile ? { onOpenWorkspaceFile } : {}),
    ...(onOpenSkillResource ? { onOpenSkillResource } : {}),
  });
  return (
    <>
      {parseMarkdownBlocks(text).map((block, index) => {
        const key = `${block.kind}-${String(index)}`;
        if (block.kind === "code") {
          const language = block.language?.toLowerCase();
          if (
            (language === "mermaid" || language === "flowchart") &&
            parseMessageFlowchart(block.value)
          ) {
            return <MessageFlowchart key={key} source={block.value} />;
          }
          if (language === "html" || language === "htm") {
            return <MessageHtmlPreview key={key} source={block.value} />;
          }
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
              {inlineMarkdown(block.value, inlineContext)}
            </Heading>
          );
        }
        if (block.kind === "quote") {
          return (
            <blockquote key={key}>
              {inlineMarkdown(block.value, inlineContext)}
            </blockquote>
          );
        }
        if (block.kind === "list") {
          const List = block.ordered ? "ol" : "ul";
          return (
            <List key={key}>
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${String(itemIndex)}`}>
                  {inlineMarkdown(item, inlineContext)}
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
                        {inlineMarkdown(header, inlineContext)}
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
                          {inlineMarkdown(cell, inlineContext)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return <p key={key}>{inlineMarkdown(block.value, inlineContext)}</p>;
      })}
    </>
  );
}
