import { lazy, Suspense } from "react";

import { copy } from "./copy";
import type { WebThreadDetail } from "./api";

const LazyAgentMessageExperimentDesk = lazy(
  () => import("./AgentMessageExperimentDesk"),
);
const LazyModelInvocationExperimentDesk = lazy(
  () => import("./ModelInvocationExperimentDesk"),
);
const LazyToolInvocationExperimentDesk = lazy(
  () => import("./ToolInvocationExperimentDesk"),
);

export interface RunLabExperimentDesksProps {
  detail: WebThreadDetail;
  running: boolean;
  selectedModelKey: string;
  selectedModelConfigured: boolean;
  onOpenThread(threadId: string): void | Promise<void>;
}

export function RunLabExperimentDesks({
  detail,
  running,
  selectedModelKey,
  selectedModelConfigured,
  onOpenThread,
}: RunLabExperimentDesksProps) {
  return (
    <Suspense
      fallback={
        <div className="context-loading" role="status">
          {copy.lab.title}
        </div>
      }
    >
      <LazyAgentMessageExperimentDesk
        detail={detail}
        running={running}
        selectedModelKey={selectedModelKey}
        selectedModelConfigured={selectedModelConfigured}
        onOpenThread={onOpenThread}
      />
      <LazyModelInvocationExperimentDesk
        detail={detail}
        running={running}
        selectedModelKey={selectedModelKey}
        selectedModelEligible={
          selectedModelConfigured && selectedModelKey !== "napier/demo"
        }
        onOpenThread={onOpenThread}
      />
      <LazyToolInvocationExperimentDesk
        detail={detail}
        running={running}
        onOpenThread={onOpenThread}
      />
    </Suspense>
  );
}
