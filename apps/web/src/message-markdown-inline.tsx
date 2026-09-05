import type { MouseEvent, ReactNode } from "react";
import { FileCode2 } from "lucide-react";

import type { ArtifactInspection } from "./artifact-inspection";
import type {
  MessageCitationLink,
  MessageSkillResourceLink,
  MessageWorkspaceLink,
} from "./message-markdown-types";

export interface MessageInlineContext {
  workspaceTargets: ReadonlyMap<string, MessageWorkspaceLink>;
  skillResourceTargets: ReadonlyMap<string, MessageSkillResourceLink>;
  citationTargets: ReadonlyMap<string, MessageCitationLink>;
  onInspectArtifact?: (inspection: ArtifactInspection) => void;
  onOpenWorkspaceFile?: (path: string) => void;
  onOpenSkillResource?: (reference: MessageSkillResourceLink) => void;
}

export interface DirectoryContext {
  path: string;
  tokenEnd: number;
}

export const INLINE_TOKEN =
  /(!\[[^\]\n]*\]\([^\s)]+\)|`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^\s)]+\)|\[citation:citation_[a-z0-9]{8,80}\])/gu;

export function createMessageInlineContext(input: {
  workspaceLinks: readonly MessageWorkspaceLink[];
  skillResourceLinks: readonly MessageSkillResourceLink[];
  citationLinks: readonly MessageCitationLink[];
  onInspectArtifact?: (inspection: ArtifactInspection) => void;
  onOpenWorkspaceFile?: (path: string) => void;
  onOpenSkillResource?: (reference: MessageSkillResourceLink) => void;
}): MessageInlineContext {
  return {
    workspaceTargets: new Map(
      input.workspaceLinks.map((link) => [link.path, link]),
    ),
    skillResourceTargets: skillResourceTargetMap(input.skillResourceLinks),
    citationTargets: new Map(
      input.citationLinks.map((link) => [link.citationId, link]),
    ),
    ...(input.onInspectArtifact
      ? { onInspectArtifact: input.onInspectArtifact }
      : {}),
    ...(input.onOpenWorkspaceFile
      ? { onOpenWorkspaceFile: input.onOpenWorkspaceFile }
      : {}),
    ...(input.onOpenSkillResource
      ? { onOpenSkillResource: input.onOpenSkillResource }
      : {}),
  };
}

export function inlineMarkdown(
  value: string,
  context: MessageInlineContext,
): ReactNode[] {
  const output: ReactNode[] = [];
  let cursor = 0;
  let directoryContext: DirectoryContext | undefined;
  for (const match of value.matchAll(INLINE_TOKEN)) {
    const start = match.index;
    if (start > cursor) output.push(value.slice(cursor, start));
    const token = match[0];
    output.push(
      renderInlineToken(token, start, value, directoryContext, context),
    );
    const directory = inlineCodeDirectory(token);
    if (directory) {
      directoryContext = {
        path: directory,
        tokenEnd: start + token.length,
      };
    }
    cursor = start + token.length;
  }
  if (cursor < value.length) output.push(value.slice(cursor));
  return output;
}

function renderInlineToken(
  token: string,
  start: number,
  source: string,
  directoryContext: DirectoryContext | undefined,
  context: MessageInlineContext,
): ReactNode {
  if (token.startsWith("![")) return renderImageToken(token, start);
  if (token.startsWith("[citation:")) {
    return renderCitationToken(token, start, context);
  }
  if (token.startsWith("`")) {
    return renderCodeToken(token, start, source, directoryContext, context);
  }
  if (token.startsWith("**")) {
    return (
      <strong key={`${start}-strong`}>
        {inlineMarkdown(token.slice(2, -2), context)}
      </strong>
    );
  }
  return renderLinkToken(token, start, source, directoryContext, context);
}

function renderImageToken(token: string, start: number): ReactNode {
  const image = token.match(/^!\[([^\]]*)\]\(([^)]+)\)$/u);
  const source = image?.[2];
  const imageLabel = image?.[1]?.trim() ?? "";
  const imageSource = source ? messageImageSource(source) : undefined;
  if (!imageSource) return token;
  return (
    <span className="message-rich-image" key={`${start}-image`}>
      <img
        src={imageSource}
        alt={imageLabel || "Image from the answer"}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
      />
      {imageLabel ? <small>{imageLabel}</small> : null}
    </span>
  );
}

