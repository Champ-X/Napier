import { useState } from "react";
import { AlertTriangle, ArrowRight, ShieldCheck } from "lucide-react";

import type { AgentProfile } from "@napier/contracts";
import {
  agentCapabilityPresetUpdate,
  type AgentCapabilityPresetId,
} from "@napier/contracts/agent-capabilities";

import { agentCapabilityBadgeText } from "./agent-capability-view-model";
import {
  agentCapabilityComposerSummary,
  focusCapabilityContract,
} from "./agent-capability-composer-summary";
import {
  composerModeDependency,
  composerModes,
} from "./composer-mode-view-model";
import { updateAgentProfile } from "./context-api";
import { formatApiErrorMessage } from "./api-error";
import { useAgentCapabilityProjection } from "./use-agent-capability-projection";
import "./agent-capability-composer.css";

export function ComposerCapabilityControl({
  agent,
  disabled,
  threadId,
  onReview,
  onAgentUpdated,
}: {
  agent: AgentProfile | undefined;
  disabled: boolean;
  threadId: string | undefined;
  onReview: () => void;
  onAgentUpdated: (agent: AgentProfile) => void;
}) {
  const { projection, refresh, loading, error } = useAgentCapabilityProjection(
    agent?.id,
    agent?.revision,
  );
  const [busyMode, setBusyMode] = useState<AgentCapabilityPresetId>();
  const [applyError, setApplyError] = useState<string>();
  const summary = agentCapabilityComposerSummary(projection, loading, error);
  const modes = composerModes(agent);
  const activeMode = modes.find((mode) => mode.active);
  const activeDependency = activeMode
    ? composerModeDependency(activeMode.id, projection)
    : undefined;

  const applyMode = async (modeId: AgentCapabilityPresetId): Promise<void> => {
    if (!agent || disabled || busyMode) return;
    setBusyMode(modeId);
    setApplyError(undefined);
    try {
      const updated = await updateAgentProfile(agent.id, {
        ...agentCapabilityPresetUpdate(modeId),
        ...(threadId ? { threadId } : {}),
      });
      onAgentUpdated(updated);
      await refresh().catch(() => undefined);
    } catch (reason) {
      setApplyError(formatApiErrorMessage(reason));
    } finally {
      setBusyMode(undefined);
    }
  };

  return (
    <div
      className={`agent-capability-composer state-${projection?.driftState ?? "loading"}`}
      aria-label="Task mode and effective Agent capabilities"
    >
      <div className="composer-mode-row" role="group" aria-label="Task mode">
        {modes.map((mode) => {
          const dependency = composerModeDependency(mode.id, projection);
          return (
            <button
              key={mode.id}
              type="button"
              className={`composer-mode${mode.active ? " is-active" : ""} dep-${dependency.level}`}
              aria-pressed={mode.active}
              disabled={disabled || Boolean(busyMode)}
              title={
                dependency.message
                  ? `${mode.summary}\n\n${dependency.message}`
                  : mode.summary
              }
              onClick={() => void applyMode(mode.id)}
            >
              {dependency.level === "blocked" ? (
                <AlertTriangle size={11} aria-hidden="true" />
              ) : null}
              {busyMode === mode.id ? `${mode.label}…` : mode.label}
            </button>
          );
        })}
      </div>
      {activeDependency && activeDependency.level !== "ready" ? (
        <p
          className={`composer-mode-dependency dep-${activeDependency.level}`}
          role={activeDependency.level === "blocked" ? "alert" : "status"}
        >
          {activeDependency.message}
        </p>
      ) : null}
      {applyError ? (
        <p className="composer-mode-error" role="alert">
          {applyError}
        </p>
      ) : null}
      <div className="agent-capability-composer-status">
        <span className="agent-capability-composer-profile">
          {projection && projection.driftState !== "current" ? (
            <AlertTriangle size={13} aria-hidden="true" />
          ) : (
            <ShieldCheck size={13} aria-hidden="true" />
          )}
          {agent ? agentCapabilityBadgeText(agent) : "Read only"}
        </span>
        <span className="agent-capability-composer-contract">
          {summary.contract}
        </span>
        {projection ? (
          <span className="agent-capability-composer-readiness">
            {summary.readiness}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => {
            onReview();
            focusCapabilityContract();
          }}
        >
          Review / restore
          <ArrowRight size={11} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export default ComposerCapabilityControl;
