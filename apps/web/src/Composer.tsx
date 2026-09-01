import type { ClipboardEvent, DragEvent, KeyboardEvent } from "react";
import { lazy, Suspense, useCallback, useRef, useState } from "react";
import {
  AlertTriangle,
  ImagePlus,
  Send,
  SlidersHorizontal,
  Square,
} from "lucide-react";

import type { AgentProfile } from "@napier/contracts";
import type { InspectorTab } from "./use-workspace-view-model";
import { copy } from "./copy";
import { composerCopy } from "./composer-copy";
import {
  appendComposerImageFiles,
  ComposerImageError,
} from "./composer-image-attachments";
import { ComposerImageAttachments } from "./ComposerImageAttachments";
import { ConversationPlanProgress } from "./ConversationPlanProgress";
import { shellCopy } from "./shell-copy";
import {
  initialComposerRunReadiness,
  type ComposerRunReadiness,
} from "./composer-readiness-types";
import type { SelectedModelAvailability } from "./model-selection-view-model";
import { useComposerHeight } from "./use-composer-height";
import { useDismissableDetails } from "./use-dismissable-details";
import type { useWorkspaceViewModel } from "./use-workspace-view-model";
import "./composer-image-attachments.css";

const LazyComposerCapabilityControl = lazy(() =>
  import("./ComposerCapabilityControl").then(
    ({ ComposerCapabilityControl }) => ({
      default: ComposerCapabilityControl,
    }),
  ),
);
const LazyProviderSetupCard = lazy(() =>
  import("./ProviderSetupCard").then(({ ProviderSetupCard }) => ({
    default: ProviderSetupCard,
  })),
);
type WorkspaceViewModel = ReturnType<typeof useWorkspaceViewModel>;

const MODEL_WARNING_ID = "composer-model-unavailable";
const READINESS_WARNING_ID = "composer-capability-unavailable";