function renderCitationToken(
  token: string,
  start: number,
  context: MessageInlineContext,
): ReactNode {
  const citationId = token.slice("[citation:".length, -1);
  const citation = context.citationTargets.get(citationId);
  if (!citation) return token;
  return (
    <a
      className="message-citation-link"
      href={`#${citation.targetId}`}
      key={`${start}-citation`}
      aria-label={`Citation ${citation.index}`}
    >
      [{citation.index}]
    </a>
  );
}

function renderCodeToken(
  token: string,
  start: number,
  source: string,
  directoryContext: DirectoryContext | undefined,
  context: MessageInlineContext,
): ReactNode {
  const code = token.slice(1, -1);
  const skillResource = skillResourceTarget(context.skillResourceTargets, code);
  if (skillResource) {
    return context.onOpenSkillResource ? (
      <SkillResourceLink
        code
        key={`${start}-skill-resource-code`}
        label={code}
        reference={skillResource}
        onOpen={context.onOpenSkillResource}
      />
    ) : (
      <code key={`${start}-code`}>{code}</code>
    );
  }
  const workspacePath = contextualWorkspaceFilePath(
    code,
    source,
    start,
    directoryContext,
  );
  const target = context.workspaceTargets.get(workspacePath);
  if (target) {
    return (
      <WorkspaceArtifactLink
        code
        key={`${start}-workspace-code`}
        label={code}
        link={target}
        {...(context.onInspectArtifact
          ? { onInspectArtifact: context.onInspectArtifact }
          : {})}
      />
    );
  }
  if (context.onOpenWorkspaceFile && isWorkspaceFileReference(workspacePath)) {
    return (
      <WorkspaceFileLink
        code
        key={`${start}-workspace-file-code`}
        label={code}
        path={workspacePath}
        onOpen={context.onOpenWorkspaceFile}
      />
    );
  }
  return <code key={`${start}-code`}>{code}</code>;
}

function renderLinkToken(
  token: string,
  start: number,
  source: string,
  directoryContext: DirectoryContext | undefined,
  context: MessageInlineContext,
): ReactNode {
  const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/u);
  const href = link?.[2];
  if (!href) return token;
  const label = link?.[1] ?? href;
  const skillResource = skillResourceTarget(context.skillResourceTargets, href);
  if (skillResource) {
    return context.onOpenSkillResource ? (
      <SkillResourceLink
        key={`${start}-skill-resource-link`}
        label={label}
        reference={skillResource}
        onOpen={context.onOpenSkillResource}
      />
    ) : (
      token
    );
  }
  const workspacePath = contextualWorkspaceFilePath(
    href,
    source,
    start,
    directoryContext,
  );
  const target = context.workspaceTargets.get(workspacePath);
  if (target) {
    return (
      <WorkspaceArtifactLink
        key={`${start}-workspace-link`}
        label={label}
        link={target}
        {...(context.onInspectArtifact
          ? { onInspectArtifact: context.onInspectArtifact }
          : {})}
      />
    );
  }
  if (context.onOpenWorkspaceFile && isWorkspaceFileReference(workspacePath)) {
    return (
      <WorkspaceFileLink
        key={`${start}-workspace-file-link`}
        label={label}
        path={workspacePath}
        onOpen={context.onOpenWorkspaceFile}
      />
    );
  }
  if (!safeExternalHref(href)) return token;
  return (
    <a
      href={href}
      key={`${start}-link`}
      target="_blank"
      rel="noreferrer noopener"
    >
      {label}
    </a>
  );
}

export function inlineCodeDirectory(token: string): string | undefined {
  return token.startsWith("`")
    ? workspaceDirectoryReference(token.slice(1, -1))
    : undefined;
}

function skillResourceTargetMap(
  links: readonly MessageSkillResourceLink[],
): Map<string, MessageSkillResourceLink> {
  const targets = new Map<string, MessageSkillResourceLink>();
  for (const link of links) {
    for (const reference of [
      link.resourcePath,
      link.relativePath,
      link.virtualPath,
    ]) {
      targets.set(normalizeWorkspaceReference(reference), link);
    }
  }
  return targets;
}

function skillResourceTarget(
  targets: ReadonlyMap<string, MessageSkillResourceLink>,
  reference: string,
): MessageSkillResourceLink | undefined {
  return targets.get(normalizeWorkspaceReference(reference));
}

export function contextualWorkspaceFilePath(
  reference: string,
  source: string,
  tokenStart: number,
  directoryContext: DirectoryContext | undefined,
): string {
  const normalized = normalizeWorkspaceReference(reference);
  if (
    !directoryContext ||
    normalized.includes("/") ||
    !isWorkspaceFileReference(normalized) ||
    /[.!?;。！？；\n]/u.test(
      source.slice(directoryContext.tokenEnd, tokenStart),
    )
  ) {
    return normalized;
  }
  return `${directoryContext.path}${normalized}`;
}

