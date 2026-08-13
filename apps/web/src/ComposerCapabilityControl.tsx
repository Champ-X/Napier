import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, ShieldCheck } from "lucide-react";

import type { AgentProfile } from "@napier/contracts";
import type { AgentCapabilityPresetId } from "@napier/contracts/agent-capabilities";

import { agentCapabilityBadgeText } from "./agent-capability-view-model";
import { focusCapabilityContract } from "./agent-capability-composer-summary";
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
  onSelectedPresetChange: (preset: AgentCapabilityPresetId | undefined) => void;
  onReview: () => void;
  onReadinessChange: (readiness: ComposerRunReadiness) => void;
}) {
  const [sandboxOpen, setSandboxOpen] = useState(false);
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
  const sandboxBlocked = Boolean(
    activeMode &&
    activeDependency &&
    composerModeNeedsSandboxSetup(activeMode.id, activeDependency),
  );
  const invalidSandboxBinding = Boolean(
    projection?.readiness.some(
      (record) =>
        record.id === "sandbox:configured-sandbox-invalid" &&
        record.status === "unavailable",
    ),
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
      {sandboxBlocked || sandboxOpen ? (
        <div className="composer-sandbox-setup">
          <Suspense fallback={<div className="sandbox-setup-card" />}>
            <LazySandboxSetupCard
              reviewInvalidBinding={invalidSandboxBinding}
            />
          </Suspense>
        </div>
      ) : null}
      <div
        className="composer-readiness-row"
        aria-label="Current run readiness"
      >
        {runReadiness.items.map((item) =>
          item.id === "sandbox" ? (
            <button
              key={item.id}
              type="button"
              className={`composer-readiness-item manage state-${item.state}`}
              title={`${item.detail} Manage Sandbox setup.`}
              aria-expanded={sandboxBlocked || sandboxOpen}
              disabled={disabled}
              onClick={() => setSandboxOpen((current) => !current)}
            >
              <strong>{item.label}</strong>
              {item.value}
            </button>
          ) : (
            <span
              key={item.id}
              className={`composer-readiness-item state-${item.state}`}
              title={item.detail}
            >
              <strong>{item.label}</strong>
              {item.value}
            </span>
          ),
        )}
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
        <button
          type="button"
          aria-label={
            selectedPreset ? "Use Agent default" : "Review Agent settings"
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
          {selectedPreset ? "Use default" : "Agent settings"}
          <ArrowRight size={11} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export default ComposerCapabilityControl;
