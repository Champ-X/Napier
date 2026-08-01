import type { ExecutionPlanWorkflowExperimentPreview } from "@napier/contracts";

import { canonicalJson, sha256Text } from "./stable-digest";

const SHA256 = /^[a-f0-9]{64}$/u;

export async function validateWorkflowExperimentPreview(
  input: unknown,
): Promise<ExecutionPlanWorkflowExperimentPreview> {
  if (!record(input)) throw new Error("Workflow experiment preview is invalid");
  const schemaVersion = input["schemaVersion"];
  const singleNode = schemaVersion === 2;
  const simulatedNode = schemaVersion === 3;
  const replacedInput = schemaVersion === 4;
  const required = [
    "kind",
    "schemaVersion",
    "sourceThreadId",
    "sourcePlanId",
    "sourcePlanRevision",
    "sourceManifestSha256",
    "candidateManifestSha256",
    "sourceAgentId",
    "sourceAgentRevision",
    "fromNodeId",
    "reusedNodeIds",
    "rerunNodeIds",
    "modelOverrides",
    "toolEffects",
    "requiresSideEffectConfirmation",
    "previewSha256",
    ...(singleNode ? ["mode", "executionNodeIds", "stopBeforeNodeIds"] : []),
    ...(simulatedNode
      ? [
          "mode",
          "executionNodeIds",
          "simulatedNodeId",
          "simulatedOutputSha256",
          "simulatedOutputBytes",
        ]
      : []),
    ...(replacedInput
      ? [
          "mode",
          "executionNodeIds",
          "replacedInputNodeId",
          "replacementInputSha256",
          "replacementInputBytes",
        ]
      : []),
  ];
  if (
    !exactKeys(input, required) ||
    input["kind"] !== "napier.execution-plan-workflow-experiment-preview" ||
    (schemaVersion !== 1 &&
      schemaVersion !== 2 &&
      schemaVersion !== 3 &&
      schemaVersion !== 4) ||
    typeof input["sourceThreadId"] !== "string" ||
    typeof input["sourcePlanId"] !== "string" ||
    !positiveInteger(input["sourcePlanRevision"]) ||
    !hash(input["sourceManifestSha256"]) ||
    !hash(input["candidateManifestSha256"]) ||
    typeof input["sourceAgentId"] !== "string" ||
    !positiveInteger(input["sourceAgentRevision"]) ||
    typeof input["fromNodeId"] !== "string" ||
    !stringArray(input["reusedNodeIds"], 30) ||
    !stringArray(input["rerunNodeIds"], 30) ||
    input["rerunNodeIds"].length < 1 ||
    !input["rerunNodeIds"].includes(input["fromNodeId"]) ||
    (singleNode &&
      (input["mode"] !== "single_node" ||
        !stringArray(input["executionNodeIds"], 30) ||
        !sameStrings(input["executionNodeIds"], [input["fromNodeId"]]) ||
        !stringArray(input["stopBeforeNodeIds"], 16) ||
        input["stopBeforeNodeIds"].some(
          (nodeId) =>
            nodeId === input["fromNodeId"] ||
            !(input["rerunNodeIds"] as string[]).includes(nodeId),
        ))) ||
    (simulatedNode &&
      (input["mode"] !== "simulate_node" ||
        !stringArray(input["executionNodeIds"], 30) ||
        input["simulatedNodeId"] !== input["fromNodeId"] ||
        input["executionNodeIds"].includes(input["fromNodeId"]) ||
        input["executionNodeIds"].some(
          (nodeId) => !(input["rerunNodeIds"] as string[]).includes(nodeId),
        ) ||
        !hash(input["simulatedOutputSha256"]) ||
        !positiveInteger(input["simulatedOutputBytes"]) ||
        Number(input["simulatedOutputBytes"]) > 32 * 1024)) ||
    (replacedInput &&
      (input["mode"] !== "replace_input" ||
        !stringArray(input["executionNodeIds"], 30) ||
        input["replacedInputNodeId"] !== input["fromNodeId"] ||
        !sameStrings(
          input["executionNodeIds"],
          input["rerunNodeIds"] as string[],
        ) ||
        !hash(input["replacementInputSha256"]) ||
        !positiveInteger(input["replacementInputBytes"]) ||
        Number(input["replacementInputBytes"]) > 32 * 1024)) ||
    !record(input["modelOverrides"]) ||
    !Array.isArray(input["toolEffects"]) ||
    typeof input["requiresSideEffectConfirmation"] !== "boolean" ||
    !hash(input["previewSha256"])
  ) {
    throw new Error("Workflow experiment preview is invalid");
  }
  const reusedNodeIds = input["reusedNodeIds"] as string[];
  const rerunNodeIds = input["rerunNodeIds"] as string[];
  const executionNodeIds =
    singleNode || simulatedNode || replacedInput
      ? (input["executionNodeIds"] as string[])
      : rerunNodeIds;
  const modelOverrides = input["modelOverrides"] as Record<string, unknown>;
  if (
    reusedNodeIds.some((nodeId) => rerunNodeIds.includes(nodeId)) ||
    Object.keys(modelOverrides).some(
      (nodeId) => !executionNodeIds.includes(nodeId),
    )
  ) {
    throw new Error("Workflow experiment preview node sets are invalid");
  }
  for (const effects of input["toolEffects"]) {
    if (!validToolEffects(effects)) {
      throw new Error("Workflow experiment tool effects are invalid");
    }
  }
  const effects = input["toolEffects"] as Array<Record<string, unknown>>;
  if (
    !sameStrings(
      effects.map((effect) => String(effect["nodeId"])),
      executionNodeIds,
    ) ||
    input["requiresSideEffectConfirmation"] !==
      effects.some(
        (effect) =>
          Number(effect["writeCount"]) > 0 ||
          Number(effect["unknownCount"]) > 0 ||
          Number(effect["unresolvedCount"]) > 0,
      )
  ) {
    throw new Error("Workflow experiment tool effect binding is invalid");
  }
  const { previewSha256: _previewSha256, ...content } = input;
  if ((await sha256Text(canonicalJson(content))) !== input["previewSha256"]) {
    throw new Error("Workflow experiment preview hash is invalid");
  }
  return structuredClone(
    input,
  ) as unknown as ExecutionPlanWorkflowExperimentPreview;
}

