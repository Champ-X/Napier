export function workflowExperimentEventTraceParts(
  payload: Record<string, unknown>,
): string[] | undefined {
  const fromNodeId = nodeId(payload["fromNodeId"]);
  const reusedNodeIds = nodeIds(payload["reusedNodeIds"]);
  const rerunNodeIds = nodeIds(payload["rerunNodeIds"]);
  const executionMode = payload["executionMode"];
  const executionNodeIds = nodeIds(payload["executionNodeIds"]);
  const stopBeforeNodeIds = nodeIds(payload["stopBeforeNodeIds"]);
  const simulationNodeId = nodeId(payload["simulationNodeId"]);
  const simulatedOutputSha256 = hash(payload["simulatedOutputSha256"]);
  const simulatedOutputBytes = boundedInteger(
    payload["simulatedOutputBytes"],
    1,
    32 * 1024,
  );
  const replacedInputNodeId = nodeId(payload["replacedInputNodeId"]);
  const replacementInputSha256 = hash(payload["replacementInputSha256"]);
  const replacementInputBytes = boundedInteger(
    payload["replacementInputBytes"],
    1,
    32 * 1024,
  );
  const replacementWorkflowInputSha256 = hash(
    payload["replacementWorkflowInputSha256"],
  );
  const replacementWorkflowInputBytes = boundedInteger(
    payload["replacementWorkflowInputBytes"],
    1,
    32 * 1024,
  );
  const previewSha256 = hash(payload["previewSha256"]);
  if (
    (executionMode === "replace_workflow_input"
      ? fromNodeId !== undefined
      : !fromNodeId) ||
    !reusedNodeIds ||
    !rerunNodeIds ||
    !previewSha256 ||
    typeof payload["sideEffectsConfirmed"] !== "boolean" ||
    (executionMode !== undefined &&
      executionMode !== "single_node" &&
      executionMode !== "step_nodes" &&
      executionMode !== "simulate_node" &&
      executionMode !== "replace_input" &&
      executionMode !== "replace_workflow_input") ||
    (executionMode === "single_node" || executionMode === "step_nodes"
      ? !executionNodeIds ||
        !stopBeforeNodeIds ||
        executionNodeIds.length !== 1 ||
        executionNodeIds[0] !== fromNodeId ||
        stopBeforeNodeIds.length > 16 ||
        (executionMode === "step_nodes" &&
          !sameStrings(
            stopBeforeNodeIds,
            rerunNodeIds.filter((candidate) => candidate !== fromNodeId),
          )) ||
        simulationNodeId !== undefined ||
        simulatedOutputSha256 !== undefined ||
        simulatedOutputBytes !== undefined ||
        replacedInputNodeId !== undefined ||
        replacementInputSha256 !== undefined ||
        replacementInputBytes !== undefined ||
        replacementWorkflowInputSha256 !== undefined ||
        replacementWorkflowInputBytes !== undefined
      : executionMode === "simulate_node"
        ? !executionNodeIds ||
          stopBeforeNodeIds !== undefined ||
          simulationNodeId !== fromNodeId ||
          !simulatedOutputSha256 ||
          simulatedOutputBytes === undefined ||
          replacedInputNodeId !== undefined ||
          replacementInputSha256 !== undefined ||
          replacementInputBytes !== undefined ||
          replacementWorkflowInputSha256 !== undefined ||
          replacementWorkflowInputBytes !== undefined
        : executionMode === "replace_input"
          ? !executionNodeIds ||
            stopBeforeNodeIds !== undefined ||
            replacedInputNodeId !== fromNodeId ||
            !replacementInputSha256 ||
            replacementInputBytes === undefined ||
            simulationNodeId !== undefined ||
            simulatedOutputSha256 !== undefined ||
            simulatedOutputBytes !== undefined ||
            replacementWorkflowInputSha256 !== undefined ||
            replacementWorkflowInputBytes !== undefined
          : executionMode === "replace_workflow_input"
            ? !executionNodeIds ||
              stopBeforeNodeIds !== undefined ||
              reusedNodeIds.length !== 0 ||
              !sameStrings(executionNodeIds, rerunNodeIds) ||
              !replacementWorkflowInputSha256 ||
              replacementWorkflowInputBytes === undefined ||
              simulationNodeId !== undefined ||
              simulatedOutputSha256 !== undefined ||
              simulatedOutputBytes !== undefined ||
              replacedInputNodeId !== undefined ||
              replacementInputSha256 !== undefined ||
              replacementInputBytes !== undefined
            : executionNodeIds !== undefined ||
              stopBeforeNodeIds !== undefined ||
              simulationNodeId !== undefined ||
              simulatedOutputSha256 !== undefined ||
              simulatedOutputBytes !== undefined ||
              replacedInputNodeId !== undefined ||
              replacementInputSha256 !== undefined ||
              replacementInputBytes !== undefined ||
              replacementWorkflowInputSha256 !== undefined ||
              replacementWorkflowInputBytes !== undefined)
  ) {
    return undefined;
  }
  return [
    executionMode === "replace_workflow_input"
      ? "from Workflow input"
      : `from ${fromNodeId}`,
    `reused ${String(reusedNodeIds.length)}`,
    `rerun ${String(rerunNodeIds.length)}`,
    ...(executionMode === "single_node" || executionMode === "step_nodes"
      ? [
          executionMode === "single_node"
            ? "mode single-node"
            : "mode step-nodes",
          `execute ${String(executionNodeIds!.length)}`,
          `stop-before ${String(stopBeforeNodeIds!.length)}`,
        ]
      : executionMode === "simulate_node"
        ? [
            "mode simulate-node",
            `execute ${String(executionNodeIds!.length)}`,
            `simulated ${simulationNodeId}`,
            `simulation ${simulatedOutputSha256!.slice(0, 12)}`,
            `bytes ${String(simulatedOutputBytes)}`,
          ]
        : executionMode === "replace_input"
          ? [
              "mode replace-input",
              `execute ${String(executionNodeIds!.length)}`,
              `input-replaced ${replacedInputNodeId}`,
              `replacement ${replacementInputSha256!.slice(0, 12)}`,
              `bytes ${String(replacementInputBytes)}`,
            ]
          : executionMode === "replace_workflow_input"
            ? [
                "mode replace-workflow-input",
                `execute ${String(executionNodeIds!.length)}`,
                `replacement ${replacementWorkflowInputSha256!.slice(0, 12)}`,
                `bytes ${String(replacementWorkflowInputBytes)}`,
              ]
            : []),
    `preview ${previewSha256.slice(0, 12)}`,
    payload["sideEffectsConfirmed"] ? "side-effects confirmed" : "read-only",
  ];
}

function nodeId(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-z][a-z0-9_-]{0,63}$/u.test(value)
    ? value
    : undefined;
}

function nodeIds(value: unknown): string[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length > 30 ||
    value.some((item) => !nodeId(item)) ||
    new Set(value).size !== value.length
  ) {
    return undefined;
  }
  return value as string[];
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  return Number.isSafeInteger(value) &&
    Number(value) >= minimum &&
    Number(value) <= maximum
    ? Number(value)
    : undefined;
}

function hash(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
    ? value
    : undefined;
}

function sameStrings(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
