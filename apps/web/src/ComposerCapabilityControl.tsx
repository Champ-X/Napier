import { useEffect, useMemo } from "react";
import { AlertTriangle, ArrowRight, ShieldCheck } from "lucide-react";

import type { AgentProfile } from "@napier/contracts";
import type { AgentCapabilityPresetId } from "@napier/contracts/agent-capabilities";

import { focusCapabilityContract } from "./agent-capability-composer-summary";
import { advancedSurfaceCopy } from "./advanced-surface-copy";
import { composerCopy } from "./composer-copy";
import {
  composerModeDependency,
  composerModes,
} from "./composer-mode-view-model";
import {
  composerRunReadiness,
  type ComposerRunReadiness,
} from "./composer-readiness-view-model";
import { useAgentCapabilityProjection } from "./use-agent-capability-projection";
import "./agent-capability-composer.css";

export interface ComposerCapabilityControlProps {
  agent: AgentProfile | undefined;
  disabled: boolean;
  selectedPreset: AgentCapabilityPresetId | undefined;
  onSelectedPresetChange(preset: AgentCapabilityPresetId): void;
  onReview(): void;
  onReadinessChange(readiness: ComposerRunReadiness): void;
}

export function ComposerCapabilityControl({
  agent,
  disabled,
  selectedPreset,
  onSelectedPresetChange,
  onReview,
  onReadinessChange,
}: ComposerCapabilityControlProps) {
  const accessibilityCopy = advancedSurfaceCopy.accessibility;
  const { projection, loading, error } = useAgentCapabilityProjection(
    agent?.id,
    agent?.revision,
    selectedPreset,
  );
  const modes = composerModes(agent, selectedPreset);
  const activeMode = modes.find((mode) => mode.active);
  const activeDependency = activeMode
    ? composerModeDependency(activeMode.id, projection)
    : undefined;
  const runReadiness = useMemo(
    () =>
      composerRunReadiness(agent, projection, loading, error, selectedPreset),
    [agent, error, loading, projection, selectedPreset],
  );
  const statusLevel =
    activeDependency && activeDependency.level !== "ready"
      ? activeDependency.level
      : runReadiness.level;
  const statusMessage =
    activeDependency?.message ||
    runReadiness.message ||
    composerCopy.permission.runtimeReady;

  useEffect(() => {
    onReadinessChange(runReadiness);
  }, [onReadinessChange, runReadiness]);

  return (
    <div
      className={`agent-capability-composer state-${projection?.driftState ?? "loading"}`}
      aria-label={accessibilityCopy.nextRunCapabilities}
      data-scope="permission-level"
    >
      <div className="agent-capability-composer-header">
        <div>
          <strong>{composerCopy.permission.title}</strong>
          <span>{composerCopy.permission.defaultHint}</span>
        </div>
        <button
          type="button"
          onClick={() => {
            onReview();
            focusCapabilityContract();
          }}
        >
          {composerCopy.permission.advancedSettings}
          <ArrowRight size={12} aria-hidden="true" />
        </button>
      </div>

      <div
        className="composer-permission-grid"
        role="radiogroup"
        aria-label={accessibilityCopy.nextRunMode}
      >
        {modes.map((mode) => {
          const dependency = composerModeDependency(mode.id, projection);
          return (
            <button
              key={mode.id}
              type="button"
              className={`composer-permission-option${mode.active ? " is-active" : ""} dep-${dependency.level}`}
              role="radio"
              aria-checked={mode.active}
              aria-pressed={mode.active}
              disabled={disabled}
              title={
                dependency.message
                  ? `${mode.summary}\n\n${dependency.message}`
                  : mode.summary
              }
              onClick={() => onSelectedPresetChange(mode.id)}
            >
              {dependency.level !== "ready" ? (
                <AlertTriangle size={14} aria-hidden="true" />
              ) : null}
              <span className="composer-permission-label">{mode.label}</span>
              <span className="composer-permission-summary">
                {mode.summary}
              </span>
            </button>
          );
        })}
      </div>

      <div
        className={`composer-readiness-item composer-runtime-status state-${statusLevel}`}
        role={statusLevel === "blocked" ? "alert" : "status"}
        aria-label={accessibilityCopy.currentRunReadiness}
      >
        {statusLevel === "ready" ? (
          <ShieldCheck size={15} aria-hidden="true" />
        ) : (
          <AlertTriangle size={15} aria-hidden="true" />
        )}
        <span>
          <strong>{composerCopy.permission.runtimeStatus}</strong>
          {statusMessage}
        </span>
      </div>
    </div>
  );
}
