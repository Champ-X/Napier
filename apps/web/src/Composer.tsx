import type { KeyboardEvent } from "react";
import { lazy, Suspense, useCallback, useState } from "react";
import { Command, Send, Square } from "lucide-react";

import type { AgentProfile } from "@napier/contracts";
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

type WorkspaceViewModel = ReturnType<typeof useWorkspaceViewModel>;

const MODEL_WARNING_ID = "composer-model-unavailable";
const READINESS_WARNING_ID = "composer-capability-unavailable";

export function Composer({
  vm,
  activeAgent,
  activeModel,
  canStartRun,
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
    | "setInspectorTab"
    | "commitAgentConfiguration"
  >;
  activeAgent: AgentProfile | undefined;
  activeModel: SelectedModelAvailability;
  canStartRun: boolean;
}) {
  const [runReadiness, setRunReadiness] =
    useState<ComposerRunReadiness>(initialComposerRunReadiness);
  const canSubmit = canStartRun && runReadiness.canRun;
  const submit = useCallback(() => {
    if (vm.isRunning || canSubmit) void vm.submit();
  }, [canSubmit, vm]);
  return (
    <form
      className="composer"
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
        onKeyDown={(event) =>
          handleComposerKeys(event, submit)
        }
      />
      <div className="composer-footer">
        <div className="composer-hints">
          <Suspense
            fallback={<span>Capability contract loading...</span>}
          >
            <LazyComposerCapabilityControl
              agent={activeAgent}
              disabled={vm.isRunning || !vm.detail}
              threadId={vm.detail?.thread.id}
              onReview={() => vm.setInspectorTab("context")}
              onAgentUpdated={vm.commitAgentConfiguration}
              onReadinessChange={setRunReadiness}
            />
          </Suspense>
          <span>
            <Command size={12} aria-hidden="true" />
            {copy.shortcut}
          </span>
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
            aria-describedby={
              !activeModel.configured
                ? MODEL_WARNING_ID
                : !runReadiness.canRun
                  ? READINESS_WARNING_ID
                  : undefined
            }
          >
            <Send size={14} aria-hidden="true" />
            {copy.send}
          </button>
        )}
      </div>
      {!vm.isRunning && !activeModel.configured ? (
        <p id={MODEL_WARNING_ID} className="composer-model-warning" role="status">
          {copy.modelUnavailableHint}
        </p>
      ) : null}
      {!vm.isRunning &&
      activeModel.configured &&
      runReadiness.level === "blocked" ? (
        <p
          id={READINESS_WARNING_ID}
          className="composer-model-warning"
          role="alert"
        >
          {runReadiness.message}
        </p>
      ) : null}
      {!vm.isRunning &&
      activeModel.configured &&
      runReadiness.level === "warn" &&
      runReadiness.message ? (
        <p className="composer-readiness-warning" role="status">
          {runReadiness.message}
        </p>
      ) : null}
    </form>
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

export default Composer;
