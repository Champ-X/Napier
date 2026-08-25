import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, ShieldCheck } from "lucide-react";

import type { AgentProfile } from "@napier/contracts";
import type { AgentCapabilityPresetId } from "@napier/contracts/agent-capabilities";

import { agentCapabilityBadgeText } from "./agent-capability-view-model";
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

const LazySandboxSetupCard = lazy(() =>
  import("./SandboxSetupCard").then(({ SandboxSetupCard }) => ({
    default: SandboxSetupCard,
  })),
);

export interface ComposerCapabilityControlProps {
  agent: AgentProfile | undefined;
  disabled: boolean;
  selectedPreset: AgentCapabilityPresetId | undefined;
  onSelectedPresetChange(preset: AgentCapabilityPresetId | undefined): void;
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
      aria-label={accessibilityCopy.nextRunCapabilities}
      data-scope="next-run-only"
    >
      <span className="agent-capability-composer-badge" aria-hidden="true">
        {composerCopy.nextRunBadge}
      </span>
      <div
        className="composer-mode-row"
        role="group"
        aria-label={accessibilityCopy.nextRunMode}
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
              {dependency.level !== "ready" ? (
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
      {sandboxOpen ? (
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
        aria-label={accessibilityCopy.currentRunReadiness}
      >
        {runReadiness.items.map((item) =>
          item.id === "sandbox" ? (
            <button
              key={item.id}
              type="button"
              className={`composer-readiness-item manage state-${item.state}`}
              title={`${item.detail} ${accessibilityCopy.manageSandbox}`}
              aria-expanded={sandboxOpen}
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
              : accessibilityCopy.readOnly}
        </span>
        <button
          type="button"
          aria-label={
            selectedPreset
              ? accessibilityCopy.useAgentDefault
              : accessibilityCopy.reviewAgentSettings
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
          {selectedPreset
            ? accessibilityCopy.useDefault
            : accessibilityCopy.agentSettings}
          <ArrowRight size={11} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
