import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  EXECUTION_PLAN_WORKFLOW_APPROVAL_OUTPUT_SCHEMA,
  type WorkflowObjectSchema,
} from "@napier/contracts";
import { AgentRuntime } from "../../src/agent-runtime.js";
import { EmbeddedWorkflowService } from "../../src/embedded-workflows.js";
import { ModelRegistry } from "../../src/models.js";
import { LocalStore } from "../../src/store.js";
import { ExecutionPlanWorkflowRuntime } from "../../src/workflow-runtime.js";

export async function openWorkflowFixture(root: string) {
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  await store.initialize(true);
  const workflows = new ExecutionPlanWorkflowRuntime(
    store,
    new AgentRuntime(store, new ModelRegistry()),
  );
  return {
    store,
    workflows,
    embedded: new EmbeddedWorkflowService(store, workflows),
  };
}
export async function createApprovalFixture(
  root: string,
  reject = false,
  timeoutMs = 60000,
) {
  const fixture = await openWorkflowFixture(root);
  await fixture.store.updateAgent(fixture.store.listAgents()[0]!.id, {
    toolPolicy: "workspace",
    enabledTools: ["apply_patch"],
    enabledSubagents: [],
  });
  const object = (
    properties: WorkflowObjectSchema["properties"],
  ): WorkflowObjectSchema => ({
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  });
  const empty = object({});
  const receipt = object({
    kind: { type: "string", enum: ["napier.workspace-patch"] },
    schemaVersion: { type: "integer", minimum: 1, maximum: 1 },
    pathSha256: { type: "string", minLength: 64, maxLength: 64 },
    operation: { type: "string", enum: ["create"] },
    beforeSha256: { type: "null" },
    afterSha256: { type: "string", minLength: 64, maxLength: 64 },
    beforeBytes: { type: "integer", minimum: 0 },
    afterBytes: { type: "integer", minimum: 0 },
    editCount: { type: "integer", minimum: 0 },
    resultSha256: { type: "string", minLength: 64, maxLength: 64 },
  });
  const { manifest } = await fixture.embedded.define({
    name: "Approval recovery",
    version: 1,
    description: "Approve then commit one file.",
    plan: {
      objective: "Commit the approved file once.",
      steps: [
        {
          id: "approve",
          title: "Approve",
          description: "Save the choice.",
          verification: "Approval receipt is bound.",
        },
        {
          id: "write",
          title: "Write",
          description: "Create approved.txt.",
          dependsOn: ["approve"],
          verification: "File is present.",
        },
      ],
    },
    inputSchema: empty,
    outputSchema: receipt,
    outputNodeId: "write",
    nodes: [
      {
        id: "approve",
        type: "approval",
        header: "Commit",
        question: "Create the agreed file?",
        approve: { label: "Approve", description: "Create it once." },
        reject: { label: "Reject", description: "Do not write." },
        inputBindings: {},
        inputSchema: empty,
        outputSchema: structuredClone(
          EXECUTION_PLAN_WORKFLOW_APPROVAL_OUTPUT_SCHEMA,
        ),
        timeoutMs,
        maxAttempts: 1,
      },
      {
        id: "write",
        type: "tool",
        tool: "apply_patch",
        effect: "write",
        inputBindings: {
          operation: { source: "literal", value: "create" },
          path: { source: "literal", value: "approved.txt" },
          expectedSha256: { source: "literal", value: null },
          content: { source: "node", nodeId: "approve", path: ["customText"] },
        },
        inputSchema: object({
          operation: { type: "string", enum: ["create"] },
          path: { type: "string", minLength: 1, maxLength: 100 },
          expectedSha256: { type: "null" },
          content: { type: "string", minLength: 1, maxLength: 200 },
        }),
        outputSchema: receipt,
        timeoutMs: 5000,
        maxAttempts: 1,
      },
    ],
  });
  const waiting = await fixture.embedded.run({ manifest, input: {} });
  const decision = waiting.pendingDecision!;
  return {
    ...fixture,
    request: {
      manifest,
      threadId: waiting.threadId,
      planId: waiting.result.planId,
      decisionId: decision.id,
      expectedDecisionSha256: decision.contentSha256,
      answer: {
        selectedOptionIds: [reject ? "option_2" : "option_1"],
        customText: "Approved content, used exactly once.",
      },
    },
  };
}
