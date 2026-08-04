import { useRef, type ChangeEvent } from "react";
import { Download, KeyRound, ShieldCheck, Upload } from "lucide-react";

import {
  blueprintLibraryControlAvailability,
  type BlueprintLibraryControlAvailability,
} from "./plan-blueprint-panel-model";
import type {
  PlanBlueprintLibraryBusyAction,
  PlanBlueprintLibraryReceipt,
} from "./plan-blueprint-library-panel-types";
import { planCopy } from "./plan-copy";

export function PlanBlueprintLibraryControls({
  recordCount,
  canSave,
  canSelect,
  canSignPolicyOverrideRetirementProofBundle,
  busyAction,
  receipt,
  onRefresh,
  onSave,
  onSelect,
  onCalibrate,
  onBacktestPolicy,
  onApplyPolicyOverride,
  onReviewPolicyOverrideDrift,
  onRetirePolicyOverride,
  onAuditPolicyOverrideRetirements,
  onVerifyPolicyOverrideRetirements,
  onVerifyPolicyOverrideRetirementProofBundle,
  onSignPolicyOverrideRetirementProofBundle,
  onVerifyHistory,
  onVerifyOutcomes,
}: {
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
}) {
  const historyInput = useRef<HTMLInputElement>(null);
  const outcomesInput = useRef<HTMLInputElement>(null);
  const policyOverrideRetirementsInput = useRef<HTMLInputElement>(null);
  const policyOverrideRetirementProofBundleInput =
    useRef<HTMLInputElement>(null);
  const policyOverrideRetirementProofBundleSignInput =
    useRef<HTMLInputElement>(null);
  const availability = blueprintLibraryControlAvailability({
    busyAction,
    receipt,
  });
  return (
    <div className="fixture-actions">
      <button type="button" disabled={availability.busy} onClick={onRefresh}>
        <Download size={12} aria-hidden="true" />
        {busyAction === "load"
          ? planCopy.blueprint.library.refreshing
          : planCopy.blueprint.library.refresh}
      </button>
      <button
        className="fixture-verify"
        type="button"
        disabled={availability.busy || !canSelect || recordCount === 0}
        onClick={onSelect}
      >
        <ShieldCheck size={12} aria-hidden="true" />
        {busyAction === "select"
          ? planCopy.blueprint.library.selecting
          : planCopy.blueprint.library.select}
      </button>
      <button type="button" disabled={availability.busy} onClick={onCalibrate}>
        <ShieldCheck size={12} aria-hidden="true" />
        {busyAction === "calibratePortfolio"
          ? planCopy.blueprint.library.calibrating
          : planCopy.blueprint.library.calibrate}
      </button>
      <button
        type="button"
        disabled={availability.busy}
        onClick={onBacktestPolicy}
      >
        <ShieldCheck size={12} aria-hidden="true" />
        {busyAction === "backtestPolicy"
          ? planCopy.blueprint.library.backtestingPolicy
          : planCopy.blueprint.library.backtestPolicy}
      </button>
      <button
        type="button"
        disabled={availability.busy || !availability.canApplyPolicyOverride}
        onClick={onApplyPolicyOverride}
      >
        <ShieldCheck size={12} aria-hidden="true" />
        {busyAction === "applyPolicyOverride"
          ? planCopy.blueprint.library.applyingPolicyOverride
          : planCopy.blueprint.library.applyPolicyOverride}
      </button>
      <button
        type="button"
        disabled={availability.busy}
        onClick={onReviewPolicyOverrideDrift}
      >
        <ShieldCheck size={12} aria-hidden="true" />
        {busyAction === "reviewPolicyOverrideDrift"
          ? planCopy.blueprint.library.reviewingPolicyOverrideDrift
          : planCopy.blueprint.library.reviewPolicyOverrideDrift}
      </button>
      <button
        type="button"
        disabled={availability.busy || !availability.canRetirePolicyOverride}
        onClick={onRetirePolicyOverride}
      >
        <ShieldCheck size={12} aria-hidden="true" />
        {busyAction === "retirePolicyOverride"
          ? planCopy.blueprint.library.retiringPolicyOverride
          : planCopy.blueprint.library.retirePolicyOverride}
      </button>
      <button
        type="button"
        disabled={availability.busy}
        onClick={onAuditPolicyOverrideRetirements}
      >
        <ShieldCheck size={12} aria-hidden="true" />
        {busyAction === "auditPolicyOverrideRetirements"
          ? planCopy.blueprint.library.auditingPolicyOverrideRetirements
          : planCopy.blueprint.library.auditPolicyOverrideRetirements}
      </button>
      <FileButton
        inputRef={policyOverrideRetirementsInput}
        busy={availability.busy}
        label={
          busyAction === "verifyPolicyOverrideRetirements"
            ? planCopy.blueprint.library.verifyingPolicyOverrideRetirements
            : planCopy.blueprint.library.verifyPolicyOverrideRetirements
        }
      />
      <FileButton
        inputRef={policyOverrideRetirementProofBundleInput}
        busy={availability.busy}
        label={
          busyAction === "verifyPolicyOverrideRetirementProofBundle"
            ? planCopy.blueprint.library
                .verifyingPolicyOverrideRetirementProofBundle
            : planCopy.blueprint.library
                .verifyPolicyOverrideRetirementProofBundle
        }
      />
      <FileButton
        inputRef={policyOverrideRetirementProofBundleSignInput}
        busy={availability.busy}
        label={
          busyAction === "signPolicyOverrideRetirementProofBundle"
            ? planCopy.blueprint.library
                .signingPolicyOverrideRetirementProofBundle
            : planCopy.blueprint.library.signPolicyOverrideRetirementProofBundle
        }
        title={
          canSignPolicyOverrideRetirementProofBundle
            ? planCopy.blueprint.library.signPolicyOverrideRetirementProofBundle
            : planCopy.blueprint.library.errors
                .policyOverrideProofBundleNoSigner
        }
        icon="key"
      />
      <FileButton
        inputRef={historyInput}
        busy={availability.busy}
        label={
          busyAction === "verifyHistory"
            ? planCopy.blueprint.library.verifyingHistory
            : planCopy.blueprint.library.verifyHistory
        }
      />
      <button
        className="fixture-import"
        type="button"
        disabled={availability.busy || !canSave}
        onClick={onSave}
      >
        <Upload size={12} aria-hidden="true" />
        {busyAction === "save"
          ? planCopy.blueprint.library.saving
          : planCopy.blueprint.library.save}
      </button>
      <FileButton
        inputRef={outcomesInput}
        busy={availability.busy}
        label={
          busyAction === "verifyOutcomes"
            ? planCopy.blueprint.library.verifyingOutcomes
            : planCopy.blueprint.library.verifyOutcomes
        }
      />
      <input
        ref={historyInput}
        className="fixture-file-input"
        type="file"
        accept="application/json,.json"
        aria-label={planCopy.blueprint.library.verifyHistory}
        onChange={(event) => consumeSingleFile(event, onVerifyHistory)}
      />
      <input
        ref={policyOverrideRetirementsInput}
        className="fixture-file-input"
        type="file"
        accept="application/json,.json"
        aria-label={planCopy.blueprint.library.verifyPolicyOverrideRetirements}
        onChange={(event) =>
          consumeSingleFile(event, onVerifyPolicyOverrideRetirements)
        }
      />
      <input
        ref={policyOverrideRetirementProofBundleInput}
        className="fixture-file-input"
        type="file"
        accept="application/json,.json"
        multiple
        aria-label={
          planCopy.blueprint.library.verifyPolicyOverrideRetirementProofBundle
        }
        onChange={(event) =>
          consumeMultipleFiles(
            event,
            onVerifyPolicyOverrideRetirementProofBundle,
          )
        }
      />
      <input
        ref={policyOverrideRetirementProofBundleSignInput}
        className="fixture-file-input"
        type="file"
        accept="application/json,.json"
        multiple
        aria-label={
          planCopy.blueprint.library.signPolicyOverrideRetirementProofBundle
        }
        onChange={(event) =>
          consumeMultipleFiles(event, onSignPolicyOverrideRetirementProofBundle)
        }
      />
      <input
        ref={outcomesInput}
        className="fixture-file-input"
        type="file"
        accept="application/json,.json"
        aria-label={planCopy.blueprint.library.verifyOutcomes}
        onChange={(event) => consumeSingleFile(event, onVerifyOutcomes)}
      />
    </div>
  );
}

function FileButton({
  inputRef,
  busy,
  label,
  title,
  icon = "upload",
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  busy: BlueprintLibraryControlAvailability["busy"];
  label: string;
  title?: string;
  icon?: "upload" | "key";
}) {
  return (
    <button
      className="fixture-verify"
      type="button"
      disabled={busy}
      title={title}
      onClick={() => inputRef.current?.click()}
    >
      {icon === "key" ? (
        <KeyRound size={12} aria-hidden="true" />
      ) : (
        <Upload size={12} aria-hidden="true" />
      )}
      {label}
    </button>
  );
}

function consumeSingleFile(
  event: ChangeEvent<HTMLInputElement>,
  callback: (file: File) => void,
): void {
  const file = event.currentTarget.files?.[0];
  event.currentTarget.value = "";
  if (file) callback(file);
}

function consumeMultipleFiles(
  event: ChangeEvent<HTMLInputElement>,
  callback: (files: File[]) => void,
): void {
  const files = Array.from(event.currentTarget.files ?? []);
  event.currentTarget.value = "";
  if (files.length > 0) callback(files);
}