export function Composer({
  vm,
  activeAgent,
  activeModel,
  canStartRun,
  onOpenInspector,
}: {
  vm: Pick<
    WorkspaceViewModel,
    | "composer"
    | "composerImages"
    | "setComposer"
    | "setComposerImages"
    | "submit"
    | "stop"
    | "detail"
    | "isRunning"
    | "activeRunId"
    | "controlMessageMode"
    | "setControlMessageMode"
    | "openOperatorDecision"
    | "browserInteractionConfirmation"
    | "nextRunCapabilityPreset"
    | "setNextRunCapabilityPreset"
    | "commitConfigurationBootstrap"
    | "bootstrap"
  >;
  activeAgent: AgentProfile | undefined;
  activeModel: SelectedModelAvailability;
  canStartRun: boolean;
  onOpenInspector: (tab: InspectorTab) => void;
}) {
  const [runReadiness, setRunReadiness] = useState<ComposerRunReadiness>(
    initialComposerRunReadiness,
  );
  const composerRef = useRef<HTMLFormElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [imageError, setImageError] = useState<string>();
  const [imageDragActive, setImageDragActive] = useState(false);
  const optionsRef = useDismissableDetails();
  useComposerHeight(composerRef);
  const readinessPending = composerReadinessPending(runReadiness);
  const imagesSupported =
    vm.composerImages.length === 0 || activeModel.vision === true;
  const canSubmit = canStartRun && runReadiness.canRun && imagesSupported;
  const submit = useCallback(() => {
    if (vm.isRunning || canSubmit) void vm.submit();
  }, [canSubmit, vm]);
  return (
    <form
      ref={composerRef}
      className={`composer${imageDragActive ? " is-image-dragging" : ""}`}
      data-image-drop-label={composerCopy.images.drop}
      data-run-readiness={readinessPending ? "checking" : runReadiness.level}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onDragEnter={(event) =>
        handleImageDragEnter(
          event,
          vm.isRunning || !activeModel.vision,
          setImageDragActive,
        )
      }
      onDragOver={(event) => handleImageDragOver(event)}
      onDragLeave={(event) => handleImageDragLeave(event, setImageDragActive)}
      onDrop={(event) =>
        void handleImageDrop(
          event,
          vm,
          vm.isRunning || !activeModel.vision,
          setImageError,
          setImageDragActive,
        )
      }
    >
      <ConversationPlanProgress
        key={`${vm.activeRunId ?? "idle"}:${vm.detail?.activePlan?.planId ?? "none"}`}
        detail={vm.detail}
        isRunning={vm.isRunning}
      />
      <ComposerImageAttachments
        images={vm.composerImages}
        setImages={vm.setComposerImages}
      />
      <div className="composer-input-row">
        <span className="composer-mode" aria-hidden="true">
          {vm.openOperatorDecision
            ? vm.openOperatorDecision.header
            : vm.isRunning
              ? copy.runControlMode
              : copy.inputMode}
        </span>
        <textarea
          aria-label={
            vm.isRunning ? copy.steeringPlaceholder : copy.composerPlaceholder
          }
          placeholder={
            vm.isRunning ? copy.steeringPlaceholder : copy.composerPlaceholder
          }
          value={vm.composer}
          rows={1}
          disabled={
            !vm.detail ||
            Boolean(vm.openOperatorDecision) ||
            Boolean(vm.browserInteractionConfirmation)
          }
          onChange={(event) => vm.setComposer(event.target.value)}
          onPaste={(event) =>
            void handleImagePaste(
              event,
              vm,
              vm.isRunning || !activeModel.vision,
              setImageError,
            )
          }
          onKeyDown={(event) => handleComposerKeys(event, submit)}
        />
        {vm.isRunning ? (
          <div className="composer-run-actions">
            {vm.composer.trim() ? (
              <button
                className="run-button control"
                type="submit"
                disabled={!vm.activeRunId}
                aria-label={
                  vm.controlMessageMode === "steering"
                    ? copy.steer
                    : copy.queueFollowUp
                }
              >
                <Send size={15} aria-hidden="true" />
                <span>
                  {vm.controlMessageMode === "steering"
                    ? copy.steer
                    : copy.queueFollowUp}
                </span>
              </button>
            ) : null}
            <button
              className="run-button stop"
              type="button"
              aria-label={copy.stop}
              onClick={() => void vm.stop()}
            >
              <Square size={14} fill="currentColor" aria-hidden="true" />
              <span>{copy.stop}</span>
            </button>
          </div>
        ) : (
          <button
            className="run-button"
            type="submit"
            disabled={!canSubmit}
            aria-describedby={runButtonDescription(
              activeModel.configured,
              runReadiness,
              readinessPending,
            )}
          >
            <Send size={14} aria-hidden="true" />
            {copy.send}
          </button>
        )}
      </div>
      <div className="composer-footer">
        <div className="composer-hints">
          <button
            type="button"
            className="composer-image-picker"
            disabled={vm.isRunning || !activeModel.vision}
            aria-label={composerCopy.images.attach}
            title={
              activeModel.vision
                ? composerCopy.images.attach
                : composerCopy.images.visionRequired
            }
            onClick={() => imageInputRef.current?.click()}
          >
            <ImagePlus size={15} aria-hidden="true" />
          </button>
          <input
            ref={imageInputRef}
            className="composer-image-input"
            type="file"
            tabIndex={-1}
            multiple
            accept="image/jpeg,image/png,image/gif,image/webp"
            disabled={vm.isRunning || !activeModel.vision}
            onChange={(event) => {
              const files = event.currentTarget.files
                ? Array.from(event.currentTarget.files)
                : [];
              event.currentTarget.value = "";
              void addComposerImages(files, vm, setImageError);
            }}
          />
          <details ref={optionsRef} className="composer-options">
            <summary
              aria-label={shellCopy.composer.runOptions}
              title={shellCopy.composer.runOptions}
            >
              <SlidersHorizontal size={14} aria-hidden="true" />
            </summary>
            <div className="composer-options-popover">
              <Suspense
                fallback={<span>{shellCopy.composer.checkingRunOptions}</span>}
              >
                <LazyComposerCapabilityControl
                  agent={activeAgent}
                  disabled={vm.isRunning || !vm.detail}
                  selectedPreset={vm.nextRunCapabilityPreset}
                  onSelectedPresetChange={vm.setNextRunCapabilityPreset}
                  onReview={() => onOpenInspector("context")}
                  onReadinessChange={setRunReadiness}
                />
                {!vm.bootstrap?.models.some(
                  (model) => model.provider !== "napier" && model.configured,
                ) ? (
                  <LazyProviderSetupCard
                    onBootstrapUpdated={vm.commitConfigurationBootstrap}
                    threadId={vm.detail?.thread.id}
                  />
                ) : null}
              </Suspense>
            </div>
          </details>
          {vm.isRunning ? (
            <label className="control-mode">
              <span>{copy.controlMode}</span>
              <select
                aria-label={copy.controlMode}
                value={vm.controlMessageMode}
                onChange={(event) =>
                  vm.setControlMessageMode(
                    event.target.value === "follow_up"
                      ? "follow_up"
                      : "steering",
                  )
                }
              >
                <option value="steering">{copy.steering}</option>
                <option value="follow_up">{copy.followUp}</option>
              </select>
            </label>
          ) : null}
        </div>
      </div>
      <ComposerReadinessNotices
        running={vm.isRunning}
        modelConfigured={activeModel.configured}
        readiness={runReadiness}
        pending={readinessPending}
      />
      <ComposerImageWarning
        error={imageError}
        imagesSupported={imagesSupported}
        onClear={() => vm.setComposerImages([])}
      />
    </form>
  );
}

