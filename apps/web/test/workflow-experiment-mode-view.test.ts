import type {
  ExecutionPlanWorkflowExperimentPreview,
  ExecutionPlanWorkflowManifest,
} from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { workflowExperimentPreviewMatchesMode } from "../src/workflow-experiment-mode-view";

describe("Workflow experiment execution mode projection", () => {
  it("binds single-node execution to the exact rerun and direct-successor sets", () => {
    const manifest = workflowManifest();
    const preview = {
      schemaVersion: 2,
      mode: "single_node",
      fromNodeId: "prepare",
      reusedNodeIds: [],
      rerunNodeIds: ["prepare", "report", "publish"],
      executionNodeIds: ["prepare"],
      stopBeforeNodeIds: ["report"],
    } as unknown as ExecutionPlanWorkflowExperimentPreview;
    expect(
      workflowExperimentPreviewMatchesMode(
        preview,
        manifest,
        "prepare",
        "single_node",
      ),
    ).toBe(true);
    expect(
      workflowExperimentPreviewMatchesMode(
        {
          ...preview,
          stopBeforeNodeIds: ["publish"],
        } as ExecutionPlanWorkflowExperimentPreview,
        manifest,
        "prepare",
        "single_node",
      ),
    ).toBe(false);
    expect(
      workflowExperimentPreviewMatchesMode(
        preview,
        manifest,
        "prepare",
        "subgraph",
      ),
    ).toBe(false);
  });

  it("preserves the schema-v1 full-subgraph projection", () => {
    const preview = {
      schemaVersion: 1,
      fromNodeId: "report",
      reusedNodeIds: ["prepare"],
      rerunNodeIds: ["report", "publish"],
    } as unknown as ExecutionPlanWorkflowExperimentPreview;
    expect(
      workflowExperimentPreviewMatchesMode(
        preview,
        workflowManifest(),
        "report",
        "subgraph",
      ),
    ).toBe(true);
  });

  it("binds output simulation to the selected node and real descendants", () => {
    const preview = {
      schemaVersion: 3,
      mode: "simulate_node",
      fromNodeId: "prepare",
      reusedNodeIds: [],
      rerunNodeIds: ["prepare", "report", "publish"],
      executionNodeIds: ["report", "publish"],
      simulatedNodeId: "prepare",
    } as unknown as ExecutionPlanWorkflowExperimentPreview;
    expect(
      workflowExperimentPreviewMatchesMode(
        preview,
        workflowManifest(),
        "prepare",
        "simulate_node",
      ),
    ).toBe(true);
    expect(
      workflowExperimentPreviewMatchesMode(
        {
          ...preview,
          executionNodeIds: ["publish"],
        } as ExecutionPlanWorkflowExperimentPreview,
        workflowManifest(),
        "prepare",
        "simulate_node",
      ),
    ).toBe(false);
  });

  it("binds input replacement to the selected node and full rerun subgraph", () => {
    const preview = {
      schemaVersion: 4,
      mode: "replace_input",
      fromNodeId: "prepare",
      reusedNodeIds: [],
      rerunNodeIds: ["prepare", "report", "publish"],
      executionNodeIds: ["prepare", "report", "publish"],
      replacedInputNodeId: "prepare",
    } as unknown as ExecutionPlanWorkflowExperimentPreview;
    expect(
      workflowExperimentPreviewMatchesMode(
        preview,
        workflowManifest(),
        "prepare",
        "replace_input",
      ),
    ).toBe(true);
    expect(
      workflowExperimentPreviewMatchesMode(
        {
          ...preview,
          executionNodeIds: ["report", "publish"],
        } as ExecutionPlanWorkflowExperimentPreview,
        workflowManifest(),
        "prepare",
        "replace_input",
      ),
    ).toBe(false);
  });
});

function workflowManifest(): ExecutionPlanWorkflowManifest {
  return {
    nodes: [{ id: "prepare" }, { id: "report" }, { id: "publish" }],
    blueprint: {
      steps: [
        { id: "prepare" },
        { id: "report", dependsOn: ["prepare"] },
        { id: "publish", dependsOn: ["report"] },
      ],
    },
  } as unknown as ExecutionPlanWorkflowManifest;
}
