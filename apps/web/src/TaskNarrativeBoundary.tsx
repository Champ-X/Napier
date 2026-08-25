import { lazy, Suspense } from "react";

import type { ThreadDetail } from "@napier/contracts";
import { shellCopy } from "./shell-copy";
import "./task-narrative.css";

const LazyTaskNarrativeBar = lazy(() =>
  import("./TaskNarrativeBar").then(({ TaskNarrativeBar }) => ({
    default: TaskNarrativeBar,
  })),
);

export interface TaskNarrativeBoundaryProps {
  detail: ThreadDetail | undefined;
  browserControlsAvailable: boolean;
  onOpenBrowserControls(): void;
  onStop(): void;
}

export function TaskNarrativeBoundary({
  detail,
  browserControlsAvailable,
  onOpenBrowserControls,
  onStop,
}: TaskNarrativeBoundaryProps) {
  // No active thread: skip the status strip entirely so the empty workspace
  // stays a calm, centered welcome instead of a stray "Ready" bar.
  if (!detail) return null;
  return (
    <Suspense
      fallback={
        <section
          className="task-narrative"
          aria-label={shellCopy.taskNarrative.status}
        />
      }
    >
      <LazyTaskNarrativeBar
        detail={detail}
        browserControlsAvailable={browserControlsAvailable}
        onOpenBrowserControls={onOpenBrowserControls}
        onStop={onStop}
      />
    </Suspense>
  );
}
