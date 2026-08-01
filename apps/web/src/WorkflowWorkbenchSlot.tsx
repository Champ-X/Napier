import { lazy, Suspense } from "react";

import type { ExecutionPlan, RunEvent } from "@napier/contracts";

import { workflowBreakpointCopy as copy } from "./workflow-breakpoint-copy";
import { projectWorkflowBreakpoint } from "./workflow-breakpoint-view-model";
import "./workflow-workbench.css";

const LazyWorkflowBreakpointDesk = lazy(
  () => import("./WorkflowBreakpointDesk"),
);
const LazyWorkflowExperimentDesk = lazy(
  () => import("./WorkflowExperimentDesk"),
);

export default function WorkflowWorkbenchSlot({
  threadId,
  plans,
  events,
  running,
  selectedModelKey,
  selectedModelConfigured,
  onWorkflowSettled,
  onOpenThread,
}: {
  threadId: string | undefined;
  plans: ExecutionPlan[];
  events: RunEvent[];
  running: boolean;
  selectedModelKey: string;
  selectedModelConfigured: boolean;
  onWorkflowSettled: () => void | Promise<void>;
  onOpenThread: (threadId: string) => void | Promise<void>;
}) {
  if (!threadId || plans.length === 0) return null;
  const breakpoint = projectWorkflowBreakpoint(plans, events);
  return (
    <>
      {breakpoint.status === "invalid" ? (
        <p className="workflow-breakpoint-invalid" role="alert">
          {copy.errors.evidenceInvalid} ({breakpoint.reason})
        </p>
      ) : null}
      {breakpoint.status === "open" ? (
        <Suspense fallback={null}>
          <LazyWorkflowBreakpointDesk
            threadId={threadId}
            breakpoint={breakpoint.breakpoint}
            running={running}
            onSettled={onWorkflowSettled}
          />
        </Suspense>
      ) : null}
      <Suspense fallback={null}>
        <LazyWorkflowExperimentDesk
          threadId={threadId}
          plans={plans}
          running={running}
          selectedModelKey={selectedModelKey}
          selectedModelConfigured={selectedModelConfigured}
          onOpenThread={onOpenThread}
        />
      </Suspense>
    </>
  );
}
