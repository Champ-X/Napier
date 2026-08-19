import { Download, ShieldCheck } from "lucide-react";

import type {
  ExecutionPlanBlueprintRecord,
  ExecutionPlanBlueprintRecordOutcomeReview,
} from "@napier/contracts";

import { PlanBlueprintLibraryControls } from "./PlanBlueprintLibraryControls";
import { PlanBlueprintLibraryReceiptView } from "./PlanBlueprintLibraryReceiptView";
import { PlanBlueprintRecordList } from "./PlanBlueprintRecordList";
import { blueprintLibraryRecordCounts } from "./plan-blueprint-panel-model";
import type {
  PlanBlueprintLibraryBusyAction,
  PlanBlueprintLibraryReceipt,
} from "./plan-blueprint-library-panel-types";
import { planCopy } from "./plan-copy";
import "./plan-blueprint-library.css";
import "./plan-blueprint-record.css";

export interface PlanBlueprintLibraryCardState {
  records: ExecutionPlanBlueprintRecord[];
  loaded: boolean;
  hasVerifiedBlueprint: boolean;
  canSave: boolean;
  canSelect: boolean;
  canSignPolicyOverrideRetirementProofBundle: boolean;
  canCreateRecord: boolean;
  busyAction: PlanBlueprintLibraryBusyAction | undefined;
  receipt: PlanBlueprintLibraryReceipt | undefined;
  latestOutcomeReview: ExecutionPlanBlueprintRecordOutcomeReview | undefined;
  error: string | undefined;
  selectedModelConfigured: boolean;
}

export interface PlanBlueprintLibraryCardActions {
  onRefresh: () => void;
  onSave: () => void;
  onSelect: () => void;
  onCalibrate: () => void;
  onBacktestPolicy: () => void;
  onApplyPolicyOverride: () => void;
  onReviewPolicyOverrideDrift: () => void;
  onRetirePolicyOverride: () => void;
  onAuditPolicyOverrideRetirements: () => void;
  onVerifyPolicyOverrideRetirements: (file: File) => void;
  onVerifyPolicyOverrideRetirementProofBundle: (files: File[]) => void;
  onSignPolicyOverrideRetirementProofBundle: (files: File[]) => void;
  onArchive: (record: ExecutionPlanBlueprintRecord) => void;
  onRestore: (record: ExecutionPlanBlueprintRecord) => void;
  onQualify: (record: ExecutionPlanBlueprintRecord) => void;
  onPreview: (record: ExecutionPlanBlueprintRecord) => void;
  onHistory: (record: ExecutionPlanBlueprintRecord) => void;
  onVerifyHistory: (file: File) => void;
  onOutcomes: (record: ExecutionPlanBlueprintRecord) => void;
  onVerifyOutcomes: (file: File) => void;
  onPromoteOutcomeBaseline: (record: ExecutionPlanBlueprintRecord) => void;
  onPromoteReviewedOutcomeBaseline: (
    record: ExecutionPlanBlueprintRecord,
  ) => void;
  onQualifyOutcomes: (record: ExecutionPlanBlueprintRecord) => void;
  onReviewOutcomes: (record: ExecutionPlanBlueprintRecord) => void;
  onCreate: (record: ExecutionPlanBlueprintRecord) => void;
}

export interface PlanBlueprintLibraryCardProps {
  state: PlanBlueprintLibraryCardState;
  actions: PlanBlueprintLibraryCardActions;
}

