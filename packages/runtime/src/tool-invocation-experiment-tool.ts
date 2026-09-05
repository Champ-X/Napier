import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Check } from "typebox/value";

import type { AgentRuntime } from "./agent-runtime.js";
import { bindBuiltInToolCompatibilityPolicy } from "./agent-tool-effects.js";
import { assessToolCall } from "./policy.js";
import { createStatelessAgentTools } from "./stateless-agent-tools.js";
import type { LocalStore } from "./store.js";
import { requireToolInvocationExperimentProtocol } from "./tool-invocation-experiment-eligibility.js";
import { createOwnedToolRecordV2 } from "./tool-protocol-registry.js";

export function resolveToolInvocationExperimentTool(input: {
  store: LocalStore;
  runtime: AgentRuntime;
  agentId: string;
  agentRevision: number;
  threadId: string;
  runId: string;
  toolName: string;
  arguments: unknown;
  expectedDefinitionSha256: string;
}): AgentTool {
  const profile = input.store.getAgentRevision(
    input.agentId,
    input.agentRevision,
  ).profile;
  const tool = createStatelessAgentTools({
    store: input.store,
    profile,
    threadId: input.threadId,
    runId: input.runId,
    sandbox: input.runtime.verificationSandbox,
    restrictedReadOnlyExecution: true,
  })
    .map(bindBuiltInToolCompatibilityPolicy)
    .find((candidate) => candidate.name === input.toolName);
  if (!tool) {
    throw new Error(
      "Tool invocation experiment tool definition is unavailable or changed",
    );
  }
  let argumentsValid = false;
  try {
    argumentsValid = Check(tool.parameters, input.arguments);
  } catch {
    argumentsValid = false;
  }
  if (!argumentsValid) {
    throw new Error("Tool invocation experiment arguments are invalid");
  }
  const protocol = createOwnedToolRecordV2(tool);
  try {
    requireToolInvocationExperimentProtocol(protocol, input.arguments);
  } catch {
    throw new Error(
      "Tool invocation experiment tool definition is unavailable or changed",
    );
  }
  if (!protocol.matchesDefinitionSha256(input.expectedDefinitionSha256)) {
    throw new Error(
      "Tool invocation experiment tool definition is unavailable or changed",
    );
  }
  const decision = assessToolCall(
    "observe",
    input.toolName,
    JSON.parse(JSON.stringify(input.arguments)),
    input.store.workspaceRoot,
    protocol.invocation(input.arguments),
  );
  if (!decision.allowed) {
    throw new Error("Tool invocation experiment policy denied execution");
  }
  return tool;
}
