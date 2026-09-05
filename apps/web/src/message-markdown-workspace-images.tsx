import { useState } from "react";

import {
  contextualWorkspaceFilePath,
  inlineCodeDirectory,
  INLINE_TOKEN,
  isWorkspaceImageReference,
  messageImageSource,
  type DirectoryContext,
  type MessageInlineContext,
} from "./message-markdown-inline";

export interface MessageWorkspaceImageReference {
  label: string;
  path: string;
}

export function workspaceImageReferences(
  value: string,
  context: MessageInlineContext,
): MessageWorkspaceImageReference[] {
  const references: MessageWorkspaceImageReference[] = [];
  const seen = new Set<string>();
  let directoryContext: DirectoryContext | undefined;
  for (const match of value.matchAll(INLINE_TOKEN)) {
    const token = match[0];
    const start = match.index;
    let candidate: MessageWorkspaceImageReference | undefined;
    if (token.startsWith("`")) {
      const label = token.slice(1, -1);
      candidate = {
        label,
        path: contextualWorkspaceFilePath(
          label,
          value,
          start,
          directoryContext,
        ),
      };
    } else if (token.startsWith("[") && !token.startsWith("[citation:")) {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/u);
      if (link?.[1] && link[2]) {
        candidate = {
          label: link[1],
          path: contextualWorkspaceFilePath(
            link[2],
            value,
            start,
            directoryContext,
          ),
        };
      }
    }
    if (
      candidate &&
      isWorkspaceImageReference(candidate.path) &&
      (context.onOpenWorkspaceFile ||
        context.workspaceTargets.has(candidate.path)) &&
      !seen.has(candidate.path)
    ) {
      seen.add(candidate.path);
      references.push(candidate);
    }
    const directory = inlineCodeDirectory(token);
    if (directory) {
      directoryContext = {
        path: directory,
        tokenEnd: start + token.length,
      };
    }
  }
  return references;
}

export function MessageWorkspaceImagePreview({
  reference,
}: {
  reference: MessageWorkspaceImageReference;
}) {
  const [unavailable, setUnavailable] = useState(false);
  const source = messageImageSource(reference.path);
  if (unavailable || !source) return null;
  return (
    <span
      className="message-rich-image is-workspace-preview"
      data-workspace-image-path={reference.path}
    >
      <img
        src={source}
        alt={reference.label || reference.path}
        loading="lazy"
        decoding="async"
        onError={() => setUnavailable(true)}
      />
      <small>{reference.path}</small>
    </span>
  );
}
