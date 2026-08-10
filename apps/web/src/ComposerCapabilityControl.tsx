import { lazy, Suspense, useEffect, useMemo } from "react";
import { AlertTriangle, ArrowRight, ShieldCheck } from "lucide-react";

import type { AgentProfile } from "@napier/contracts";
import type { AgentCapabilityPresetId } from "@napier/contracts/agent-capabilities";

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
import { useAgentCapabilityProjection } from "./use-agent-capability-projection";
import "./agent-capability-composer.css";

const LazySandboxSetupCard = lazy(() => import("./SandboxSetupCard"));

export function ComposerCapabilityControl({
  agent,
  disabled,
  selectedPreset,
  onSelectedPresetChange,
  onReview,
  onReadinessChange,
}: {
  agent: AgentProfile | undefined;
  disabled: boolean;
  selectedPreset: AgentCapabilityPresetId | undefined;
  onSelectedPresetChange: (
    preset: AgentCapabilityPresetId | undefined,
  ) => void;
  onReview: () => void;
  onReadinessChange: (readiness: ComposerRunReadiness) => void;
}) {
  const { projection, loading, error } = useAgentCapabilityProjection(
    agent?.id,
    agent?.revision,
    selectedPreset,
  );
  const summary = agentCapabilityComposerSummary(projection, loading, error);
  const modes = composerModes(agent, selectedPreset);
  const activeMode = modes.find((mode) => mode.active);
  const activeDependency = activeMode
    ? composerModeDependency(activeMode.id, projection)
    : undefined;
  const runReadiness = useMemo(
    () =>
      composerRunReadiness(
        agent,
        projection,
        loading,
        error,
        selectedPreset,
      ),
    [agent, error, loading, projection, selectedPreset],
  );

  useEffect(() => {
    onReadinessChange(runReadiness);
  }, [onReadinessChange, runReadiness]);

  return (
    <div
      className={`agent-capability-composer state-${projection?.driftState ?? "loading"}`}
      aria-label="Next-run task mode and effective Agent capabilities"
      data-scope="next-run-only"
    >
      <div
        className="composer-mode-row"
        role="group"
        aria-label="Next-run task mode"
      >
        {modes.map((mode) => {
          const dependency = composerModeDependency(mode.id, projection);
          return (
            <button
              key={mode.id}
              type="button"
              className={`composer-mode${mode.active ? " is-active" : ""} dep-${dependency.level}`}
              aria-pressed={mode.active}
              disabled={disabled}
              title={
                dependency.message
                  ? `${mode.summary}\n\n${dependency.message}`
                  : mode.summary
              }
              onClick={() => onSelectedPresetChange(mode.id)}
            >
              {dependency.level === "blocked" ? (
                <AlertTriangle size={11} aria-hidden="true" />
              ) : null}
              {mode.label}
              {mode.temporary ? <span>1×</span> : null}
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
      <div className="agent-capability-composer-status">
        <span className="agent-capability-composer-profile">
          {projection && projection.driftState !== "current" ? (
            <AlertTriangle size={13} aria-hidden="true" />
          ) : (
            <ShieldCheck size={13} aria-hidden="true" />
          )}
          {selectedPreset
            ? `${activeMode?.label ?? selectedPreset} 1×`
            : agent
              ? agentCapabilityBadgeText(agent)
              : "Read only"}
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
          aria-label={
            selectedPreset ? "Use Agent default" : "Edit Agent default"
          }
          onClick={() => {
            if (selectedPreset) {
              onSelectedPresetChange(undefined);
            } else {
              onReview();
              focusCapabilityContract();
            }
          }}
        >
          {selectedPreset ? "Use default" : "Edit default"}
          <ArrowRight size={11} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export default ComposerCapabilityControl;
