import { AlertTriangle, ShieldCheck } from "lucide-react";

import type { ThreadDetail } from "@napier/contracts";

import { copy } from "./copy";
import { environmentDegradationView } from "./environment-degradation-view";
import "./environment-degradation-notice.css";

export interface EnvironmentDegradationNoticeProps {
  detail: Pick<ThreadDetail, "thread" | "runs" | "events"> | undefined;
}

export function EnvironmentDegradationNotice({
  detail,
}: EnvironmentDegradationNoticeProps) {
  const view = environmentDegradationView(detail);
  if (!view) return null;
  return (
    <span
      className="environment-degradation-notice"
      aria-label={`${copy.narrative.environmentFallback}. ${copy.narrative.environmentFallbackBody} ${copy.narrative.environmentRepair}`}
      title={`${copy.narrative.environmentFallbackBody} ${copy.narrative.environmentRepair}`}
      role="status"
    >
      <AlertTriangle size={14} aria-hidden="true" />
      <strong>{copy.narrative.environmentFallback}</strong>
      <span className="environment-degradation-tools">
        <ShieldCheck size={12} aria-hidden="true" />
        {view.activeToolCount} / {view.configuredToolCount}{" "}
        {copy.narrative.environmentToolsActive}
      </span>
      <span className="environment-degradation-repair">
        {copy.narrative.environmentRepair}
      </span>
    </span>
  );
}
