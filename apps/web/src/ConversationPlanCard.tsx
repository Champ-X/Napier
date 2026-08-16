import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  ClipboardList,
  LoaderCircle,
  SkipForward,
} from "lucide-react";

import type { ConversationPlan } from "./conversation-plan-view-model";

export function ConversationPlanCard({ item }: { item: ConversationPlan }) {
  const tone = planTone(item);
  return (
    <details
      className={`conversation-plan status-${item.plan.status} tone-${tone}`}
      open={tone === "blocked"}
    >
      <summary>
        <ClipboardList size={15} aria-hidden="true" />
        <div>
          <span>
            {item.attemptScope === "current" ? "Current" : "Previous"} Plan ·{" "}
            {item.plan.status} · r{item.plan.revision}
          </span>
          <strong>{planSummary(item)}</strong>
        </div>
        <small>
          {item.settledStepCount}/{item.plan.steps.length} settled
        </small>
        <time dateTime={item.createdAt}>{formatTime(item.createdAt)}</time>
      </summary>
      <p className="conversation-plan-objective">{item.plan.objective}</p>
      <ol>
        {item.plan.steps.map((step) => (
          <li className={`status-${step.status}`} key={step.id}>
            <span>{stepIcon(step)}</span>
            <div>
              <strong>{step.title}</strong>
              <small>{stepStatusText(step)}</small>
            </div>
          </li>
        ))}
      </ol>
      <dl>
        {item.nextStep ? (
          <div>
            <dt>Next</dt>
            <dd>{item.nextStep.title}</dd>
          </div>
        ) : null}
        {item.blockedStep?.blocker ? (
          <div>
            <dt>Blocker</dt>
            <dd>{item.blockedStep.blocker}</dd>
          </div>
        ) : null}
        <div>
          <dt>Artifacts</dt>
          <dd>
            {item.verifiedArtifactCount} verified · {item.producedArtifactCount}{" "}
            produced · {item.missingArtifactCount} missing
          </dd>
        </div>
        <div>
          <dt>Phase</dt>
          <dd>
            {item.plan.activePhaseIndex === null
              ? "Settled"
              : `${item.plan.activePhaseIndex + 1}/${Math.max(
                  item.plan.phaseCount,
                  item.plan.activePhaseIndex + 1,
                )}`}
          </dd>
        </div>
      </dl>
    </details>
  );
}

function planTone(item: ConversationPlan): "working" | "blocked" | "completed" {
  if (item.plan.status === "blocked" || item.blockedStep) return "blocked";
  if (item.plan.status === "completed") return "completed";
  return "working";
}

function planSummary(item: ConversationPlan): string {
  if (item.blockedStep) return `Blocked · ${item.blockedStep.title}`;
  if (item.runningStep) return `Current · ${item.runningStep.title}`;
  if (item.plan.status === "completed") return "All planned steps settled";
  if (item.nextStep) return `Next · ${item.nextStep.title}`;
  return "Plan is waiting for the next transition";
}

function stepIcon(step: ConversationPlan["plan"]["steps"][number]) {
  if (step.status === "completed") {
    return <CheckCircle2 size={13} aria-hidden="true" />;
  }
  if (step.status === "running") {
    return (
      <LoaderCircle className="is-spinning" size={13} aria-hidden="true" />
    );
  }
  if (step.status === "blocked") {
    return <AlertTriangle size={13} aria-hidden="true" />;
  }
  if (step.status === "skipped") {
    return <SkipForward size={13} aria-hidden="true" />;
  }
  return <Circle size={13} aria-hidden="true" />;
}

function stepStatusText(
  step: ConversationPlan["plan"]["steps"][number],
): string {
  if (step.status === "blocked" && step.blocker) return step.blocker;
  if (step.status === "completed" && step.evidenceRecorded) {
    return "Evidence recorded";
  }
  return step.status;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
