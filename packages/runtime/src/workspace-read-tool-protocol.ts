import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { TSchema } from "typebox";

import { defineToolProgress, progressSemantics, recordValue, resultDetails, stableFields } from "./tool-progress-semantics.js";
import { defineInternalToolProtocolV2 } from "./tool-protocol-declaration.js";
import {
  jsonSchema,
  readFileToolResultSchema,
  toolUiProjectionSchema,
} from "./tool-protocol-schema.js";

export function defineWorkspaceReadToolProtocol<
  TParameters extends TSchema,
  TDetails,
>(
  tool: AgentTool<TParameters, TDetails>,
): AgentTool<TParameters, TDetails> {
  const progressed = defineToolProgress(tool, {
    schemaVersion: 1,
    classificationVersion: "1.0.0",
    modes: [
      {
        modeId: "observe_workspace_file",
        operation: "observe",
        scope: "workspace",
        contribution: "supporting",
      },
    ],
    resolve: (input) => ({
      semantics: progressSemantics("observe", "workspace", "supporting"),
      resourceKey: {
        kind: "workspace-file",
        path: recordValue(input)["path"],
      },
    }),
    state: (_input, result) =>
      stableFields(resultDetails(result), [
        "pathSha256",
        "sha256",
        "startLine",
        "endLine",
        "lineAnchorSetSha256",
      ]),
  });
  return defineInternalToolProtocolV2(progressed, {
    historicalDefinitions: [
      {
        kind: "napier.tool-protocol-historical-definition",
        schemaVersion: 1,
        generation: "v2.progress",
        sourceMode: "native",
        definitionSha256:
          "4f04a54698d899e2a8cef3a06621214ec82bb4d9d6fca2b867df51221be509e1",
        replayOnly: true,
      },
      {
        kind: "napier.tool-protocol-historical-definition",
        schemaVersion: 1,
        generation: "v2.pre_progress",
        sourceMode: "native",
        definitionSha256:
          "70f85ca808e4cb251e78694663c7c28c3cdbef49b59cb4680655f4caf3bea9d3",
        replayOnly: true,
      },
    ],
    definition: {
      schemaVersion: 2,
      id: progressed.name,
      version: "2.0.0",
      capabilityUris: ["cap://tools/read_file"],
      inputSchema: jsonSchema(progressed.parameters),
      canonicalOutputSchema: readFileToolResultSchema("canonical"),
      modelVisibleOutputSchema: readFileToolResultSchema("model_visible"),
      uiProjectionSchema: toolUiProjectionSchema(progressed.name),
      concurrency: "safe",
      sideEffect: "none",
      sideEffectMode: "static",
      retry: { strategy: "terminal_failure", maxAttempts: 2 },
      idempotency: { key: "arguments", resultReplay: "exact_result_only" },
      approval: { mode: "none", codeBridge: "allowed" },
      policyTags: ["workspace:read", "replay:exact-result"],
    },
  });
}
