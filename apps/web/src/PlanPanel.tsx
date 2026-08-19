import { ChevronRight, ShieldCheck } from "lucide-react";

import type { ExecutionPlan, RunEvent } from "@napier/contracts";

import { PlanArtifactManifest } from "./PlanArtifactManifest";
import { PlanBlueprintLibraryCard } from "./PlanBlueprintLibraryCard";
import { PlanCurrentSheet } from "./PlanCurrentSheet";
import {
  PlanArchiveCard,
  PlanBlueprintCard,
} from "./PlanPortableEvidenceCards";
import { planCopy } from "./plan-copy";
import { currentPlan } from "./plan-panel-helpers";
import { usePlanArtifactController } from "./use-plan-artifact-controller";
import { usePlanBlueprintLibraryController } from "./use-plan-blueprint-library-controller";
import { usePlanPortableEvidenceController } from "./use-plan-portable-evidence-controller";
import { usePlanReplanController } from "./use-plan-replan-controller";
import WorkflowWorkbenchSlot from "./WorkflowWorkbenchSlot";
import "./plan-panel-interactions.css";

export interface PlanPanelProps {
  threadId: string | undefined;
  plans: ExecutionPlan[];
  events: RunEvent[];
  running: boolean;
  selectedModelKey: string;
  selectedModelConfigured: boolean;
  onContinue: () => void;
  onDraftApplied: () => void | Promise<void>;
  onOpenThread: (threadId: string) => void | Promise<void>;
}

export default function PlanPanel({
  threadId,
  plans,
  events,
  running,
  selectedModelKey,
  selectedModelConfigured,
  onContinue,
  onDraftApplied,
  onOpenThread,
}: PlanPanelProps) {
  const plan = currentPlan(plans);
  const readyStep =
    plan?.steps.find((step) => step.id === plan.readyStepIds[0]) ??
    plan?.steps.find((step) => step.status === "ready");
  const hasOpenPlan = plans.some(
    (candidate) =>
      candidate.status === "active" || candidate.status === "blocked",
  );
  const resetKey = plan?.replanRecommendation?.recommendationSha256;
  const replan = usePlanReplanController({
    plan,
    recommendation: plan?.replanRecommendation ?? undefined,
    selectedModelKey,
    selectedModelConfigured,
    onChanged: onDraftApplied,
  });
  const artifact = usePlanArtifactController({
    threadId,
    plan,
    resetKey,
    onChanged: onDraftApplied,
  });
  const portable = usePlanPortableEvidenceController({
    threadId,
    plan,
    hasOpenPlan,
    resetKey,
    onChanged: onDraftApplied,
  });
  const library = usePlanBlueprintLibraryController({
    threadId,
    verifiedBlueprint: portable.blueprint.verifiedBlueprint,
    hasOpenPlan,
    selectedModelKey,
    selectedModelConfigured,
    onChanged: onDraftApplied,
  });

  return (
    <section className="panel-section plan-panel" aria-labelledby="plan-title">
      <div className="panel-heading">
        <div>
          <span>{planCopy.eyebrow}</span>
          <h2 id="plan-title">{planCopy.title}</h2>
        </div>
        <span className="plan-count">
          {plans.length} {planCopy.count}
        </span>
      </div>
      <WorkflowWorkbenchSlot
        threadId={threadId}
        plans={plans}
        events={events}
        running={running}
        selectedModelKey={selectedModelKey}
        selectedModelConfigured={selectedModelConfigured}
        onWorkflowSettled={onDraftApplied}
        onOpenThread={onOpenThread}
      />
      {!plan ? (
        <p className="empty-panel">{planCopy.empty}</p>
      ) : (
        <>
          <PlanCurrentSheet
            plan={plan}
            running={running}
            selectedModelConfigured={selectedModelConfigured}
            replan={replan}
            onContinue={onContinue}
          />
          <PlanArchiveCard
            receipt={portable.archive.receipt}
            busyAction={portable.archive.busyAction}
            error={portable.archive.error}
            onExport={() => void portable.archive.onExport()}
            onVerify={(file) => void portable.archive.onVerify(file)}
          />
        </>
      )}
      <PlanBlueprintCard
        hasPlan={Boolean(plan)}
        canCreate={Boolean(
          threadId && portable.blueprint.verifiedBlueprint && !hasOpenPlan,
        )}
        receipt={portable.blueprint.receipt}
        busyAction={portable.blueprint.busyAction}
        error={portable.blueprint.error}
        onExport={() => void portable.blueprint.onExport()}
        onVerify={(file) => void portable.blueprint.onVerify(file)}
        onCreate={() => void portable.blueprint.onCreate()}
      />
      <PlanBlueprintLibraryCard {...library} />
      {plan ? (
        <>
          <PlanArtifactManifest
            artifacts={plan.artifacts}
            latestReplan={plan.replans.at(-1)}
            {...artifact}
          />
          <button
            className="plan-continue"
            type="button"
            disabled={!readyStep || running || plan.status !== "active"}
            aria-busy={running}
            onClick={onContinue}
          >
            <ChevronRight size={13} aria-hidden="true" />
            {readyStep ? planCopy.next : planCopy.noReady}
          </button>
        </>
      ) : null}
      <p className="guardrail-note">
        <ShieldCheck size={13} aria-hidden="true" />
        {planCopy.safety}
      </p>
    </section>
  );
}
