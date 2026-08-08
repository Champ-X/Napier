import type { EffectiveAgentCapabilityProjectionV1 } from "@napier/contracts/agent-capability-contract";

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

export function focusCapabilityContract(attempt = 0): void {
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
