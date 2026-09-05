import type { AgentTool } from "@earendil-works/pi-agent-core";

import { defineInternalToolProtocolV2 } from "./tool-protocol-declaration.js";
import {
  browserToolResultSchema,
  jsonSchema,
  toolUiProjectionSchema,
} from "./tool-protocol-schema.js";

const SIDE_EFFECT_FREE_ACTION_NAMES = Object.freeze([
  "start",
  "preview_workspace",
  "navigate",
  "back",
  "forward",
  "tab_new",
  "tab_list",
  "tab_switch",
  "tab_close",
  "wait",
  "find",
  "scroll",
  "snapshot",
  "screenshot",
  "console",
  "close",
]);
const SIDE_EFFECT_FREE_ACTIONS = new Set(SIDE_EFFECT_FREE_ACTION_NAMES);

export function defineBrowserToolProtocol<T extends AgentTool>(tool: T): T {
  return defineInternalToolProtocolV2(
    tool,
    {
      historicalDefinitions: [
        {
          kind: "napier.tool-protocol-historical-definition",
          schemaVersion: 1,
          generation: "v2.remote_mutation_neutral",
          sourceMode: "native",
          definitionSha256:
            "8f78e21138e81fd05bcab6c13723d92626f9d59670593031fa9d0dd804c7ff2f",
          replayOnly: true,
        },
        {
          kind: "napier.tool-protocol-historical-definition",
          schemaVersion: 1,
          generation: "v2.progress",
          sourceMode: "native",
          definitionSha256:
            "8a6b5e4b625bfde7dae2b1b94a004fdd040ff249d1555eed65981da0b6a6a439",
          replayOnly: true,
        },
        {
          kind: "napier.tool-protocol-historical-definition",
          schemaVersion: 1,
          generation: "v2.pre_progress",
          sourceMode: "native",
          definitionSha256:
            "eecac5e391814eb027f5775b7dc05a678d228e52177be00b194f9fd00544f2ac",
          replayOnly: true,
        },
      ],
      definition: {
        schemaVersion: 2,
        id: tool.name,
        version: "2.1.0",
        capabilityUris: ["cap://tools/browser"],
        inputSchema: jsonSchema(tool.parameters),
        canonicalOutputSchema: browserToolResultSchema("canonical"),
        modelVisibleOutputSchema: browserToolResultSchema("model_visible"),
        uiProjectionSchema: toolUiProjectionSchema(tool.name),
        concurrency: "serialized",
        sideEffect: "unknown",
        sideEffectMode: "input_dependent",
        retry: { strategy: "not_started", maxAttempts: 2 },
        idempotency: { key: "none", resultReplay: "never" },
        approval: { mode: "explicit", codeBridge: "external_checkpoint" },
        policyTags: ["browser:session", "effect:input-dependent"],
      },
      sideEffectResolution: {
        schemaVersion: 1,
        classificationVersion: "1.0.0",
        semanticIdentity: {
          sideEffectFreeActions: [...SIDE_EFFECT_FREE_ACTION_NAMES],
        },
        resolve: browserToolSideEffect,
      },
    },
  );
}

function browserToolSideEffect(input: unknown, semanticIdentity: unknown) {
  const action =
    input && typeof input === "object" && "action" in input
      ? String((input as { action?: unknown }).action)
      : "";
  const readActions =
    semanticIdentity &&
    typeof semanticIdentity === "object" &&
    "sideEffectFreeActions" in semanticIdentity &&
    Array.isArray(
      (semanticIdentity as { sideEffectFreeActions?: unknown })
        .sideEffectFreeActions,
    )
      ? (semanticIdentity as { sideEffectFreeActions: unknown[] })
          .sideEffectFreeActions
      : [];
  return readActions.includes(action)
    ? ("none" as const)
    : ("unknown" as const);
}

export function isSideEffectFreeBrowserAction(action: unknown): boolean {
  return SIDE_EFFECT_FREE_ACTIONS.has(String(action));
}
