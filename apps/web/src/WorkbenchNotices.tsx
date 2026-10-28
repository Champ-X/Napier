import { AlertCircle } from "lucide-react";

import { RecoveryBanner, type RecoveryBannerProps } from "./RecoveryBanner";

export function WorkbenchNotices({
  error,
  recovery,
}: {
  error: string | undefined;
  recovery: RecoveryBannerProps | undefined;
}) {
  return (
    <div className="workbench-notices">
      {error ? (
        <div className="error-banner" role="alert">
          <AlertCircle size={16} aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}
      {recovery ? <RecoveryBanner {...recovery} /> : null}
    </div>
  );
}
