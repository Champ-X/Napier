import type { ReleaseProductGateProjection } from "@napier/contracts/release-product-trial";
import { advancedSurfaceCopy } from "./advanced-surface-copy";

export interface ReleaseProductVersionSummaryProps {
  version: ReleaseProductGateProjection["versions"][number];
}

export function ReleaseProductVersionSummary({
  version,
}: ReleaseProductVersionSummaryProps) {
  const copy = advancedSurfaceCopy.releaseTrial;
  return (
    <div
      className={`release-product-version release-product-version-${version.status}`}
    >
      <strong>
        {version.productVersion} · {copy[version.status]}
      </strong>
      <span>
        {version.coveredCaseCount}/{version.caseCount} {copy.cases} ·{" "}
        {Math.round(version.successRate * 100)}% {copy.success} · UX{" "}
        {version.meanUxScore}/5
      </span>
      <small>
        {version.trialCount} {copy.trials} · {version.humanInterventions}{" "}
        {copy.human} · {version.configurationInterventions} {copy.configuration}{" "}
        · {version.recoveryEvents} {copy.recovery}
      </small>
      {version.failedCriticalCaseIds.length ? (
        <small>
          {copy.criticalPending}: {version.failedCriticalCaseIds.join(", ")}
        </small>
      ) : null}
    </div>
  );
}

export interface ReleaseProductMetricInputProps {
  label: string;
  value: number;
  onChange(value: number): void;
}

export function ReleaseProductMetricInput({
  label,
  value,
  onChange,
}: ReleaseProductMetricInputProps) {
  return (
    <label>
      <span>{label}</span>
      <input
        aria-label={label}
        type="number"
        min={0}
        max={100}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  );
}
