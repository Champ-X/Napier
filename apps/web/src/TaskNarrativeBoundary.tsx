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
