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
  return (
    <section className="recovery-banner" aria-labelledby="recovery-title">
      <div className="recovery-mark" aria-hidden="true">
        <RotateCcw size={16} />
      </div>
      <div>
        <span>{copy.recovery.eyebrow}</span>
        <h2 id="recovery-title">{copy.recovery.title}</h2>
        <p>{copy.recovery.body}</p>
        <code>
          {copy.recovery.run}: {run.id}
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
          {copy.recovery.action}
        </button>
      </div>
    </section>
  );
}
