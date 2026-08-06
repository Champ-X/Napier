import { useEffect, useState } from "react";
import { AlertTriangle, Check, RefreshCw, ShieldCheck } from "lucide-react";

import { restoreRecommendedAgentCapabilities } from "./agent-capability-api";
import { contextCopy as copy } from "./context-copy";
import { formatApiErrorMessage, NapierApiError } from "./api-error";
import { useAgentCapabilityProjection } from "./use-agent-capability-projection";
import "./agent-capability-contract.css";

export function AgentCapabilityContractCard({
  agentId,
  agentRevision,
  disabled,
  onRestored,
}: {
  agentId: string;
  agentRevision: number;
  disabled: boolean;
  onRestored: () => void | Promise<void>;
}) {
  const { projection, setProjection, refresh, loading, error, setError } =
    useAgentCapabilityProjection(agentId, agentRevision);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    setConfirmed(false);
  }, [agentId, agentRevision]);

  const restore = async (): Promise<void> => {
    if (!projection || !confirmed || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await restoreRecommendedAgentCapabilities(agentId, {
        schemaVersion: 1,
        expectedRevision: projection.agentRevision,
        diffSha256: projection.restorePreview.diffSha256,
      });
      setProjection(result.projection);
      setConfirmed(false);
      await onRestored();
    } catch (reason) {
      setConfirmed(false);
      if (reason instanceof NapierApiError && reason.status === 409) {
        try {
          const authoritative = await refresh();
          setError(
            authoritative
              ? `${copy.capabilityConflictRefreshed} REV ${String(authoritative.agentRevision)} · ${authoritative.restorePreview.diffSha256}`
              : copy.capabilityConflictRefreshFailed,
          );
        } catch {
          setError(copy.capabilityConflictRefreshFailed);
        }
      } else {
        setError(formatApiErrorMessage(reason));
      }
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <p className="agent-capability-contract-loading">
        {copy.capabilityContractLoading}
      </p>
    );
  }
  if (!projection) {
    return (
      <p className="agent-capability-contract-error" role="alert">
        {error ?? copy.capabilityContractUnavailable}
      </p>
    );
  }

  const readinessProblems = projection.readiness.filter(
    (item) => !["ready", "catalog_only"].includes(item.status),
  );
  const operations = projection.restorePreview.operations;
  return (
    <section
      id="agent-capability-contract-review"
      className={`agent-capability-contract state-${projection.driftState}`}
      aria-label={copy.capabilityContract}
      tabIndex={-1}
    >
      <header>
        <span className="agent-capability-contract-icon" aria-hidden="true">
          {projection.driftState === "current" ? (
            <ShieldCheck size={14} />
          ) : (
            <AlertTriangle size={14} />
          )}
        </span>
        <div>
          <strong>{copy.capabilityContract}</strong>
          <span>
            v{projection.contractVersion} · {projection.driftState} ·{" "}
            {projection.ownership}
          </span>
        </div>
        <code>rev {projection.agentRevision}</code>
      </header>
      <p>{copy.capabilityContractBody}</p>
      <dl className="agent-capability-contract-facts">
        <div>
          <dt>{copy.capabilityConfigured}</dt>
          <dd>{projection.configuredTools.length}</dd>
        </div>
        <div>
          <dt>{copy.capabilityExposed}</dt>
          <dd>{projection.runtimeExposedTools.length}</dd>
        </div>
        <div>
          <dt>{copy.capabilityReadinessIssues}</dt>
          <dd>{readinessProblems.length}</dd>
        </div>
      </dl>
      {projection.explicitOverrideFields.length > 0 ? (
        <p className="agent-capability-contract-overrides">
          <strong>{copy.capabilityExplicitOverrides}</strong>
          <span>
            {[...projection.explicitOverrideFields]
              .sort(compareText)
              .join(", ")}
          </span>
        </p>
      ) : null}
      <details>
        <summary>
          {copy.capabilityRestoreDiff} · {operations.length}{" "}
          {copy.capabilityChanges}
        </summary>
        {operations.length > 0 ? (
          <ul className="agent-capability-contract-diff">
            {operations.map((operation) => (
              <li
                key={`${operation.field}:${operation.operation}:${operation.value}`}
              >
                <code>{operation.operation}</code>
                <span>{operation.field}</span>
                <strong>{operation.value}</strong>
                <em className={`risk-${operation.risk}`}>
                  {operation.effect} · {operation.risk}
                </em>
              </li>
            ))}
          </ul>
        ) : (
          <p>{copy.capabilityNoChanges}</p>
        )}
        <p className="agent-capability-contract-hash">
          {copy.capabilityDiffHash}{" "}
          <code>{projection.restorePreview.diffSha256}</code>
        </p>
      </details>
      <details>
        <summary>
          {copy.capabilityReadiness} · {projection.readiness.length}
        </summary>
        <ul className="agent-capability-readiness">
          {projection.readiness.map((item) => (
            <li key={item.id}>
              <span>
                {item.status === "ready" ? (
                  <Check size={10} />
                ) : (
                  <AlertTriangle size={10} />
                )}
              </span>
              <code>{item.id}</code>
              <em>{item.status}</em>
            </li>
          ))}
        </ul>
      </details>
      <label className="agent-capability-restore-confirmation">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={disabled || busy}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        {copy.capabilityRestoreConfirm}
      </label>
      <button
        type="button"
        className="agent-capability-restore"
        disabled={disabled || busy || !confirmed}
        onClick={() => void restore()}
      >
        <RefreshCw size={12} aria-hidden="true" />
        {busy ? copy.capabilityRestoring : copy.capabilityRestore}
      </button>
      {error ? (
        <p className="agent-capability-contract-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
