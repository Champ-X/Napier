import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { WorkflowObjectSchema } from "@napier/contracts";
import {
  exportThreadReplayBundle,
  LocalStore,
  UnsupportedSandboxAdapter,
  verifyThreadReplayBundle,
} from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import {
  createNapierClient,
  loadNapierWorkflow,
  type DefineNapierWorkflowInput,
} from "../src/index.js";

const temporaryRoots: string[] = [];

type ExperimentRequest = {
  text: string;
};

type ExperimentResult = {
  message: string;
};

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Napier TypeScript SDK Workflow experiments", () => {
  it("binds preview freshness and returns a verified checkpoint comparison", async () => {
    const fixture = await createFixture("execute");
    const client = await createNapierClient({
      ...fixture,
      sandbox: new UnsupportedSandboxAdapter("sdk-experiment-execute"),
    });
    const workflow = await client.defineWorkflow<
      ExperimentRequest,
      ExperimentResult
    >(experimentWorkflowDefinition());
    const source = await client.runWorkflow({
      workflow,
      input: { text: "SDK checkpoint result" },
    });
    const preview = await client.previewWorkflowExperiment({
      workflow,
      sourceThreadId: source.threadId,
      sourcePlanId: source.planId,
      fromNodeId: "deliver",
    });
    expect(preview).toEqual(
      expect.objectContaining({
        sourceThreadId: source.threadId,
        sourcePlanId: source.planId,
        reusedNodeIds: ["prepare"],
        rerunNodeIds: ["deliver"],
        requiresSideEffectConfirmation: false,
      }),
    );
    const staleEvents: string[] = [];
    await expect(
      client.runWorkflowExperiment({
        workflow,
        sourceThreadId: source.threadId,
        sourcePlanId: source.planId,
        fromNodeId: "deliver",
        expectedPreviewSha256: "invalid",
      }),
    ).rejects.toThrow("requires a valid expected preview hash");
    await expect(
      client.runWorkflowExperiment({
        workflow,
        sourceThreadId: source.threadId,
        sourcePlanId: source.planId,
        fromNodeId: "deliver",
        expectedPreviewSha256: "0".repeat(64),
        onEvent: (event) => {
          staleEvents.push(event.type);
        },
      }),
    ).rejects.toThrow("preview changed");
    expect(staleEvents).toEqual([]);

    const experiment = await client.runWorkflowExperiment({
      workflow,
      sourceThreadId: source.threadId,
      sourcePlanId: source.planId,
      fromNodeId: "deliver",
      expectedPreviewSha256: preview.previewSha256,
    });
    expect(experiment).toEqual(
      expect.objectContaining({
        targetThreadId: expect.stringMatching(/^thread_/u),
        result: expect.objectContaining({
          status: "completed",
          output: { message: "SDK checkpoint result" },
        }),
        comparison: expect.objectContaining({
          reusedNodeCount: 1,
          rerunNodeCount: 1,
          inputChange: "unchanged",
          outputChange: "unchanged",
          changedNodeIds: [],
        }),
      }),
    );
    expect(experiment.targetThreadId).not.toBe(source.threadId);
    await client.close();

    const store = await openStore(fixture);
    expect(
      verifyThreadReplayBundle(
        await exportThreadReplayBundle(store, experiment.targetThreadId),
      ).status,
    ).toBe("valid");
    expect(
      (await store.listEvents(experiment.targetThreadId)).filter(
        (event) => event.type === "workflow.node.reused",
      ),
    ).toHaveLength(1);
    store.close();
  });

  it("runs single-node and step-controlled checkpoint holds", async () => {
    const fixture = await createFixture("single-node");
    const client = await createNapierClient({
      ...fixture,
      sandbox: new UnsupportedSandboxAdapter("sdk-experiment-single-node"),
    });
    const workflow = await client.defineWorkflow<
      ExperimentRequest,
      ExperimentResult
    >(experimentWorkflowDefinition());
    const source = await client.runWorkflow({
      workflow,
      input: { text: "SDK single node result" },
    });
    const preview = await client.previewWorkflowExperiment({
      workflow,
      sourceThreadId: source.threadId,
      sourcePlanId: source.planId,
      fromNodeId: "prepare",
      mode: "single_node",
    });
    expect(preview).toEqual(
      expect.objectContaining({
        schemaVersion: 2,
        mode: "single_node",
        executionNodeIds: ["prepare"],
        stopBeforeNodeIds: ["deliver"],
      }),
    );
    const experiment = await client.runWorkflowExperiment({
      workflow,
      sourceThreadId: source.threadId,
      sourcePlanId: source.planId,
      fromNodeId: "prepare",
      mode: "single_node",
      expectedPreviewSha256: preview.previewSha256,
    });
    expect(experiment.result).toEqual(
      expect.objectContaining({
        status: "paused",
        breakpoint: expect.objectContaining({ nodeId: "deliver" }),
        nodeResults: [
          expect.objectContaining({
            nodeId: "prepare",
            status: "completed",
          }),
        ],
      }),
    );

    const candidate = loadNapierWorkflow<ExperimentRequest, ExperimentResult>(
      experiment.candidateManifest,
    );
    const stillPaused = await client.resumeWorkflow({
      workflow: candidate,
      threadId: experiment.targetThreadId,
      planId: experiment.result.planId,
    });
    expect(stillPaused.status).toBe("paused");
    const continued = await client.resumeWorkflow({
      workflow: candidate,
      threadId: experiment.targetThreadId,
      planId: experiment.result.planId,
      continueBreakpoint: true,
    });
    expect(continued).toEqual(
      expect.objectContaining({
        status: "completed",
        output: { message: "SDK single node result" },
      }),
    );

    const stepPreview = await client.previewWorkflowExperiment({
      workflow,
      sourceThreadId: source.threadId,
      sourcePlanId: source.planId,
      fromNodeId: "prepare",
      mode: "step_nodes",
    });
    expect(stepPreview).toEqual(
      expect.objectContaining({
        schemaVersion: 5,
        mode: "step_nodes",
        executionNodeIds: ["prepare"],
        stopBeforeNodeIds: ["deliver"],
      }),
    );
    const stepped = await client.runWorkflowExperiment({
      workflow,
      sourceThreadId: source.threadId,
      sourcePlanId: source.planId,
      fromNodeId: "prepare",
      mode: "step_nodes",
      expectedPreviewSha256: stepPreview.previewSha256,
    });
    expect(stepped.result).toEqual(
      expect.objectContaining({
        status: "paused",
        breakpoint: expect.objectContaining({ nodeId: "deliver" }),
      }),
    );
    const stepCandidate = loadNapierWorkflow<
      ExperimentRequest,
      ExperimentResult
    >(stepped.candidateManifest);
    await expect(
      client.resumeWorkflow({
        workflow: stepCandidate,
        threadId: stepped.targetThreadId,
        planId: stepped.result.planId,
        continueBreakpoint: true,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "completed",
        output: { message: "SDK single node result" },
      }),
    );
    await client.close();
  });

  it("simulates one typed checkpoint and executes its descendant", async () => {
    const fixture = await createFixture("simulate-node");
    const client = await createNapierClient({
      ...fixture,
      sandbox: new UnsupportedSandboxAdapter("sdk-experiment-simulate-node"),
    });
    const workflow = await client.defineWorkflow<
      ExperimentRequest,
      ExperimentResult
    >(experimentWorkflowDefinition());
    const source = await client.runWorkflow({
      workflow,
      input: { text: "Source SDK value" },
    });
    const simulatedOutput = { normalized: "Simulated SDK value" };
    const preview = await client.previewWorkflowExperiment({
      workflow,
      sourceThreadId: source.threadId,
      sourcePlanId: source.planId,
      fromNodeId: "prepare",
      mode: "simulate_node",
      simulatedOutput,
    });
    expect(preview).toEqual(
      expect.objectContaining({
        schemaVersion: 3,
        mode: "simulate_node",
        executionNodeIds: ["deliver"],
        simulatedNodeId: "prepare",
      }),
    );
    const experiment = await client.runWorkflowExperiment({
      workflow,
      sourceThreadId: source.threadId,
      sourcePlanId: source.planId,
      fromNodeId: "prepare",
      mode: "simulate_node",
      simulatedOutput,
      expectedPreviewSha256: preview.previewSha256,
    });
    expect(experiment.result).toEqual(
      expect.objectContaining({
        status: "completed",
        output: { message: "Simulated SDK value" },
      }),
    );
    expect(experiment.comparison?.nodes[0]).toEqual(
      expect.objectContaining({
        nodeId: "prepare",
        execution: "simulated",
      }),
    );
    await client.close();

    const store = await openStore(fixture);
    expect(
      store.listRuns(experiment.targetThreadId).map((run) => run.source),
    ).toEqual(["workflow_simulation", "workflow"]);
    expect(
      (await store.listEvents(experiment.targetThreadId)).filter(
        (event) => event.type === "workflow.node.simulated",
      ),
    ).toHaveLength(1);
    store.close();
  });

  it("replaces one typed checkpoint input and executes it normally", async () => {
    const fixture = await createFixture("replace-input");
    const client = await createNapierClient({
      ...fixture,
      sandbox: new UnsupportedSandboxAdapter("sdk-experiment-replace-input"),
    });
    const workflow = await client.defineWorkflow<
      ExperimentRequest,
      ExperimentResult
    >(experimentWorkflowDefinition());
    const source = await client.runWorkflow({
      workflow,
      input: { text: "Source SDK input" },
    });
    const replacementInput = {
      prepared: { normalized: "Replacement SDK input" },
    };
    const preview = await client.previewWorkflowExperiment({
      workflow,
      sourceThreadId: source.threadId,
      sourcePlanId: source.planId,
      fromNodeId: "deliver",
      mode: "replace_input",
      replacementInput,
    });
    expect(preview).toEqual(
      expect.objectContaining({
        schemaVersion: 4,
        mode: "replace_input",
        executionNodeIds: ["deliver"],
        replacedInputNodeId: "deliver",
      }),
    );
    const experiment = await client.runWorkflowExperiment({
      workflow,
      sourceThreadId: source.threadId,
      sourcePlanId: source.planId,
      fromNodeId: "deliver",
      mode: "replace_input",
      replacementInput,
      expectedPreviewSha256: preview.previewSha256,
    });
    expect(experiment.result.output).toEqual({
      message: "Replacement SDK input",
    });
    expect(experiment.comparison?.nodes[1]).toEqual(
      expect.objectContaining({
        nodeId: "deliver",
        execution: "input_replaced",
        inputChange: "changed",
      }),
    );
    await client.close();
  });

  it("recovers a cancelled target through normal Workflow resume", async () => {
    const fixture = await createFixture("recover");
    const client = await createNapierClient({
      ...fixture,
      sandbox: new UnsupportedSandboxAdapter("sdk-experiment-recover"),
    });
    const workflow = await client.defineWorkflow<
      ExperimentRequest,
      ExperimentResult
    >(experimentWorkflowDefinition());
    const source = await client.runWorkflow({
      workflow,
      input: { text: "Recover the SDK checkpoint" },
    });
    const preview = await client.previewWorkflowExperiment({
      workflow,
      sourceThreadId: source.threadId,
      sourcePlanId: source.planId,
      fromNodeId: "deliver",
    });
    const controller = new AbortController();
    const cancelled = await client.runWorkflowExperiment({
      workflow,
      sourceThreadId: source.threadId,
      sourcePlanId: source.planId,
      fromNodeId: "deliver",
      expectedPreviewSha256: preview.previewSha256,
      signal: controller.signal,
      onEvent: (event) => {
        if (
          event.type === "workflow.node.started" &&
          record(event.payload)?.["nodeId"] === "deliver"
        ) {
          controller.abort();
        }
      },
    });
    expect(cancelled.result.status).toBe("cancelled");

    const candidate = loadNapierWorkflow<ExperimentRequest, ExperimentResult>(
      cancelled.candidateManifest,
    );
    const recovered = await client.resumeWorkflow({
      workflow: candidate,
      threadId: cancelled.targetThreadId,
      planId: cancelled.result.planId,
      retryBlocked: true,
    });
    expect(recovered).toEqual(
      expect.objectContaining({
        status: "completed",
        output: { message: "Recover the SDK checkpoint" },
      }),
    );
    await client.close();

    const store = await openStore(fixture);
    const events = await store.listEvents(cancelled.targetThreadId);
    expect(
      events.filter((event) => event.type === "workflow.cancelled"),
    ).toHaveLength(1);
    expect(
      events.filter((event) => event.type === "workflow.node.reused"),
    ).toHaveLength(1);
    expect(
      verifyThreadReplayBundle(
        await exportThreadReplayBundle(store, cancelled.targetThreadId),
      ).status,
    ).toBe("valid");
    store.close();
  });
});

