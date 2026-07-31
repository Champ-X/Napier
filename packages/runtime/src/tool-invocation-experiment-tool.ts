import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Check } from "typebox/value";

import type { AgentRuntime } from "./agent-runtime.js";
import { builtInToolEffect } from "./agent-tool-effects.js";
import { assessToolCall } from "./policy.js";
import { createStatelessAgentTools } from "./stateless-agent-tools.js";
import type { LocalStore } from "./store.js";
import {
  TOOL_INVOCATION_EXPERIMENT_TOOLS,
  toolDefinitionSha256,
} from "./tool-invocation-capsule.js";

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
  if (!TOOL_INVOCATION_EXPERIMENT_TOOLS.has(input.toolName)) {
    throw new Error("Tool invocation is not eligible for an experiment");
  }
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
  }).find((candidate) => candidate.name === input.toolName);
  if (
    !tool ||
    toolDefinitionSha256(tool) !== input.expectedDefinitionSha256 ||
    builtInToolEffect(input.toolName, input.arguments) !== "read"
  ) {
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
  const decision = assessToolCall(
    "observe",
    input.toolName,
    JSON.parse(JSON.stringify(input.arguments)),
    input.store.workspaceRoot,
  );
  if (!decision.allowed) {
    throw new Error("Tool invocation experiment policy denied execution");
  }
  return tool;
}