function validToolEffects(input: unknown): boolean {
  if (!record(input)) return false;
  return (
    typeof input["nodeId"] === "string" &&
    nonNegativeInteger(input["attemptCount"]) &&
    nonNegativeInteger(input["toolCallCount"]) &&
    nonNegativeInteger(input["readOnlyCount"]) &&
    nonNegativeInteger(input["writeCount"]) &&
    nonNegativeInteger(input["unknownCount"]) &&
    nonNegativeInteger(input["unresolvedCount"]) &&
    stringArray(input["writeToolNames"], 128) &&
    stringArray(input["unknownToolNames"], 128)
  );
}

function sameStrings(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function exactKeys(input: Record<string, unknown>, keys: string[]): boolean {
  const expected = new Set(keys);
  return (
    Object.keys(input).length === keys.length &&
    Object.keys(input).every((key) => expected.has(key))
  );
}

function record(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === "object" && !Array.isArray(input);
}

function hash(input: unknown): input is string {
  return typeof input === "string" && SHA256.test(input);
}

function positiveInteger(input: unknown): input is number {
  return Number.isSafeInteger(input) && Number(input) >= 1;
}

function nonNegativeInteger(input: unknown): input is number {
  return Number.isSafeInteger(input) && Number(input) >= 0;
}

function stringArray(input: unknown, maximum: number): input is string[] {
  return (
    Array.isArray(input) &&
    input.length <= maximum &&
    input.every((value) => typeof value === "string")
  );
}
