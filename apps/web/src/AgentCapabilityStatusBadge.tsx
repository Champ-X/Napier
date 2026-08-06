import type { AgentProfile } from "@napier/contracts";
import { AlertTriangle, ArrowRight, ShieldCheck } from "lucide-react";

import { agentCapabilityBadgeText } from "./agent-capability-view-model";
import { useAgentCapabilityProjection } from "./use-agent-capability-projection";
import type { EffectiveAgentCapabilityProjectionV1 } from "@napier/contracts/agent-capability-contract";
import "./agent-capability-composer.css";

export function AgentCapabilityStatusBadge({
  agent,
  onReview,
}: {
  agent: AgentProfile | undefined;
  onReview: () => void;
}) {
  const { projection, loading, error } = useAgentCapabilityProjection(
    agent?.id,
    agent?.revision,
  );
  const summary = agentCapabilityComposerSummary(projection, loading, error);
  return (
    <div
      className={`agent-capability-composer state-${projection?.driftState ?? "loading"}`}
      aria-label="Effective Agent capabilities"
    >
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
  );
}

export function agentCapabilityComposerSummary(
  projection: EffectiveAgentCapabilityProjectionV1 | undefined,
  loading: boolean,
  error: string | undefined,
): { contract: string; readiness?: string } {
  if (!projection) {
    return {
      contract: loading
        ? "contract loading"
        : `contract unavailable${error ? " · retry in Context" : ""}`,
    };
  }
  const unavailable = projection.readiness.filter((item) =>
    ["unavailable", "missing", "unknown_configured"].includes(item.status),
  ).length;
  const catalogOnly = projection.readiness.filter(
    (item) => item.status === "catalog_only",
  ).length;
  const unverified = projection.readiness.filter(
    (item) => item.status === "available_unverified",
  ).length;
  const overrides = [...projection.explicitOverrideFields].sort(compareText);
  return {
    contract: `contract v${projection.contractVersion} · ${projection.driftState} · ${projection.ownership}${overrides.length > 0 ? ` · overrides ${overrides.join(", ")}` : ""}`,
    readiness: `${unavailable} unavailable · ${catalogOnly} catalog-only · ${unverified} unverified`,
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function focusCapabilityContract(attempt = 0): void {
  const target = document.getElementById("agent-capability-contract-review");
  if (target) {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    target.focus({ preventScroll: true });
    return;
  }
  if (attempt < 20) {
    window.setTimeout(() => focusCapabilityContract(attempt + 1), 50);
  }
}

export default AgentCapabilityStatusBadge;
