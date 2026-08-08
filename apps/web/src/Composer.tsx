import type { KeyboardEvent } from "react";
import { lazy, Suspense } from "react";
import { Command, Send, Square } from "lucide-react";

import type { AgentProfile } from "@napier/contracts";
import { copy } from "./copy";
import type { SelectedModelAvailability } from "./model-selection-view-model";
import type { useWorkspaceViewModel } from "./use-workspace-view-model";

const LazyComposerCapabilityControl = lazy(
  () => import("./ComposerCapabilityControl"),
);

type WorkspaceViewModel = ReturnType<typeof useWorkspaceViewModel>;

const MODEL_WARNING_ID = "composer-model-unavailable";

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
  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        void vm.submit();
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
          handleComposerKeys(event, () => void vm.submit())
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
            disabled={!canStartRun}
            aria-describedby={
              !activeModel.configured ? MODEL_WARNING_ID : undefined
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
