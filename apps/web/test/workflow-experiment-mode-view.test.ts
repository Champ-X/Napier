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
