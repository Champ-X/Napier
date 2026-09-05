import type { AgentTool } from "@earendil-works/pi-agent-core";

import { defineInternalToolProtocolV2 } from "../src/tool-protocol-declaration.js";
import {
  genericToolResultSchema,
  jsonSchema,
  toolUiProjectionSchema,
} from "../src/tool-protocol-schema.js";

export function defineReplayableTestReadTool<T extends AgentTool>(
  tool: T,
  historicalDefinitionSha256s: readonly string[] = [],
): T {
  return defineInternalToolProtocolV2(tool, {
    historicalDefinitions: historicalDefinitionSha256s.map(
      (definitionSha256, index) => ({
        kind: "napier.tool-protocol-historical-definition",
        schemaVersion: 1,
        generation: `test.history.${String(index + 1)}`,
        sourceMode: "compatibility",
        definitionSha256,
        replayOnly: true,
      }),
    ),
    definition: {
      schemaVersion: 2,
      id: tool.name,
      version: "2.0.0-test.1",
      capabilityUris: [`cap://tools/${encodeURIComponent(tool.name)}`],
      inputSchema: jsonSchema(tool.parameters),
      canonicalOutputSchema: genericToolResultSchema("canonical"),
      modelVisibleOutputSchema: genericToolResultSchema("model_visible"),
      uiProjectionSchema: toolUiProjectionSchema(tool.name),
      concurrency: "safe",
      sideEffect: "none",
      sideEffectMode: "static",
      retry: { strategy: "terminal_failure", maxAttempts: 2 },
      idempotency: { key: "arguments", resultReplay: "exact_result_only" },
      approval: { mode: "none", codeBridge: "allowed" },
      policyTags: ["test:replayable-read"],
    },
  });
}
