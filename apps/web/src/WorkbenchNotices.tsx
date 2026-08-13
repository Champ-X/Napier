import { AlertCircle } from "lucide-react";

import type { RunRecord } from "@napier/contracts";
import { RecoveryBanner } from "./RecoveryBanner";

export function WorkbenchNotices({
  error,
  resumableRun,
  running,
  modelConfigured,
  onResume,
}: {
  error: string | undefined;
  resumableRun: RunRecord | undefined;
  running: boolean;
  modelConfigured: boolean;
  onResume: () => void;
}) {
  return (
    <div className="workbench-notices">
      {error ? (
        <div className="error-banner" role="alert">
          <AlertCircle size={16} aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}
      {resumableRun ? (
        <RecoveryBanner
          run={resumableRun}
          running={running}
          modelConfigured={modelConfigured}
          onResume={onResume}
        />
      ) : null}
    </div>
  );
}

export default WorkbenchNotices;