function experimentWorkflowDefinition(): DefineNapierWorkflowInput<
  ExperimentRequest,
  ExperimentResult
> {
  const requestSchema = objectSchema({
    text: { type: "string", minLength: 1, maxLength: 200 },
  });
  const preparedSchema = objectSchema({
    normalized: { type: "string", minLength: 1, maxLength: 200 },
  });
  const resultSchema = objectSchema({
    message: { type: "string", minLength: 1, maxLength: 200 },
  });
  return {
    name: "SDK checkpoint experiment",
    version: 1,
    description: "Reuse one deterministic ancestor and rerun its descendant.",
    plan: {
      objective: "Deliver one SDK checkpoint experiment.",
      steps: [
        planStep("prepare", "Prepare request"),
        {
          ...planStep("deliver", "Deliver result"),
          dependsOn: ["prepare"],
        },
      ],
    },
    inputSchema: requestSchema,
    outputSchema: resultSchema,
    outputNodeId: "deliver",
    nodes: [
      {
        id: "prepare",
        type: "deterministic",
        inputBindings: {
          workflow: { source: "workflow" },
        },
        inputSchema: objectSchema({ workflow: requestSchema }),
        outputSchema: preparedSchema,
        template: {
          kind: "object",
          properties: {
            normalized: { kind: "input", path: ["workflow", "text"] },
          },
        },
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
      {
        id: "deliver",
        type: "deterministic",
        inputBindings: {
          prepared: { source: "node", nodeId: "prepare" },
        },
        inputSchema: objectSchema({ prepared: preparedSchema }),
        outputSchema: resultSchema,
        template: {
          kind: "object",
          properties: {
            message: { kind: "input", path: ["prepared", "normalized"] },
          },
        },
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
    ],
  };
}

function planStep(id: string, title: string) {
  return {
    id,
    title,
    description: `${title} for the checkpoint experiment.`,
    verification: `${title} returns its typed output.`,
  };
}

function objectSchema(
  properties: WorkflowObjectSchema["properties"],
): WorkflowObjectSchema {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

async function createFixture(label: string) {
  const root = await mkdtemp(
    path.join(tmpdir(), `napier-sdk-experiment-${label}-`),
  );
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot);
  return { workspaceRoot, dataRoot };
}

async function openStore(fixture: {
  workspaceRoot: string;
  dataRoot: string;
}): Promise<LocalStore> {
  const store = new LocalStore(fixture);
  await store.initialize();
  return store;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
