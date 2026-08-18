import { RotateCcw } from "lucide-react";

import type { RunRecord } from "@napier/contracts";
import { copy } from "./copy";

export function RecoveryBanner({
  run,
  running,
  modelConfigured,
  onResume,
}: {
  run: RunRecord;
  running: boolean;
  modelConfigured: boolean;
  onResume: () => void;
}) {
  const resumeWarningId = "recovery-model-unavailable";
  const recoveryCopy =
    run.status === "failed" && run.outcome === "partial"
      ? copy.recovery.partial
      : copy.recovery;
  return (
    <section className="recovery-banner" aria-labelledby="recovery-title">
      <div className="recovery-mark" aria-hidden="true">
        <RotateCcw size={16} />
      </div>
      <div>
        <span>{recoveryCopy.eyebrow}</span>
        <h2 id="recovery-title">{recoveryCopy.title}</h2>
        <p>{recoveryCopy.body}</p>
        <code>
          {recoveryCopy.run}: {run.id}
        </code>
      </div>
      <div className="recovery-actions">
        {!modelConfigured ? (
          <p id={resumeWarningId}>{copy.modelUnavailableHint}</p>
        ) : null}
        <button
          type="button"
          disabled={running || !modelConfigured}
          aria-describedby={!modelConfigured ? resumeWarningId : undefined}
          onClick={onResume}
        >
          <RotateCcw size={12} aria-hidden="true" />
          {recoveryCopy.action}
        </button>
      </div>
    </section>
  );
}
