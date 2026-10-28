import { PencilLine } from "lucide-react";
import { artifactInspectorCopy as copy } from "./artifact-inspector-copy";
import { taskSurfaceCopy } from "./task-surface-copy";
import "./artifact-review-actions.css";

export function ArtifactReviewActions({
  integrityRecorded,
  onContinueEditing,
}: {
  integrityRecorded: boolean;
  onContinueEditing(): void;
}) {
  return (
    <div className="artifact-review-actions">
      <span>
        {integrityRecorded
          ? taskSurfaceCopy.completion.integrityRecorded
          : taskSurfaceCopy.completion.fileUnverified}
      </span>
      <button type="button" onClick={onContinueEditing}>
        <PencilLine size={14} aria-hidden="true" />
        {copy.continueEditing}
      </button>
    </div>
  );
}
