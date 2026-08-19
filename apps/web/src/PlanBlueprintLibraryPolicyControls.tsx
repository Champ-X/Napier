import { ShieldCheck } from "lucide-react";

import type { BlueprintLibraryControlAvailability } from "./plan-blueprint-panel-model";
import type { PlanBlueprintLibraryBusyAction } from "./plan-blueprint-library-panel-types";
import { planCopy } from "./plan-copy";

export interface PlanBlueprintLibraryPolicyControlsProps {
  availability: BlueprintLibraryControlAvailability;
  busyAction: PlanBlueprintLibraryBusyAction | undefined;
  onCalibrate: () => void;
  onBacktestPolicy: () => void;
  onApplyPolicyOverride: () => void;
  onReviewPolicyOverrideDrift: () => void;
  onRetirePolicyOverride: () => void;
  onAuditPolicyOverrideRetirements: () => void;
}

interface PolicyAction {
  id: string;
  busyAction: PlanBlueprintLibraryBusyAction;
  label: string;
  busyLabel: string;
  disabled: boolean;
  onClick: () => void;
}

export function PlanBlueprintLibraryPolicyControls({
  availability,
  busyAction,
  onCalibrate,
  onBacktestPolicy,
  onApplyPolicyOverride,
  onReviewPolicyOverrideDrift,
  onRetirePolicyOverride,
  onAuditPolicyOverrideRetirements,
}: PlanBlueprintLibraryPolicyControlsProps) {
  const actions: PolicyAction[] = [
    {
      id: "calibrate",
      busyAction: "calibratePortfolio",
      label: planCopy.blueprint.library.calibrate,
      busyLabel: planCopy.blueprint.library.calibrating,
      disabled: availability.busy,
      onClick: onCalibrate,
    },
    {
      id: "backtest",
      busyAction: "backtestPolicy",
      label: planCopy.blueprint.library.backtestPolicy,
      busyLabel: planCopy.blueprint.library.backtestingPolicy,
      disabled: availability.busy,
      onClick: onBacktestPolicy,
    },
    {
      id: "apply-override",
      busyAction: "applyPolicyOverride",
      label: planCopy.blueprint.library.applyPolicyOverride,
      busyLabel: planCopy.blueprint.library.applyingPolicyOverride,
      disabled: availability.busy || !availability.canApplyPolicyOverride,
      onClick: onApplyPolicyOverride,
    },
    {
      id: "review-drift",
      busyAction: "reviewPolicyOverrideDrift",
      label: planCopy.blueprint.library.reviewPolicyOverrideDrift,
      busyLabel: planCopy.blueprint.library.reviewingPolicyOverrideDrift,
      disabled: availability.busy,
      onClick: onReviewPolicyOverrideDrift,
    },
    {
      id: "retire-override",
      busyAction: "retirePolicyOverride",
      label: planCopy.blueprint.library.retirePolicyOverride,
      busyLabel: planCopy.blueprint.library.retiringPolicyOverride,
      disabled: availability.busy || !availability.canRetirePolicyOverride,
      onClick: onRetirePolicyOverride,
    },
    {
      id: "audit-retirements",
      busyAction: "auditPolicyOverrideRetirements",
      label: planCopy.blueprint.library.auditPolicyOverrideRetirements,
      busyLabel: planCopy.blueprint.library.auditingPolicyOverrideRetirements,
      disabled: availability.busy,
      onClick: onAuditPolicyOverrideRetirements,
    },
  ];
  return (
    <>
      {actions.map((action) => {
        const active = busyAction === action.busyAction;
        return (
          <button
            key={action.id}
            type="button"
            disabled={action.disabled}
            aria-busy={active}
            onClick={action.onClick}
          >
            <ShieldCheck size={12} aria-hidden="true" />
            {active ? action.busyLabel : action.label}
          </button>
        );
      })}
    </>
  );
}
