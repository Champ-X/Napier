import type { KeyboardEvent } from "react";
import { lazy, Suspense, useCallback, useState } from "react";
import { Command, FolderTree, Send, SlidersHorizontal, Square } from "lucide-react";

import type { AgentProfile } from "@napier/contracts";
import type { InspectorTab } from "./use-workspace-view-model";
import { copy } from "./copy";
import {
  initialComposerRunReadiness,
  type ComposerRunReadiness,
} from "./composer-readiness-types";
import type { SelectedModelAvailability } from "./model-selection-view-model";
import type { useWorkspaceViewModel } from "./use-workspace-view-model";

const LazyComposerCapabilityControl = lazy(
  () => import("./ComposerCapabilityControl"),
);
const LazyProviderSetupCard = lazy(() => import("./ProviderSetupCard"));
const LazyWorkspaceFolderPicker = lazy(() => import("./WorkspaceFolderPicker"));

type WorkspaceViewModel = ReturnType<typeof useWorkspaceViewModel>;

const MODEL_WARNING_ID = "composer-model-unavailable";
const READINESS_WARNING_ID = "composer-capability-unavailable";

export function Composer({
  vm,
  activeAgent,
  activeModel,
  canStartRun,
  workspaceRoot,
  onOpenInspector,
  onOpenWorkspace,
}: {
  vm: Pick<
    WorkspaceViewModel,
    | "composer"
    | "setComposer"
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
  >;
  activeAgent: AgentProfile | undefined;
  activeModel: SelectedModelAvailability;
  canStartRun: boolean;
  workspaceRoot: string;
  onOpenInspector: (tab: InspectorTab) => void;
  onOpenWorkspace: () => void;
}) {
  const [runReadiness, setRunReadiness] = useState<ComposerRunReadiness>(
    initialComposerRunReadiness,
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const readinessPending = composerReadinessPending(runReadiness);
  const canSubmit = canStartRun && runReadiness.canRun;
  const submit = useCallback(() => {
    if (vm.isRunning || canSubmit) void vm.submit();
  }, [canSubmit, vm]);
  return (
    <form
      className="composer"
      data-run-readiness={readinessPending ? "checking" : runReadiness.level}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="composer-rule" aria-hidden="true">
        <span />
        <span>
          {vm.openOperatorDecision
            ? vm.openOperatorDecision.header
            : vm.isRunning
              ? copy.runControlMode
              : copy.inputMode}
        </span>
        <span />
      </div>
      <textarea
        aria-label={
          vm.isRunning ? copy.steeringPlaceholder : copy.composerPlaceholder
        }
        placeholder={
          vm.isRunning ? copy.steeringPlaceholder : copy.composerPlaceholder
        }
        value={vm.composer}
        rows={3}
        disabled={
          !vm.detail ||
          Boolean(vm.openOperatorDecision) ||
          Boolean(vm.browserInteractionConfirmation)
        }
        onChange={(event) => vm.setComposer(event.target.value)}
        onKeyDown={(event) => handleComposerKeys(event, submit)}
      />
      <div className="composer-footer">
        <div className="composer-hints">
          <details className="composer-options">
            <summary>
              <SlidersHorizontal size={12} aria-hidden="true" />
              {copy.composer.runOptions}
            </summary>
            <div className="composer-options-popover">
              <Suspense
                fallback={<span>{copy.composer.checkingRunOptions}</span>}
              >
                <LazyComposerCapabilityControl
                  agent={activeAgent}
                  disabled={vm.isRunning || !vm.detail}
                  selectedPreset={vm.nextRunCapabilityPreset}
                  onSelectedPresetChange={vm.setNextRunCapabilityPreset}
                  onReview={() => onOpenInspector("context")}
                  onReadinessChange={setRunReadiness}
                />
                <LazyProviderSetupCard
                  onBootstrapUpdated={vm.commitConfigurationBootstrap}
                  threadId={vm.detail?.thread.id}
                />
              </Suspense>
            </div>
          </details>
          <span>
            <Command size={12} aria-hidden="true" />
            {copy.shortcut}
          </span>
          <button
            type="button"
            className="composer-workspace-chip"
            onClick={() => setPickerOpen(true)}
            title={workspaceRoot}
          >
            <FolderTree size={12} aria-hidden="true" />
            <span>{shortWorkspacePath(workspaceRoot)}</span>
          </button>
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
        {vm.isRunning ? (
          <div className="composer-run-actions">
            <button
              className="run-button control"
              type="submit"
              disabled={!vm.composer.trim() || !vm.activeRunId}
            >
              <Send size={13} aria-hidden="true" />
              {vm.controlMessageMode === "steering"
                ? copy.steer
                : copy.queueFollowUp}
            </button>
            <button
              className="run-button stop"
              type="button"
              onClick={() => void vm.stop()}
            >
              <Square size={13} fill="currentColor" aria-hidden="true" />
              {copy.stop}
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
      <ComposerReadinessNotices
        running={vm.isRunning}
        modelConfigured={activeModel.configured}
        readiness={runReadiness}
        pending={readinessPending}
      />
      {pickerOpen ? (
        <Suspense fallback={null}>
          <LazyWorkspaceFolderPicker
            currentRoot={workspaceRoot}
            onClose={() => setPickerOpen(false)}
            onManualEntry={onOpenWorkspace}
          />
        </Suspense>
      ) : null}
    </form>
  );
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
  if (running) return null;
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
    <p className="composer-readiness-warning" role="status">
      {readiness.message}
    </p>
  ) : null;
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
  return readiness.items.every((item) => item.value === "Checking");
}

function shortWorkspacePath(value: string): string {
  const parts = value.split("/").filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : value;
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

export default Composer;
