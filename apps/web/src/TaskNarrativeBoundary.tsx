import { lazy, Suspense } from "react";

import type { ThreadDetail } from "@napier/contracts";

const LazyTaskNarrativeBar = lazy(() => import("./TaskNarrativeBar"));

export function TaskNarrativeBoundary({
  detail,
  browserControlsAvailable,
  onOpenArtifact,
  onOpenBrowserControls,
  onStop,
}: {
  detail: ThreadDetail | undefined;
  browserControlsAvailable: boolean;
  onOpenArtifact(path: string): void;
  onOpenBrowserControls(): void;
  onStop(): void;
}) {
  // No active thread: skip the status strip entirely so the empty workspace
  // stays a calm, centered welcome instead of a stray "Ready" bar.
  if (!detail) return null;
  return (
    <Suspense
      fallback={<section className="task-narrative" aria-label="Task status" />}
    >
      <LazyTaskNarrativeBar
        detail={detail}
        browserControlsAvailable={browserControlsAvailable}
        onOpenArtifact={onOpenArtifact}
        onOpenBrowserControls={onOpenBrowserControls}
        onStop={onStop}
      />
    </Suspense>
  );
}