export function PlanBlueprintLibraryCard({
  state,
  actions,
}: PlanBlueprintLibraryCardProps) {
  const modelReviewWarningId = "plan-blueprint-model-unavailable";
  return (
    <section
      className="fixture-docket plan-blueprint-library-card"
      aria-labelledby="plan-blueprint-library-title"
    >
      <PlanBlueprintLibraryOverview
        state={state}
        actions={actions}
        modelReviewWarningId={modelReviewWarningId}
      />
      <PlanBlueprintRecordList
        records={state.records}
        loaded={state.loaded}
        canCreateRecord={state.canCreateRecord}
        busyAction={state.busyAction}
        latestOutcomeReview={state.latestOutcomeReview}
        selectedModelConfigured={state.selectedModelConfigured}
        modelReviewWarningId={modelReviewWarningId}
        onArchive={actions.onArchive}
        onRestore={actions.onRestore}
        onQualify={actions.onQualify}
        onPreview={actions.onPreview}
        onHistory={actions.onHistory}
        onOutcomes={actions.onOutcomes}
        onPromoteOutcomeBaseline={actions.onPromoteOutcomeBaseline}
        onPromoteReviewedOutcomeBaseline={
          actions.onPromoteReviewedOutcomeBaseline
        }
        onQualifyOutcomes={actions.onQualifyOutcomes}
        onReviewOutcomes={actions.onReviewOutcomes}
        onCreate={actions.onCreate}
      />
      <p className="fixture-safety">
        <ShieldCheck size={13} aria-hidden="true" />
        {planCopy.blueprint.library.safety}
      </p>
    </section>
  );
}
export interface PlanBlueprintLibraryOverviewProps extends PlanBlueprintLibraryCardProps {
  modelReviewWarningId: string;
}

function PlanBlueprintLibraryOverview({
  state,
  actions,
  modelReviewWarningId,
}: PlanBlueprintLibraryOverviewProps) {
  return (
    <>
      <header>
        <div>
          <span>{planCopy.blueprint.library.eyebrow}</span>
          <h3 id="plan-blueprint-library-title">
            {planCopy.blueprint.library.title}
          </h3>
        </div>
        <Download size={14} aria-hidden="true" />
      </header>
      <p>{planCopy.blueprint.library.body}</p>
      {!state.selectedModelConfigured ? (
        <p
          id={modelReviewWarningId}
          className="plan-review-error"
          role="status"
        >
          {planCopy.modelUnavailableHint}
        </p>
      ) : null}
      <PlanBlueprintLibraryControls
        recordCount={state.records.length}
        canSave={state.canSave}
        canSelect={state.canSelect}
        canSignPolicyOverrideRetirementProofBundle={
          state.canSignPolicyOverrideRetirementProofBundle
        }
        busyAction={state.busyAction}
        receipt={state.receipt}
        onRefresh={actions.onRefresh}
        onSave={actions.onSave}
        onSelect={actions.onSelect}
        onCalibrate={actions.onCalibrate}
        onBacktestPolicy={actions.onBacktestPolicy}
        onApplyPolicyOverride={actions.onApplyPolicyOverride}
        onReviewPolicyOverrideDrift={actions.onReviewPolicyOverrideDrift}
        onRetirePolicyOverride={actions.onRetirePolicyOverride}
        onAuditPolicyOverrideRetirements={
          actions.onAuditPolicyOverrideRetirements
        }
        onVerifyPolicyOverrideRetirements={
          actions.onVerifyPolicyOverrideRetirements
        }
        onVerifyPolicyOverrideRetirementProofBundle={
          actions.onVerifyPolicyOverrideRetirementProofBundle
        }
        onSignPolicyOverrideRetirementProofBundle={
          actions.onSignPolicyOverrideRetirementProofBundle
        }
        onVerifyHistory={actions.onVerifyHistory}
        onVerifyOutcomes={actions.onVerifyOutcomes}
      />
      <PlanBlueprintLibraryStatus state={state} />
      {state.receipt ? (
        <PlanBlueprintLibraryReceiptView receipt={state.receipt} />
      ) : null}
      {state.error ? <p className="plan-review-error">{state.error}</p> : null}
    </>
  );
}

export interface PlanBlueprintLibraryStatusProps {
  state: PlanBlueprintLibraryCardState;
}

function PlanBlueprintLibraryStatus({
  state,
}: PlanBlueprintLibraryStatusProps) {
  const counts = blueprintLibraryRecordCounts(state.records);
  return (
    <>
      {!state.hasVerifiedBlueprint ? (
        <small className="blueprint-library-hint">
          {planCopy.blueprint.library.noVerified}
        </small>
      ) : null}
      {state.loaded ? (
        <div className="blueprint-library-summary">
          <span>
            {state.records.length.toLocaleString()}{" "}
            {planCopy.blueprint.library.records}
          </span>
          <span>
            {counts.active.toLocaleString()} {planCopy.blueprint.library.active}
          </span>
          <span>
            {counts.archived.toLocaleString()}{" "}
            {planCopy.blueprint.library.archived}
          </span>
        </div>
      ) : null}
    </>
  );
}
