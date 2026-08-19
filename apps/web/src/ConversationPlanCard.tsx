import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  ClipboardList,
  LoaderCircle,
  SkipForward,
} from "lucide-react";

import type { ConversationPlan } from "./conversation-plan-view-model";
import { getLocale } from "./locale";
import { taskSurfaceCopy } from "./task-surface-copy";

export interface ConversationPlanCardProps {
  item: ConversationPlan;
}

export function ConversationPlanCard({ item }: ConversationPlanCardProps) {
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
            {item.attemptScope === "current"
              ? taskSurfaceCopy.plan.current
              : taskSurfaceCopy.plan.previous}{" "}
            {taskSurfaceCopy.plan.label} ·{" "}
            {taskSurfaceCopy.plan.statuses[item.plan.status]} · r
            {item.plan.revision}
          </span>
          <strong>{planSummary(item)}</strong>
        </div>
        <small>
          {item.settledStepCount}/{item.plan.steps.length}{" "}
          {taskSurfaceCopy.plan.settled}
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
            <dt>{taskSurfaceCopy.plan.next}</dt>
            <dd>{item.nextStep.title}</dd>
          </div>
        ) : null}
        {item.blockedStep?.blocker ? (
          <div>
            <dt>{taskSurfaceCopy.plan.blocker}</dt>
            <dd>{item.blockedStep.blocker}</dd>
          </div>
        ) : null}
        <div>
          <dt>{taskSurfaceCopy.plan.artifacts}</dt>
          <dd>
            {item.verifiedArtifactCount} {taskSurfaceCopy.plan.verified} ·{" "}
            {item.producedArtifactCount} {taskSurfaceCopy.plan.produced} ·{" "}
            {item.missingArtifactCount} {taskSurfaceCopy.plan.missing}
          </dd>
        </div>
        <div>
          <dt>{taskSurfaceCopy.plan.phase}</dt>
          <dd>
            {item.plan.activePhaseIndex === null
              ? taskSurfaceCopy.plan.settledPhase
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
  if (item.blockedStep)
    return `${taskSurfaceCopy.plan.statuses.blocked} · ${item.blockedStep.title}`;
  if (item.runningStep)
    return `${taskSurfaceCopy.plan.current} · ${item.runningStep.title}`;
  if (item.plan.status === "completed") return taskSurfaceCopy.plan.allSettled;
  if (item.nextStep)
    return `${taskSurfaceCopy.plan.next} · ${item.nextStep.title}`;
  return taskSurfaceCopy.plan.waiting;
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
    return taskSurfaceCopy.plan.evidenceRecorded;
  }
  return taskSurfaceCopy.plan.statuses[step.status];
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(getLocale() === "zh" ? "zh-CN" : "en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
