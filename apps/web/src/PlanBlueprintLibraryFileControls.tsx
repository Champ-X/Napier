import { useRef, type ChangeEvent, type RefObject } from "react";
import { KeyRound, Upload } from "lucide-react";

import type { PlanBlueprintLibraryBusyAction } from "./plan-blueprint-library-panel-types";
import { planCopy } from "./plan-copy";

export interface PlanBlueprintLibraryFileControlsProps {
  busyAction: PlanBlueprintLibraryBusyAction | undefined;
  canSignPolicyOverrideRetirementProofBundle: boolean;
  onVerifyPolicyOverrideRetirements: (file: File) => void;
  onVerifyPolicyOverrideRetirementProofBundle: (files: File[]) => void;
  onSignPolicyOverrideRetirementProofBundle: (files: File[]) => void;
  onVerifyHistory: (file: File) => void;
  onVerifyOutcomes: (file: File) => void;
}

interface FileControl {
  key: string;
  ref: RefObject<HTMLInputElement | null>;
  label: string;
  busyLabel: string;
  busyAction: PlanBlueprintLibraryBusyAction;
  multiple: boolean;
  icon?: "key";
  title?: string;
  onFiles: (files: File[]) => void;
}

export function PlanBlueprintLibraryFileControls({
  busyAction,
  canSignPolicyOverrideRetirementProofBundle,
  onVerifyPolicyOverrideRetirements,
  onVerifyPolicyOverrideRetirementProofBundle,
  onSignPolicyOverrideRetirementProofBundle,
  onVerifyHistory,
  onVerifyOutcomes,
}: PlanBlueprintLibraryFileControlsProps) {
  const historyInput = useRef<HTMLInputElement>(null);
  const outcomesInput = useRef<HTMLInputElement>(null);
  const retirementsInput = useRef<HTMLInputElement>(null);
  const proofBundleInput = useRef<HTMLInputElement>(null);
  const proofBundleSignInput = useRef<HTMLInputElement>(null);
  const busy = Boolean(busyAction);
  const controls = fileControls(
    {
      history: historyInput,
      outcomes: outcomesInput,
      retirements: retirementsInput,
      proofBundle: proofBundleInput,
      proofBundleSign: proofBundleSignInput,
    },
    {
      canSignPolicyOverrideRetirementProofBundle,
      onVerifyPolicyOverrideRetirements,
      onVerifyPolicyOverrideRetirementProofBundle,
      onSignPolicyOverrideRetirementProofBundle,
      onVerifyHistory,
      onVerifyOutcomes,
    },
  );
  return (
    <>
      {controls.map((control) => (
        <FileControlButton
          key={control.key}
          control={control}
          busy={busy}
          active={busyAction === control.busyAction}
        />
      ))}
    </>
  );
}

interface FileControlRefs {
  history: RefObject<HTMLInputElement | null>;
  outcomes: RefObject<HTMLInputElement | null>;
  retirements: RefObject<HTMLInputElement | null>;
  proofBundle: RefObject<HTMLInputElement | null>;
  proofBundleSign: RefObject<HTMLInputElement | null>;
}

function fileControls(
  refs: FileControlRefs,
  callbacks: Omit<PlanBlueprintLibraryFileControlsProps, "busyAction">,
): FileControl[] {
  const single =
    (callback: (file: File) => void) =>
    ([file]: File[]): void => {
      if (file) callback(file);
    };
  return [
    {
      key: "retirements",
      ref: refs.retirements,
      label: planCopy.blueprint.library.verifyPolicyOverrideRetirements,
      busyLabel: planCopy.blueprint.library.verifyingPolicyOverrideRetirements,
      busyAction: "verifyPolicyOverrideRetirements",
      multiple: false,
      onFiles: single(callbacks.onVerifyPolicyOverrideRetirements),
    },
    {
      key: "proof-bundle",
      ref: refs.proofBundle,
      label:
        planCopy.blueprint.library.verifyPolicyOverrideRetirementProofBundle,
      busyLabel:
        planCopy.blueprint.library.verifyingPolicyOverrideRetirementProofBundle,
      busyAction: "verifyPolicyOverrideRetirementProofBundle",
      multiple: true,
      onFiles: callbacks.onVerifyPolicyOverrideRetirementProofBundle,
    },
    {
      key: "sign-proof-bundle",
      ref: refs.proofBundleSign,
      label: planCopy.blueprint.library.signPolicyOverrideRetirementProofBundle,
      busyLabel:
        planCopy.blueprint.library.signingPolicyOverrideRetirementProofBundle,
      busyAction: "signPolicyOverrideRetirementProofBundle",
      multiple: true,
      icon: "key",
      title: callbacks.canSignPolicyOverrideRetirementProofBundle
        ? planCopy.blueprint.library.signPolicyOverrideRetirementProofBundle
        : planCopy.blueprint.library.errors.policyOverrideProofBundleNoSigner,
      onFiles: callbacks.onSignPolicyOverrideRetirementProofBundle,
    },
    {
      key: "history",
      ref: refs.history,
      label: planCopy.blueprint.library.verifyHistory,
      busyLabel: planCopy.blueprint.library.verifyingHistory,
      busyAction: "verifyHistory",
      multiple: false,
      onFiles: single(callbacks.onVerifyHistory),
    },
    {
      key: "outcomes",
      ref: refs.outcomes,
      label: planCopy.blueprint.library.verifyOutcomes,
      busyLabel: planCopy.blueprint.library.verifyingOutcomes,
      busyAction: "verifyOutcomes",
      multiple: false,
      onFiles: single(callbacks.onVerifyOutcomes),
    },
  ];
}

export interface FileControlButtonProps {
  control: FileControl;
  busy: boolean;
  active: boolean;
}

function FileControlButton({ control, busy, active }: FileControlButtonProps) {
  return (
    <>
      <button
        className="fixture-verify"
        type="button"
        disabled={busy}
        aria-busy={active}
        title={control.title}
        onClick={() => control.ref.current?.click()}
      >
        {control.icon === "key" ? (
          <KeyRound size={12} aria-hidden="true" />
        ) : (
          <Upload size={12} aria-hidden="true" />
        )}
        {active ? control.busyLabel : control.label}
      </button>
      <input
        ref={control.ref}
        className="fixture-file-input"
        type="file"
        accept="application/json,.json"
        multiple={control.multiple}
        aria-label={control.label}
        onChange={(event) => consumeFiles(event, control.onFiles)}
      />
    </>
  );
}

function consumeFiles(
  event: ChangeEvent<HTMLInputElement>,
  callback: (files: File[]) => void,
): void {
  const files = Array.from(event.currentTarget.files ?? []);
  event.currentTarget.value = "";
  if (files.length > 0) callback(files);
}