function ComposerImageWarning({
  error,
  imagesSupported,
  onClear,
}: {
  error: string | undefined;
  imagesSupported: boolean;
  onClear: () => void;
}) {
  if (!error && imagesSupported) return null;
  return (
    <div className="composer-image-warning" role="alert">
      <span>{error ?? composerCopy.images.visionRequired}</span>
      {!imagesSupported ? (
        <button type="button" onClick={onClear}>
          {composerCopy.images.clear}
        </button>
      ) : null}
    </div>
  );
}

async function addComposerImages(
  files: readonly File[],
  vm: Pick<WorkspaceViewModel, "composerImages" | "setComposerImages">,
  setError: (value: string | undefined) => void,
): Promise<void> {
  if (files.length === 0) return;
  setError(undefined);
  try {
    vm.setComposerImages(
      await appendComposerImageFiles(vm.composerImages, files),
    );
  } catch (error) {
    setError(
      error instanceof ComposerImageError
        ? composerCopy.images.errors[error.code]
        : composerCopy.images.errors.unsupported,
    );
  }
}

async function handleImagePaste(
  event: ClipboardEvent<HTMLTextAreaElement>,
  vm: Pick<WorkspaceViewModel, "composerImages" | "setComposerImages">,
  disabled: boolean,
  setError: (value: string | undefined) => void,
): Promise<void> {
  const files = Array.from(event.clipboardData.files);
  if (files.length === 0) return;
  event.preventDefault();
  if (disabled) {
    setError(composerCopy.images.visionRequired);
    return;
  }
  await addComposerImages(files, vm, setError);
}

function handleImageDragEnter(
  event: DragEvent<HTMLFormElement>,
  disabled: boolean,
  setActive: (value: boolean) => void,
): void {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  if (!disabled) setActive(true);
}

function handleImageDragOver(event: DragEvent<HTMLFormElement>): void {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
}

function handleImageDragLeave(
  event: DragEvent<HTMLFormElement>,
  setActive: (value: boolean) => void,
): void {
  const next = event.relatedTarget;
  if (next && event.currentTarget.contains(next as Node)) return;
  setActive(false);
}

async function handleImageDrop(
  event: DragEvent<HTMLFormElement>,
  vm: Pick<WorkspaceViewModel, "composerImages" | "setComposerImages">,
  disabled: boolean,
  setError: (value: string | undefined) => void,
  setActive: (value: boolean) => void,
): Promise<void> {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  setActive(false);
  if (disabled) {
    setError(composerCopy.images.visionRequired);
    return;
  }
  await addComposerImages(Array.from(event.dataTransfer.files), vm, setError);
}

function hasDraggedFiles(event: DragEvent<HTMLFormElement>): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

function ComposerReadinessNotices({
  running,
  modelConfigured,
  readiness,
  pending,
}: {
  running: boolean;
  modelConfigured: boolean;
  readiness: ComposerRunReadiness;
  pending: boolean;
}) {
  if (running && readiness.level !== "warn") return null;
  if (!modelConfigured) {
    return (
      <p id={MODEL_WARNING_ID} className="composer-model-warning" role="status">
        {copy.modelUnavailableHint}
      </p>
    );
  }
  if (!pending && readiness.level === "blocked") {
    return (
      <p
        id={READINESS_WARNING_ID}
        className="composer-model-warning"
        role="alert"
      >
        {readiness.message}
      </p>
    );
  }
  return readiness.level === "warn" && readiness.message ? (
    <p
      className="composer-readiness-warning"
      role="status"
      title={readiness.message}
    >
      <AlertTriangle size={12} aria-hidden="true" />
      {readinessWarningLabel(readiness)}
    </p>
  ) : null;
}

function readinessWarningLabel(readiness: ComposerRunReadiness): string {
  const sandbox = readiness.items.find((item) => item.id === "sandbox");
  if (sandbox?.value === composerCopy.values.hostDirect) return sandbox.value;
  return (
    readiness.items.find((item) => item.state === "warn")?.value ??
    composerCopy.values.availableUnverified
  );
}

function handleComposerKeys(
  event: KeyboardEvent<HTMLTextAreaElement>,
  submit: () => void,
): void {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    submit();
  }
}

function composerReadinessPending(readiness: ComposerRunReadiness): boolean {
  return readiness.items.every((item) => item.pending === true);
}

function runButtonDescription(
  modelConfigured: boolean,
  readiness: ComposerRunReadiness,
  pending: boolean,
): string | undefined {
  return !modelConfigured
    ? MODEL_WARNING_ID
    : !pending && !readiness.canRun
      ? READINESS_WARNING_ID
      : undefined;
}
