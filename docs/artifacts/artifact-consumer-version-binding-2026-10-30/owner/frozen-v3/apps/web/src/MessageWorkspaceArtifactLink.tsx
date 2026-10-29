import type { MouseEvent } from "react";
import { FileCode2 } from "lucide-react";
import type { ArtifactInspection } from "./artifact-inspection";
import type { MessageWorkspaceLink } from "./message-markdown-types";

export function WorkspaceArtifactLink({
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
      ...(link.planRevision !== undefined
        ? { planRevision: link.planRevision }
        : {}),
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
