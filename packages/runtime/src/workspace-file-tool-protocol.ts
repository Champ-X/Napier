import type { AgentTool } from "@earendil-works/pi-agent-core";

import { defineInternalToolProtocolV2 } from "./tool-protocol-declaration.js";
import {
  jsonSchema,
  toolUiProjectionSchema,
  workspaceFileToolResultSchema,
} from "./tool-protocol-schema.js";

export function defineWorkspaceFilePreviewProtocol<T extends AgentTool>(
  tool: T,
): T {
  return defineInternalToolProtocolV2(tool, {
    historicalDefinitions: [
      {
        kind: "napier.tool-protocol-historical-definition",
        schemaVersion: 1,
        generation: "v2.progress",
        sourceMode: "native",
        definitionSha256:
          "29a7d94d0258c84a684d710dc920cc9727ceb9b20bd9373807280d584afd645a",
        replayOnly: true,
      },
      {
        kind: "napier.tool-protocol-historical-definition",
        schemaVersion: 1,
        generation: "v2.pre_progress",
        sourceMode: "native",
        definitionSha256:
          "885a4f1cdffe6014862bc84b901df0bb039929c630e672aaf132eceb89ac7071",
        replayOnly: true,
      },
    ],
    definition: {
      schemaVersion: 2,
      id: tool.name,
      version: "2.0.0",
      capabilityUris: ["cap://tools/workspace_file_preview"],
      inputSchema: jsonSchema(tool.parameters),
      canonicalOutputSchema: workspaceFileToolResultSchema("canonical"),
      modelVisibleOutputSchema:
        workspaceFileToolResultSchema("model_visible"),
      uiProjectionSchema: toolUiProjectionSchema(tool.name),
      concurrency: "safe",
      sideEffect: "none",
      sideEffectMode: "static",
      retry: { strategy: "terminal_failure", maxAttempts: 2 },
      idempotency: { key: "arguments", resultReplay: "never" },
      approval: { mode: "policy", codeBridge: "allowed" },
      policyTags: ["workspace:preview", "mutation:reversible"],
    },
  });
}

export function defineWorkspaceFileApplyProtocol<T extends AgentTool>(
  tool: T,
): T {
  return defineInternalToolProtocolV2(tool, {
    historicalDefinitions: [
      {
        kind: "napier.tool-protocol-historical-definition",
        schemaVersion: 1,
        generation: "v2.progress",
        sourceMode: "native",
        definitionSha256:
          "f22784d34d52848d2f640b2d54f0d71043cd1f540ee931086dc2d0a58b854d16",
        replayOnly: true,
      },
      {
        kind: "napier.tool-protocol-historical-definition",
        schemaVersion: 1,
        generation: "v2.pre_progress",
        sourceMode: "native",
        definitionSha256:
          "a59a6a93934f40b0a3629ba0cc777a508a80915faf79f537488a643aec9afeb7",
        replayOnly: true,
      },
    ],
    definition: {
      schemaVersion: 2,
      id: tool.name,
      version: "2.0.0",
      capabilityUris: ["cap://tools/workspace_file_apply"],
      inputSchema: jsonSchema(tool.parameters),
      canonicalOutputSchema: workspaceFileToolResultSchema("canonical"),
      modelVisibleOutputSchema:
        workspaceFileToolResultSchema("model_visible"),
      uiProjectionSchema: toolUiProjectionSchema(tool.name),
      concurrency: "exclusive",
      sideEffect: "reversible",
      sideEffectMode: "static",
      retry: { strategy: "not_started", maxAttempts: 2 },
      idempotency: { key: "preview_token", resultReplay: "never" },
      approval: { mode: "policy", codeBridge: "allowed" },
      policyTags: [
        "workspace:write",
        "mutation:reversible",
        "preview:required",
      ],
    },
  });
}
