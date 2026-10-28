import type { ExecutionPlan, RunEvent } from "@napier/contracts";
import { useWorkflowRecovery } from "./use-workflow-recovery";
import { workflowRecoveryCopy as copy } from "./workflow-recovery-copy";
import "./workflow-recovery.css";

export function isWorkflowPlan(planId: string | undefined, events: RunEvent[]) {
  return (
    Boolean(planId) &&
    events.some((event) => {
      const payload = event.payload;
      return (
        event.type === "workflow.started" &&
        payload &&
        typeof payload === "object" &&
        !Array.isArray(payload) &&
        payload["planId"] === planId
      );
    })
  );
}

export function WorkflowRecoveryPanel(props: {
  workspaceKey: string;
  threadId: string;
  plan: ExecutionPlan;
  eventCount: number;
  running: boolean;
  onSettled(): void | Promise<void>;
  onReviewDecision(): void;
}) {
  const state = useWorkflowRecovery({
    ...props,
    planId: props.plan.id,
    revision: props.plan.revision,
  });
  const checkpoint = state.checkpoint;
  const unavailable =
    props.running ||
    state.working ||
    state.loading ||
    checkpoint?.status !== "ready";
  return (
    <section
      className="workflow-recovery"
      aria-label={copy.title}
      aria-busy={state.working}
    >
      <h3>{checkpoint?.name ?? copy.title}</h3>
      <p>
        {state.loading && !checkpoint
          ? copy.loading
          : checkpoint?.reason
            ? copy.reasons[checkpoint.reason]
            : copy.status[checkpoint?.status ?? "unavailable"]}
      </p>
      {state.error ? (
        <p className="workflow-recovery-error" role="alert">
          {copy.failure}
        </p>
      ) : null}
      <div className="workflow-recovery-actions">
        {checkpoint?.manifestSha256 || state.working ? (
          <button
            type="button"
            className="workflow-recovery-primary"
            aria-disabled={
              checkpoint?.status !== "waiting_answer" && unavailable
            }
            onClick={() => {
              if (checkpoint?.status === "waiting_answer")
                props.onReviewDecision();
              else if (!unavailable) void state.continueWorkflow();
            }}
          >
            {state.working
              ? copy.working
              : checkpoint?.status === "waiting_answer"
                ? copy.answer
                : checkpoint?.status === "completed"
                  ? copy.finished
                  : copy.actions[checkpoint?.action ?? "resume"]}
          </button>
        ) : null}
        <button
          type="button"
          disabled={state.working || state.loading}
          onClick={() => void state.refresh()}
        >
          {copy.refresh}
        </button>
      </div>
      <details>
        <summary>{copy.details}</summary>
        <p>
          <code>{props.plan.id}</code>
        </p>
        {checkpoint?.checkpointSha256 ? (
          <p>
            <code>{checkpoint.checkpointSha256}</code>
          </p>
        ) : null}
      </details>
    </section>
  );
}
