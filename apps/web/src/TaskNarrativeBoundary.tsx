import { lazy, Suspense } from "react";

import type { ThreadDetail } from "@napier/contracts";

const LazyTaskNarrativeBar = lazy(() => import("./TaskNarrativeBar"));

export function TaskNarrativeBoundary({
  detail,
}: {
  detail: ThreadDetail | undefined;
}) {
  return (
    <Suspense
      fallback={<section className="task-narrative" aria-label="Task status" />}
    >
      <LazyTaskNarrativeBar detail={detail} />
    </Suspense>
  );
}
