import type {
  AgentHarnessAcceptanceEvidence,
  AgentHarnessAcceptanceEvidenceContent,
} from "@napier/contracts/agent-harness-acceptance";

import { acceptanceBlockers } from "./agent-harness-acceptance-blockers.js";
import { projectAgentHarnessAcceptanceSummary } from "./agent-harness-acceptance-projection.js";
import {
  assertAgentHarnessAcceptanceContent,
  assertAgentHarnessAcceptanceShape,
  agentHarnessAcceptanceContent,
} from "./agent-harness-acceptance-validation.js";
import { canonicalJson, sha256 } from "./ed25519.js";

export {
  createHarnessLedgerRunEvidence,
  createSubagentRestartSnapshot,
} from "./agent-harness-evidence-snapshots.js";

export function createAgentHarnessAcceptanceEvidence(
  input: AgentHarnessAcceptanceEvidenceContent,
): AgentHarnessAcceptanceEvidence {
  assertAgentHarnessAcceptanceContent(input);
  const content = structuredClone(input);
  const summary = projectAgentHarnessAcceptanceSummary(content);
  const blockers = acceptanceBlockers(content, summary);
  const evidence = {
    ...content,
    summary,
    acceptanceReady: blockers.length === 0,
    blockers,
  };
  return { ...evidence, contentSha256: sha256(canonicalJson(evidence)) };
}

export function validateAgentHarnessAcceptanceEvidence(
  input: unknown,
): AgentHarnessAcceptanceEvidence {
  assertAgentHarnessAcceptanceShape(input);
  const rebuilt = createAgentHarnessAcceptanceEvidence(
    agentHarnessAcceptanceContent(input),
  );
  if (canonicalJson(rebuilt) !== canonicalJson(input)) {
    throw new Error("Agent Harness acceptance evidence hash is invalid");
  }
  return rebuilt;
}
