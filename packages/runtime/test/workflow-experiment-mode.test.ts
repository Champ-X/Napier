import type { ExecutionPlanWorkflowManifest } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { projectWorkflowExperimentExecution } from "../src/workflow-experiment-mode.js";

describe("Workflow experiment execution mode", () => {
  it("projects full-subgraph and single-node sets in Manifest order", () => {
    const manifest = workflowManifest([
      ["prepare", []],
      ["left", ["prepare"]],
      ["right", ["prepare"]],
      ["join", ["left", "right"]],
      ["unrelated", []],
    ]);
    expect(
      projectWorkflowExperimentExecution(manifest, "prepare", "subgraph"),
    ).toEqual({
      mode: "subgraph",
      rerunNodeIds: ["prepare", "left", "right", "join"],
      executionNodeIds: ["prepare", "left", "right", "join"],
      stopBeforeNodeIds: [],
    });
    expect(
      projectWorkflowExperimentExecution(manifest, "prepare", "replace_input"),
    ).toEqual({
      mode: "replace_input",
      rerunNodeIds: ["prepare", "left", "right", "join"],
      executionNodeIds: ["prepare", "left", "right", "join"],
      stopBeforeNodeIds: [],
    });
    expect(
      projectWorkflowExperimentExecution(manifest, "prepare", "single_node"),
    ).toEqual({
      mode: "single_node",
      rerunNodeIds: ["prepare", "left", "right", "join"],
      executionNodeIds: ["prepare"],
      stopBeforeNodeIds: ["left", "right"],
    });
    expect(
      projectWorkflowExperimentExecution(manifest, "prepare", "simulate_node"),
    ).toEqual({
      mode: "simulate_node",
      rerunNodeIds: ["prepare", "left", "right", "join"],
      executionNodeIds: ["left", "right", "join"],
      stopBeforeNodeIds: [],
    });
    expect(
      projectWorkflowExperimentExecution(manifest, "join", "single_node"),
    ).toEqual({
      mode: "single_node",
      rerunNodeIds: ["join"],
      executionNodeIds: ["join"],
      stopBeforeNodeIds: [],
    });
    expect(
      projectWorkflowExperimentExecution(manifest, "join", "simulate_node"),
    ).toEqual({
      mode: "simulate_node",
      rerunNodeIds: ["join"],
      executionNodeIds: [],
      stopBeforeNodeIds: [],
    });
  });

  it("rejects unknown checkpoints and an unrepresentable successor fan-out", () => {
    const manifest = workflowManifest([
      ["root", []],
      ...Array.from(
        { length: 17 },
        (_, index) => [`child_${String(index)}`, ["root"]] as const,
      ),
    ]);
    expect(() =>
      projectWorkflowExperimentExecution(manifest, "missing", "single_node"),
    ).toThrow("not in the Manifest");
    expect(() =>
      projectWorkflowExperimentExecution(manifest, "root", "single_node"),
    ).toThrow("exceeds 16 direct successors");
  });
});

function workflowManifest(
  nodes: ReadonlyArray<readonly [string, readonly string[]]>,
): ExecutionPlanWorkflowManifest {
  return {
    nodes: nodes.map(([id]) => ({ id })),
    blueprint: {
      steps: nodes.map(([id, dependsOn]) => ({
        id,
        ...(dependsOn.length > 0 ? { dependsOn: [...dependsOn] } : {}),
      })),
    },
  } as unknown as ExecutionPlanWorkflowManifest;
}
