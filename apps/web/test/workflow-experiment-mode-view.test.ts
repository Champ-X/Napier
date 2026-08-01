import type {
  ExecutionPlanWorkflowExperimentPreview,
  ExecutionPlanWorkflowManifest,
} from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { buildWorkflowExperimentRequest } from "../src/workflow-experiment-desk-helpers";
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

  it("binds step control to every remaining rerun node", () => {
    const preview = {
      schemaVersion: 5,
      mode: "step_nodes",
      fromNodeId: "prepare",
      reusedNodeIds: [],
      rerunNodeIds: ["prepare", "report", "publish"],
      executionNodeIds: ["prepare"],
      stopBeforeNodeIds: ["report", "publish"],
    } as unknown as ExecutionPlanWorkflowExperimentPreview;
    expect(
      workflowExperimentPreviewMatchesMode(
        preview,
        workflowManifest(),
        "prepare",
        "step_nodes",
      ),
    ).toBe(true);
    expect(
      workflowExperimentPreviewMatchesMode(
        {
          ...preview,
          stopBeforeNodeIds: ["report"],
        } as ExecutionPlanWorkflowExperimentPreview,
        workflowManifest(),
        "prepare",
        "step_nodes",
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

  it("binds top-level replacement to selector-free whole-graph execution", () => {
    const preview = {
      schemaVersion: 6,
      mode: "replace_workflow_input",
      reusedNodeIds: [],
      rerunNodeIds: ["prepare", "report", "publish"],
      executionNodeIds: ["prepare", "report", "publish"],
    } as unknown as ExecutionPlanWorkflowExperimentPreview;
    expect(
      workflowExperimentPreviewMatchesMode(
        preview,
        workflowManifest(),
        undefined,
        "replace_workflow_input",
      ),
    ).toBe(true);
    expect(
      workflowExperimentPreviewMatchesMode(
        preview,
        workflowManifest(),
        "prepare",
        "replace_workflow_input",
      ),
    ).toBe(false);
    expect(
      workflowExperimentPreviewMatchesMode(
        {
          ...preview,
          executionNodeIds: ["report", "publish"],
        } as ExecutionPlanWorkflowExperimentPreview,
        workflowManifest(),
        undefined,
        "replace_workflow_input",
      ),
    ).toBe(false);
  });

  it("builds a selector-free top-level replacement request", () => {
    const request = buildWorkflowExperimentRequest({
      manifest: workflowManifest(),
      fromNodeId: "prepare",
      mode: "replace_workflow_input",
      simulatedOutput: "",
      replacementInput: "",
      replacementWorkflowInput: '{"request":"replacement"}',
      replaceModel: true,
      canReplaceModel: true,
      selectedModelKey: "faux/model",
    });
    expect(request).toEqual({
      manifest: workflowManifest(),
      mode: "replace_workflow_input",
      replacementWorkflowInput: { request: "replacement" },
    });
    expect("fromNodeId" in request).toBe(false);
    expect("modelOverrides" in request).toBe(false);
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
