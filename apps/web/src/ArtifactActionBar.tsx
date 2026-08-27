import {
  ArchiveRestore,
  Clipboard,
  ExternalLink,
  Eye,
  FileDiff,
  FileSearch,
  GitMerge,
} from "lucide-react";

import "./artifact-action-surface.css";
import type { ArtifactActionId } from "./artifact-action-model";
import { artifactActionCopy as copy } from "./artifact-action-copy";

export interface ArtifactActionControl {
  action: ArtifactActionId;
  busy?: boolean;
  complete?: boolean;
  disabled?: boolean;
  className?: string;
  onAction(): void;
}

export function ArtifactActionBar({
  controls,
  primaryAction,
}: {
  controls: ArtifactActionControl[];
  primaryAction?: ArtifactActionId;
}) {
  return (
    <div className="artifact-action-bar" aria-label={copy.actions}>
      {controls.map((control) => {
        const Icon = artifactActionIcon(control.action);
        return (
          <button
            type="button"
            data-artifact-action={control.action}
            data-artifact-primary={
              control.action === primaryAction ? "true" : undefined
            }
            className={control.className}
            disabled={control.disabled || control.busy}
            aria-busy={control.busy || undefined}
            onClick={control.onAction}
            key={control.action}
          >
            <Icon size={12} aria-hidden="true" />
            {artifactActionLabel(control)}
          </button>
        );
      })}
    </div>
  );
}

function artifactActionIcon(action: ArtifactActionId) {
  if (action === "open") return ExternalLink;
  if (action === "preview") return FileSearch;
  if (action === "diff") return FileDiff;
  if (action === "reveal") return Eye;
  if (action === "copy_path") return Clipboard;
  if (action === "restore") return ArchiveRestore;
  return GitMerge;
}

function artifactActionLabel(control: ArtifactActionControl): string {
  if (control.action === "open") return control.busy ? copy.opening : copy.open;
  if (control.action === "preview")
    return control.busy ? copy.previewing : copy.preview;
  if (control.action === "diff") return control.busy ? copy.diffing : copy.diff;
  if (control.action === "reveal")
    return control.busy ? copy.revealing : copy.reveal;
  if (control.action === "copy_path")
    return control.complete ? copy.copied : copy.copyPath;
  if (control.action === "restore")
    return control.busy ? copy.restoring : copy.restore;
  return control.busy ? copy.applying : copy.apply;
}