function workspaceDirectoryReference(value: string): string | undefined {
  const normalized = normalizeWorkspaceReference(value);
  if (
    !normalized.endsWith("/") ||
    normalized === "/" ||
    /[\s<>\[\]{}|"'`]/u.test(normalized) ||
    /^(?:data|file|https?):/iu.test(normalized) ||
    normalized.split("/").includes("..")
  ) {
    return undefined;
  }
  return normalized;
}

function normalizeWorkspaceReference(value: string): string {
  return value.trim().replaceAll("\\", "/");
}

function SkillResourceLink({
  code = false,
  label,
  reference,
  onOpen,
}: {
  code?: boolean;
  label: string;
  reference: MessageSkillResourceLink;
  onOpen(reference: MessageSkillResourceLink): void;
}) {
  return (
    <button
      type="button"
      className={`message-workspace-link is-skill-resource${code ? " is-code" : ""}`}
      data-skill-resource-path={reference.virtualPath}
      aria-label={`Open preview: ${reference.virtualPath}`}
      onClick={() => onOpen(reference)}
    >
      <FileCode2 size={13} aria-hidden="true" />
      {code ? <code>{label}</code> : label}
    </button>
  );
}

function WorkspaceFileLink({
  code = false,
  label,
  path,
  onOpen,
}: {
  code?: boolean;
  label: string;
  path: string;
  onOpen(path: string): void;
}) {
  return (
    <button
      type="button"
      className={`message-workspace-link is-direct${code ? " is-code" : ""}`}
      data-workspace-path={path}
      aria-label={`Open preview: ${path}`}
      onClick={() => onOpen(path)}
    >
      <FileCode2 size={13} aria-hidden="true" />
      {code ? <code>{label}</code> : label}
    </button>
  );
}

function WorkspaceArtifactLink({
  code = false,
  label,
  link,
  onInspectArtifact,
}: {
  code?: boolean;
  label: string;
  link: MessageWorkspaceLink;
  onInspectArtifact?: (inspection: ArtifactInspection) => void;
}) {
  const inspectable =
    link.artifact && link.planId && link.threadId && onInspectArtifact;
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!inspectable) return;
    event.preventDefault();
    onInspectArtifact({
      artifact: link.artifact!,
      mode: "preview",
      planId: link.planId!,
      threadId: link.threadId!,
    });
  };
  return (
    <a
      className={`message-workspace-link${code ? " is-code" : ""}`}
      href={`#${link.targetId}`}
      onClick={open}
      data-artifact-path={link.path}
      aria-label={`Open preview: ${link.path}`}
    >
      <FileCode2 size={13} aria-hidden="true" />
      {code ? <code>{label}</code> : label}
    </a>
  );
}

function safeExternalHref(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function messageImageSource(value: string): string | undefined {
  if (safeExternalHref(value)) return value;
  if (!isWorkspaceImageReference(value)) return undefined;
  return `/api/workspace/file?${new URLSearchParams({ path: value }).toString()}`;
}

const WORKSPACE_IMAGE_EXTENSION = /\.(?:avif|bmp|gif|ico|jpe?g|png|webp)$/iu;

export function isWorkspaceImageReference(value: string): boolean {
  return (
    isWorkspaceFileReference(value) && WORKSPACE_IMAGE_EXTENSION.test(value)
  );
}

const WORKSPACE_FILE_EXTENSION =
  /\.(?:avif|bmp|c|cc|cjs|cpp|css|csv|docx?|gif|go|h|hpp|html?|ico|java|jpe?g|js|jsx|json|kt|kts|less|markdown|md|mdx|mjs|pdf|php|png|pptx?|py|rb|rs|s?css|sh|sql|svg|toml|ts|tsx|txt|webp|xlsx?|xml|ya?ml|zsh)$/iu;

export function isWorkspaceFileReference(value: string): boolean {
  const normalized = normalizeWorkspaceReference(value);
  if (
    !normalized ||
    /[\s<>\[\]{}|"'`]/u.test(normalized) ||
    /^(?:data|file|https?):/iu.test(normalized) ||
    normalized.split("/").includes("..")
  ) {
    return false;
  }
  const filename = normalized.split("/").at(-1);
  return Boolean(
    filename &&
    !filename.startsWith(".") &&
    WORKSPACE_FILE_EXTENSION.test(filename),
  );
}
