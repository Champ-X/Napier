import { AGENT_TOOL_NAMES } from "@napier/contracts";
import type { CapabilityReadinessRecord } from "@napier/contracts/agent-capability-contract";

import { environmentDegradedToolAllowed } from "./environment-capability-projection.js";

const KNOWN_TOOL_NAMES = new Set<string>(AGENT_TOOL_NAMES);

export function projectAgentToolReadiness(
  configuredTools: readonly string[],
  runtimeExposedTools: readonly string[],
  environmentDegraded = false,
): CapabilityReadinessRecord[] {
  const exposed = new Set(runtimeExposedTools);
  return [...new Set(configuredTools)].sort().map((name) => {
    if (!KNOWN_TOOL_NAMES.has(name)) {
      return {
        id: `tool:${name}`,
        status: "unknown_configured" as const,
        configured: true,
        allowedByPolicy: false,
        exposed: false,
        detail: "Unknown configured tool is preserved but never exposed",
      };
    }
    if (!exposed.has(name)) {
      if (environmentDegraded && !environmentDegradedToolAllowed(name)) {
        return {
          id: `tool:${name}`,
          status: "unavailable" as const,
          configured: true,
          allowedByPolicy: true,
          exposed: false,
          detail:
            "Configured tool is withheld from this environment because the process Sandbox is unavailable; the Run can continue with the safe read-only tool surface",
        };
      }
      if (name === "skill_load") {
        return {
          id: `tool:${name}`,
          status: "unavailable" as const,
          configured: true,
          allowedByPolicy: true,
          exposed: false,
          detail:
            "Skill loader is policy-allowed but no safe Project Skill snapshot is available",
        };
      }
      return {
        id: `tool:${name}`,
        status: "blocked_by_policy" as const,
        configured: true,
        allowedByPolicy: false,
        exposed: false,
        detail: "Configured tool is blocked by the effective policy",
      };
    }
    const externallyVerified = ![
      "web_search",
      "web_fetch",
      "browser",
      "research_source",
    ].includes(name);
    return {
      id: `tool:${name}`,
      status: externallyVerified
        ? ("ready" as const)
        : ("available_unverified" as const),
      configured: true,
      allowedByPolicy: true,
      exposed: true,
      detail: externallyVerified
        ? "Tool is constructed and exposed by the current Runtime"
        : "Tool is exposed; external dependency health is not claimed",
    };
  });
}
