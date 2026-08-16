import { lazy, Suspense } from "react";

import type { ExecutionPlan, RunEvent } from "@napier/contracts";
import { copy } from "./copy";
import type { InspectorTab } from "./use-workspace-view-model";

const LazyPlanPanel = lazy(() => import("./PlanPanel"));

export function PlanInspectorSurface({
  surface,
  ...props
}: {
  surface: InspectorTab;
  threadId: string | undefined;
  plans: ExecutionPlan[];
  events: RunEvent[];
  running: boolean;
  selectedModelKey: string;
  selectedModelConfigured: boolean;
  onContinue: () => void;
  onDraftApplied: () => void | Promise<void>;
  onOpenThread: (threadId: string) => void | Promise<void>;
}) {
  if (surface !== "plan" && surface !== "studio") return null;
  return (
    <div className={`plan-inspector-surface surface-${surface}`}>
      {surface === "studio" ? (
        <header className="plan-studio-heading">
          <span>STUDIO / ADVANCED</span>
          <h2>Workflow studio</h2>
          <p>Experiments, portable plans, templates, and policy evidence.</p>
        </header>
      ) : null}
      <Suspense
        fallback={
          <div className="context-loading" role="status">
            {copy.planLoading}
          </div>
        }
      >
        <LazyPlanPanel {...props} />
      </Suspense>
    </div>
  );
}
