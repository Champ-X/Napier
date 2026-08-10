import { lazy, Suspense, useEffect, useMemo, useState } from "react";
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
  composerModeNeedsSandboxSetup,
  composerModes,
} from "./composer-mode-view-model";
import {
  composerRunReadiness,
  type ComposerRunReadiness,
} from "./composer-readiness-view-model";
import { updateAgentProfile } from "./context-api";
import { formatApiErrorMessage } from "./api-error";
import { useAgentCapabilityProjection } from "./use-agent-capability-projection";
import "./agent-capability-composer.css";

const LazySandboxSetupCard = lazy(() => import("./SandboxSetupCard"));

export function ComposerCapabilityControl({
  agent,
  disabled,
  threadId,
  onReview,
  onAgentUpdated,
  onReadinessChange,
}: {
  agent: AgentProfile | undefined;
  disabled: boolean;
  threadId: string | undefined;
  onReview: () => void;
  onAgentUpdated: (agent: AgentProfile) => void;
  onReadinessChange: (readiness: ComposerRunReadiness) => void;
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
  const runReadiness = useMemo(
    () =>
      composerRunReadiness(
        agent,
        busyMode ? undefined : projection,
        loading || Boolean(busyMode),
        error,
      ),
    [agent, busyMode, error, loading, projection],
  );

  useEffect(() => {
    onReadinessChange(runReadiness);
  }, [onReadinessChange, runReadiness]);

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
      {activeMode &&
      activeDependency &&
      composerModeNeedsSandboxSetup(activeMode.id, activeDependency) ? (
        <div className="composer-sandbox-setup">
          <Suspense fallback={<div className="sandbox-setup-card" />}>
            <LazySandboxSetupCard />
          </Suspense>
        </div>
      ) : null}
      <div
        className="composer-readiness-row"
        aria-label="Current run readiness"
      >
        {runReadiness.items.map((item) => (
          <span
            key={item.id}
            className={`composer-readiness-item state-${item.state}`}
            title={item.detail}
          >
            <strong>{item.label}</strong>
            {item.value}
          </span>
        ))}
      </div>
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
