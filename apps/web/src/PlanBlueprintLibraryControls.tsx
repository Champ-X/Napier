import { Download, ShieldCheck, Upload } from "lucide-react";

import { blueprintLibraryControlAvailability } from "./plan-blueprint-panel-model";
import { PlanBlueprintLibraryFileControls } from "./PlanBlueprintLibraryFileControls";
import { PlanBlueprintLibraryPolicyControls } from "./PlanBlueprintLibraryPolicyControls";
import type {
  PlanBlueprintLibraryBusyAction,
  PlanBlueprintLibraryReceipt,
} from "./plan-blueprint-library-panel-types";
import { planCopy } from "./plan-copy";

export interface PlanBlueprintLibraryControlsProps {
  recordCount: number;
  canSave: boolean;
  canSelect: boolean;
  canSignPolicyOverrideRetirementProofBundle: boolean;
  busyAction: PlanBlueprintLibraryBusyAction | undefined;
  receipt: PlanBlueprintLibraryReceipt | undefined;
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
  onVerifyHistory: (file: File) => void;
  onVerifyOutcomes: (file: File) => void;
}

export function PlanBlueprintLibraryControls(
  props: PlanBlueprintLibraryControlsProps,
) {
  const busyAction = props.busyAction;
  const availability = blueprintLibraryControlAvailability({
    busyAction,
    receipt: props.receipt,
  });
  return (
    <div className="fixture-actions">
      <button
        type="button"
        disabled={availability.busy}
        aria-busy={busyAction === "load"}
        onClick={props.onRefresh}
      >
        <Download size={12} aria-hidden="true" />
        {busyAction === "load"
          ? planCopy.blueprint.library.refreshing
          : planCopy.blueprint.library.refresh}
      </button>
      <button
        className="fixture-verify"
        type="button"
        disabled={
          availability.busy || !props.canSelect || props.recordCount === 0
        }
        aria-busy={busyAction === "select"}
        onClick={props.onSelect}
      >
        <ShieldCheck size={12} aria-hidden="true" />
        {busyAction === "select"
          ? planCopy.blueprint.library.selecting
          : planCopy.blueprint.library.select}
      </button>
      <PlanBlueprintLibraryPolicyControls
        availability={availability}
        busyAction={busyAction}
        onCalibrate={props.onCalibrate}
        onBacktestPolicy={props.onBacktestPolicy}
        onApplyPolicyOverride={props.onApplyPolicyOverride}
        onReviewPolicyOverrideDrift={props.onReviewPolicyOverrideDrift}
        onRetirePolicyOverride={props.onRetirePolicyOverride}
        onAuditPolicyOverrideRetirements={
          props.onAuditPolicyOverrideRetirements
        }
      />
      <PlanBlueprintLibraryFileControls
        busyAction={busyAction}
        canSignPolicyOverrideRetirementProofBundle={
          props.canSignPolicyOverrideRetirementProofBundle
        }
        onVerifyPolicyOverrideRetirements={
          props.onVerifyPolicyOverrideRetirements
        }
        onVerifyPolicyOverrideRetirementProofBundle={
          props.onVerifyPolicyOverrideRetirementProofBundle
        }
        onSignPolicyOverrideRetirementProofBundle={
          props.onSignPolicyOverrideRetirementProofBundle
        }
        onVerifyHistory={props.onVerifyHistory}
        onVerifyOutcomes={props.onVerifyOutcomes}
      />
      <button
        className="fixture-import"
        type="button"
        disabled={availability.busy || !props.canSave}
        aria-busy={busyAction === "save"}
        onClick={props.onSave}
      >
        <Upload size={12} aria-hidden="true" />
        {busyAction === "save"
          ? planCopy.blueprint.library.saving
          : planCopy.blueprint.library.save}
      </button>
    </div>
  );
}
