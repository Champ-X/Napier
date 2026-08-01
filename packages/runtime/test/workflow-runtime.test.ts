import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { EXECUTION_PLAN_WORKFLOW_APPROVAL_OUTPUT_SCHEMA } from "@napier/contracts";
import type {
  ExecutionPlanBlueprint,
  ExecutionPlanWorkflowDeterministicTemplate,
  ExecutionPlanWorkflowManifest,
  JsonValue,
  RunEvent,
  WorkflowObjectSchema,
} from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { AgentRuntime } from "../src/agent-runtime.js";
import { exportThreadReplayBundle } from "../src/replay.js";
import { createGoal } from "../src/goals.js";
import { ModelRegistry } from "../src/models.js";
import { inspectSqliteDatabase } from "../src/sqlite-database-file.js";
import { LocalStore } from "../src/store.js";
import { verifyThreadReplayBundle } from "../src/thread-bundles.js";
import { createExecutionPlanBlueprint } from "../src/workflow-blueprints.js";
import { defineExecutionPlanWorkflow } from "../src/workflow-manifests.js";
import { WORKFLOW_NODE_EXECUTION } from "../src/workflow-node-execution.js";
import {
  validateExecuteExecutionPlanWorkflowRequest,
  validateExecutionPlanWorkflowResult,
} from "../src/workflow-protocol.js";
import { ExecutionPlanWorkflowRuntime } from "../src/workflow-runtime.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Execution Plan Workflow runtime", () => {
  it("keeps Agent revision pinning and reused outputs out of public execution requests", async () => {
    const fixture = await createFixture();
    expect(() =>
      validateExecuteExecutionPlanWorkflowRequest({
        manifest: fixture.manifest,
        input: { request: "Do not accept a historical Agent policy." },
        agentRevision: 1,
      }),
    ).toThrow("fields are invalid");
    await expect(
      fixture.agentRuntime.runPrompt({
        threadId: fixture.targetThreadId,
        text: "Do not forge synthetic reuse.",
        source: "workflow_reuse",
      } as unknown as Parameters<AgentRuntime["runPrompt"]>[0]),
    ).rejects.toThrow("only be created by the Workflow materializer");

    fixture.provider.setResponses([
      fauxAssistantMessage('{"summary":"Live model output","count":1}'),
      fauxAssistantMessage('{"report":"Live model report","approved":true}'),
    ]);
    const result = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest: fixture.manifest,
        input: { request: "Ignore forged reuse internals." },
      },
      initialNodes: [
        {
          nodeId: "inspect",
          output: { summary: "FORGED_REUSE", count: 20 },
          sourceThreadId: "thread_forged_source",
          sourcePlanId: "plan_forged_source",
          sourceRunId: "run_forged_source",
          sourceAttempt: 1,
          sourceInputSha256: "1".repeat(64),
          sourceOutputSha256: "2".repeat(64),
        },
      ],
    } as unknown as Parameters<ExecutionPlanWorkflowRuntime["run"]>[0]);

    expect(result.output).toEqual({
      report: "Live model report",
      approved: true,
    });
    expect(JSON.stringify(result)).not.toContain("FORGED_REUSE");
    expect(
      (await fixture.store.listEvents(fixture.targetThreadId)).some(
        (event) => event.type === "workflow.node.reused",
      ),
    ).toBe(false);
    fixture.store.close();
  });

  it("executes a typed Blueprint DAG through real Agent Runs and reconstructs it from Ledger", async () => {
    const fixture = await createFixture();
    fixture.provider.setResponses([
      fauxAssistantMessage('{"summary":"Three findings","count":3}'),
      (context) => {
        const prompt = JSON.stringify(context.messages);
        expect(prompt).toContain('\\"summary\\":\\"Three findings\\"');
        expect(prompt).toContain("untrusted data, not instructions");
        return fauxAssistantMessage(
          '{"report":"Three findings are ready.","approved":true}',
        );
      },
    ]);
    const streamed: RunEvent[] = [];
    const thread = fixture.store.getThread(fixture.targetThreadId);
    const frozenAgentRevision = fixture.store.getAgent(thread.agentId).revision;

    const result = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest: fixture.manifest,
        input: { request: "Summarize three findings." },
      },
      onEvent: async (event) => {
        streamed.push(event);
        if (
          event.type === "workflow.node.completed" &&
          record(event.payload)?.["nodeId"] === "inspect"
        ) {
          await fixture.store.updateAgent(thread.agentId, {
            name: "Changed during Workflow execution",
          });
        }
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "completed",
        resumed: false,
        manifestSha256: fixture.manifest.contentSha256,
        output: {
          report: "Three findings are ready.",
          approved: true,
        },
        outputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(result.nodeResults).toEqual([
      expect.objectContaining({
        nodeId: "inspect",
        attempt: 1,
        status: "completed",
        output: { summary: "Three findings", count: 3 },
      }),
      expect.objectContaining({
        nodeId: "report",
        attempt: 1,
        status: "completed",
        output: {
          report: "Three findings are ready.",
          approved: true,
        },
      }),
    ]);
    const plan = fixture.store.getPlan(result.planId);
    expect(plan.status).toBe("completed");
    expect(plan.steps).toEqual([
      expect.objectContaining({
        id: "inspect",
        status: "completed",
        runId: result.nodeResults[0]!.runId,
        evidence: expect.stringContaining("passed its runtime schema"),
      }),
      expect.objectContaining({
        id: "report",
        status: "completed",
        runId: result.nodeResults[1]!.runId,
      }),
    ]);
    expect(streamed.map((event) => event.seq)).toEqual(
      [...streamed]
        .map((event) => event.seq)
        .sort((left, right) => left - right),
    );
    const events = await fixture.store.listEvents(fixture.targetThreadId);
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "workflow.started",
        "workflow.node.started",
        "workflow.node.completed",
        "workflow.completed",
        "plan.step.started",
        "plan.step.completed",
      ]),
    );
    const workflowEvidence = JSON.stringify(
      events.filter((event) => event.type.startsWith("workflow.")),
    );
    expect(workflowEvidence).not.toContain("Three findings are ready");
    expect(
      verifyThreadReplayBundle(
        await exportThreadReplayBundle(fixture.store, fixture.targetThreadId),
      ).status,
    ).toBe("valid");

    const runCount = fixture.store.listRuns(fixture.targetThreadId).length;
    const recovered = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest: fixture.manifest,
        planId: result.planId,
      },
    });
    expect(recovered).toEqual(
      expect.objectContaining({
        status: "completed",
        resumed: true,
        output: result.output,
      }),
    );
    expect(fixture.store.listRuns(fixture.targetThreadId)).toHaveLength(
      runCount,
    );
    expect(
      fixture.store
        .listRuns(fixture.targetThreadId)
        .map((run) => run.agentRevision),
    ).toEqual([frozenAgentRevision, frozenAgentRevision]);
    expect(fixture.store.getAgent(thread.agentId).revision).toBe(
      frozenAgentRevision + 1,
    );
    expect(
      (await fixture.store.listEvents(fixture.targetThreadId)).filter(
        (event) => event.type === "workflow.completed",
      ),
    ).toHaveLength(1);
    fixture.store.close();
  }, 20_000);

  it("executes one recursive Deterministic node before an Agent without a model proxy", async () => {
    const fixture = await createFixture();
    const manifest = deterministicWorkflowManifest(fixture.manifest.blueprint);
    fixture.provider.setResponses([
      (context) => {
        const prompt = JSON.stringify(context.messages);
        expect(prompt).toContain('\\"summary\\":\\"Shape this input.\\"');
        expect(prompt).toContain('\\"count\\":1');
        return fauxAssistantMessage(
          '{"report":"Deterministic input verified","approved":true}',
        );
      },
    ]);

    const result = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest,
        input: { request: "Shape this input." },
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "completed",
        output: {
          report: "Deterministic input verified",
          approved: true,
        },
      }),
    );
    expect(result.nodeResults[0]).toEqual(
      expect.objectContaining({
        nodeId: "inspect",
        status: "completed",
        output: { summary: "Shape this input.", count: 1 },
      }),
    );
    const events = await fixture.store.listEvents(fixture.targetThreadId);
    expect(
      events.filter(
        (event) => event.type === "workflow.deterministic.completed",
      ),
    ).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          outputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          outputBytes: expect.any(Number),
        }),
      }),
    ]);
    expect(
      JSON.stringify(
        events.find(
          (event) => event.type === "workflow.deterministic.completed",
        )?.payload,
      ),
    ).not.toContain("Shape this input.");
    expect(
      events.filter(
        (event) =>
          event.type === "message.assistant" &&
          event.runId === result.nodeResults[0]?.runId &&
          event.visibility === "hidden",
      ),
    ).toHaveLength(1);
    expect(
      events.filter(
        (event) =>
          event.type === "model.response" &&
          event.runId === result.nodeResults[0]?.runId,
      ),
    ).toHaveLength(0);
    expect(
      verifyThreadReplayBundle(
        await exportThreadReplayBundle(fixture.store, fixture.targetThreadId),
      ).status,
    ).toBe("valid");

    const resumed = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: { manifest, planId: result.planId },
    });
    expect(resumed.output).toEqual(result.output);
    expect(fixture.store.listRuns(fixture.targetThreadId)).toHaveLength(2);
    fixture.store.close();
  });

  it("selects and recovers one typed Deterministic Switch case", async () => {
    const fixture = await createFixture();
    const manifest = switchWorkflowManifest(fixture.manifest.blueprint);
    const agentId = fixture.store.getThread(fixture.targetThreadId).agentId;
    const concurrentThread = await fixture.store.createThread({
      title: "Concurrent Switch",
      agentId,
    });
    const [result, concurrent] = await Promise.all([
      fixture.workflows.run({
        threadId: fixture.targetThreadId,
        request: {
          manifest,
          input: {
            request: "PRIVATE_SWITCH_REQUEST",
            route: "priority",
          },
        },
      }),
      fixture.workflows.run({
        threadId: concurrentThread.id,
        request: {
          manifest,
          input: {
            request: "Concurrent audit request",
            route: "audit",
          },
        },
      }),
    ]);

    expect(result).toEqual(
      expect.objectContaining({
        status: "completed",
        output: {
          report: "PRIVATE_SWITCH_REQUEST",
          approved: true,
        },
      }),
    );
    expect(concurrent.output).toEqual({
      report: "Audit route",
      approved: true,
    });
    expect(result.nodeResults).toEqual([
      expect.objectContaining({
        nodeId: "inspect",
        status: "completed",
        output: { summary: "PRIVATE_SWITCH_REQUEST", count: 1 },
      }),
      expect.objectContaining({
        nodeId: "report",
        status: "completed",
        output: {
          report: "PRIVATE_SWITCH_REQUEST",
          approved: true,
        },
      }),
    ]);
    const events = await fixture.store.listEvents(fixture.targetThreadId);
    const switchEvent = events.find(
      (event) =>
        event.type === "workflow.deterministic.completed" &&
        record(event.payload)?.["nodeId"] === "inspect",
    );
    expect(switchEvent?.payload).toEqual(
      expect.objectContaining({
        switchCaseId: "fast_path",
        switchSelectorSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        switchDefault: false,
      }),
    );
    expect(JSON.stringify(switchEvent?.payload)).not.toContain("priority");
    expect(JSON.stringify(switchEvent?.payload)).not.toContain(
      "PRIVATE_SWITCH_REQUEST",
    );
    expect(
      events.some(
        (event) =>
          event.type === "model.response" || event.type === "tool.started",
      ),
    ).toBe(false);
    const runCount = fixture.store.listRuns(fixture.targetThreadId).length;
    const resumed = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: { manifest, planId: result.planId },
    });
    expect(resumed.output).toEqual(result.output);
    expect(fixture.store.listRuns(fixture.targetThreadId)).toHaveLength(
      runCount,
    );

    await fixture.store.appendEvent({
      threadId: fixture.targetThreadId,
      runId: switchEvent!.runId,
      type: "workflow.deterministic.completed",
      category: "plan",
      visibility: "user",
      payload: {
        ...(switchEvent!.payload as Record<string, JsonValue>),
        switchCaseId: "audit_path",
      },
    });
    await expect(
      fixture.workflows.run({
        threadId: fixture.targetThreadId,
        request: { manifest, planId: result.planId },
      }),
    ).rejects.toThrow("output evidence is unavailable");
    fixture.store.close();
  });

  it("uses a Switch default and blocks an unmatched Switch without one", async () => {
    const defaultFixture = await createFixture();
    const defaultManifest = switchWorkflowManifest(
      defaultFixture.manifest.blueprint,
    );
    const selectedDefault = await defaultFixture.workflows.run({
      threadId: defaultFixture.targetThreadId,
      request: {
        manifest: defaultManifest,
        input: { request: "Default request", route: "other" },
      },
    });
    expect(selectedDefault.nodeResults[0]).toEqual(
      expect.objectContaining({
        status: "completed",
        output: { summary: "Default route", count: 0 },
      }),
    );
    expect(
      (
        await defaultFixture.store.listEvents(defaultFixture.targetThreadId)
      ).find(
        (event) =>
          event.type === "workflow.deterministic.completed" &&
          record(event.payload)?.["nodeId"] === "inspect",
      )?.payload,
    ).toEqual(
      expect.objectContaining({
        switchCaseId: "default",
        switchDefault: true,
      }),
    );
    defaultFixture.store.close();

    const unmatchedFixture = await createFixture();
    const unmatchedManifest = switchWorkflowManifest(
      unmatchedFixture.manifest.blueprint,
      { includeDefault: false },
    );
    const unmatched = await unmatchedFixture.workflows.run({
      threadId: unmatchedFixture.targetThreadId,
      request: {
        manifest: unmatchedManifest,
        input: { request: "Unmatched request", route: "other" },
      },
    });
    expect(unmatched).toEqual(
      expect.objectContaining({
        status: "blocked",
        nodeResults: [
          expect.objectContaining({
            nodeId: "inspect",
            errorCode: "switch_unmatched",
          }),
        ],
      }),
    );
    expect(
      (
        await unmatchedFixture.store.listEvents(unmatchedFixture.targetThreadId)
      ).some(
        (event) =>
          event.type === "workflow.deterministic.completed" &&
          record(event.payload)?.["nodeId"] === "inspect",
      ),
    ).toBe(false);
    unmatchedFixture.store.close();
  });

  it("cancels a Switch before it can commit a selection", async () => {
    const fixture = await createFixture();
    const manifest = switchWorkflowManifest(fixture.manifest.blueprint);
    const controller = new AbortController();
    const cancelled = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest,
        input: { request: "Cancelled Switch", route: "priority" },
      },
      signal: controller.signal,
      onEvent: (event) => {
        if (
          event.type === "workflow.node.started" &&
          record(event.payload)?.["nodeId"] === "inspect"
        ) {
          controller.abort();
        }
      },
    });

    expect(cancelled).toEqual(
      expect.objectContaining({
        status: "cancelled",
        nodeResults: [
          expect.objectContaining({
            nodeId: "inspect",
            errorCode: "cancelled",
          }),
        ],
      }),
    );
    expect(
      (await fixture.store.listEvents(fixture.targetThreadId)).some(
        (event) =>
          event.type === "workflow.deterministic.completed" &&
          record(event.payload)?.["nodeId"] === "inspect",
      ),
    ).toBe(false);
    fixture.store.close();
  });

  it("rejects duplicate and schema-invalid Switch cases before execution", async () => {
    const duplicateFixture = await createFixture();
    expect(() =>
      switchWorkflowManifest(duplicateFixture.manifest.blueprint, {
        auditEquals: "priority",
      }),
    ).toThrow("case values must be unique");
    duplicateFixture.store.close();

    const invalidFixture = await createFixture();
    expect(() =>
      switchWorkflowManifest(invalidFixture.manifest.blueprint, {
        auditEquals: 42,
      }),
    ).toThrow("does not match");
    invalidFixture.store.close();
  });

  it("blocks unresolved paths and schema-invalid Deterministic output", async () => {
    const missingFixture = await createFixture();
    const missingManifest = deterministicWorkflowManifest(
      missingFixture.manifest.blueprint,
      {
        kind: "object",
        properties: {
          summary: {
            kind: "input",
            path: ["workflow", "missing"],
          },
          count: { kind: "literal", value: 1 },
        },
      },
    );
    const missing = await missingFixture.workflows.run({
      threadId: missingFixture.targetThreadId,
      request: {
        manifest: missingManifest,
        input: { request: "Missing path." },
      },
    });
    expect(missing.nodeResults).toEqual([
      expect.objectContaining({
        nodeId: "inspect",
        errorCode: "template_failed",
      }),
    ]);
    missingFixture.store.close();

    const invalidFixture = await createFixture();
    const invalidManifest = deterministicWorkflowManifest(
      invalidFixture.manifest.blueprint,
      {
        kind: "object",
        properties: {
          summary: {
            kind: "input",
            path: ["workflow", "request"],
          },
          count: { kind: "literal", value: "not-an-integer" },
        },
      },
    );
    const invalid = await invalidFixture.workflows.run({
      threadId: invalidFixture.targetThreadId,
      request: {
        manifest: invalidManifest,
        input: { request: "Reject invalid output." },
      },
    });
    expect(invalid.nodeResults).toEqual([
      expect.objectContaining({
        nodeId: "inspect",
        errorCode: "output_invalid",
      }),
    ]);
    invalidFixture.store.close();
  });

  it("blocks Deterministic output amplification beyond the node byte limit", async () => {
    const fixture = await createFixture();
    const definition = workflowDefinition(fixture.manifest.blueprint);
    const largeRequestSchema: WorkflowObjectSchema = {
      type: "object",
      properties: {
        request: { type: "string", minLength: 1, maxLength: 16_384 },
      },
      required: ["request"],
      additionalProperties: false,
    };
    const largeOutputSchema: WorkflowObjectSchema = {
      type: "object",
      properties: {
        first: { type: "string", minLength: 1, maxLength: 16_384 },
        second: { type: "string", minLength: 1, maxLength: 16_384 },
        third: { type: "string", minLength: 1, maxLength: 16_384 },
      },
      required: ["first", "second", "third"],
      additionalProperties: false,
    };
    const manifest = defineExecutionPlanWorkflow({
      ...definition,
      inputSchema: largeRequestSchema,
      outputSchema: largeOutputSchema,
      nodes: [
        {
          id: "inspect",
          type: "deterministic",
          inputBindings: {
            workflow: { source: "workflow" },
          },
          inputSchema: {
            type: "object",
            properties: { workflow: largeRequestSchema },
            required: ["workflow"],
            additionalProperties: false,
          },
          outputSchema: inspectionSchema(),
          template: {
            kind: "object",
            properties: {
              summary: { kind: "literal", value: "Input accepted." },
              count: { kind: "literal", value: 1 },
            },
          },
          timeoutMs: 5_000,
          maxAttempts: 2,
        },
        {
          id: "report",
          type: "deterministic",
          inputBindings: {
            workflow: { source: "workflow" },
          },
          inputSchema: {
            type: "object",
            properties: { workflow: largeRequestSchema },
            required: ["workflow"],
            additionalProperties: false,
          },
          outputSchema: largeOutputSchema,
          template: {
            kind: "object",
            properties: {
              first: {
                kind: "input",
                path: ["workflow", "request"],
              },
              second: {
                kind: "input",
                path: ["workflow", "request"],
              },
              third: {
                kind: "input",
                path: ["workflow", "request"],
              },
            },
          },
          timeoutMs: 5_000,
          maxAttempts: 2,
        },
      ],
    });
    const result = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest,
        input: { request: "x".repeat(12_000) },
      },
    });

    expect(result.nodeResults).toEqual([
      expect.objectContaining({
        nodeId: "inspect",
        status: "completed",
      }),
      expect.objectContaining({
        nodeId: "report",
        status: "blocked",
        errorCode: "output_invalid",
      }),
    ]);
    expect(
      (await fixture.store.listEvents(fixture.targetThreadId)).some(
        (event) =>
          event.type === "workflow.deterministic.completed" &&
          record(event.payload)?.["nodeId"] === "report",
      ),
    ).toBe(false);
    fixture.store.close();
  });

  it("recovers a terminal Deterministic output after Plan completion fails", async () => {
    const fixture = await createFixture();
    const manifest = deterministicWorkflowManifest(fixture.manifest.blueprint);
    fixture.provider.setResponses([
      fauxAssistantMessage(
        '{"report":"Deterministic commit recovered","approved":true}',
      ),
    ]);
    const transitionPlanStep = fixture.store.transitionPlanStep.bind(
      fixture.store,
    );
    let failCompletion = true;
    fixture.store.transitionPlanStep = async (planId, stepId, request) => {
      if (
        stepId === "inspect" &&
        request.action === "complete" &&
        failCompletion
      ) {
        failCompletion = false;
        throw new Error("Injected deterministic Plan completion failure");
      }
      return transitionPlanStep(planId, stepId, request);
    };
    const blocked = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest,
        input: { request: "Recover deterministic output." },
      },
    });
    expect(blocked).toEqual(
      expect.objectContaining({
        status: "blocked",
        nodeResults: [
          expect.objectContaining({
            nodeId: "inspect",
            errorCode: "deterministic_failed",
          }),
        ],
      }),
    );
    expect(fixture.store.listRuns(fixture.targetThreadId)).toHaveLength(1);

    fixture.store.transitionPlanStep = transitionPlanStep;
    const recovered = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: { manifest, planId: blocked.planId },
    });
    expect(recovered).toEqual(
      expect.objectContaining({
        status: "completed",
        output: {
          report: "Deterministic commit recovered",
          approved: true,
        },
      }),
    );
    expect(
      (await fixture.store.listEvents(fixture.targetThreadId)).filter(
        (event) => event.type === "workflow.deterministic.completed",
      ),
    ).toHaveLength(1);
    expect(fixture.store.listRuns(fixture.targetThreadId)).toHaveLength(2);
    fixture.store.close();
  });

  it("cancels preflight and times out before Deterministic commitment", async () => {
    const cancelledFixture = await createFixture();
    const cancelledManifest = deterministicWorkflowManifest(
      cancelledFixture.manifest.blueprint,
    );
    const controller = new AbortController();
    const cancelled = await cancelledFixture.workflows.run({
      threadId: cancelledFixture.targetThreadId,
      request: {
        manifest: cancelledManifest,
        input: { request: "Cancel deterministic output." },
      },
      signal: controller.signal,
      onEvent: (event) => {
        if (
          event.type === "workflow.node.started" &&
          record(event.payload)?.["nodeType"] === "deterministic"
        ) {
          controller.abort();
        }
      },
    });
    expect(cancelled).toEqual(
      expect.objectContaining({
        status: "cancelled",
        nodeResults: [
          expect.objectContaining({
            nodeId: "inspect",
            errorCode: "cancelled",
          }),
        ],
      }),
    );
    expect(
      (
        await cancelledFixture.store.listEvents(cancelledFixture.targetThreadId)
      ).some((event) => event.type === "workflow.deterministic.completed"),
    ).toBe(false);
    cancelledFixture.store.close();

    const timeoutFixture = await createFixture();
    const timeoutManifest = deterministicWorkflowManifest(
      timeoutFixture.manifest.blueprint,
      undefined,
      1_000,
    );
    const timedOut = await timeoutFixture.workflows.run({
      threadId: timeoutFixture.targetThreadId,
      request: {
        manifest: timeoutManifest,
        input: { request: "Time out deterministic preflight." },
      },
      onEvent: async (event) => {
        if (
          event.type === "message.assistant" &&
          record(event.payload)?.["model"] === "napier/workflow-deterministic"
        ) {
          await new Promise((resolve) => setTimeout(resolve, 1_100));
        }
      },
    });
    expect(timedOut.nodeResults).toEqual([
      expect.objectContaining({
        nodeId: "inspect",
        errorCode: "timeout",
      }),
    ]);
    expect(
      (
        await timeoutFixture.store.listEvents(timeoutFixture.targetThreadId)
      ).some((event) => event.type === "workflow.deterministic.completed"),
    ).toBe(false);
    expect(
      (
        await timeoutFixture.store.listEvents(timeoutFixture.targetThreadId)
      ).some(
        (event) =>
          event.type === "message.assistant" &&
          record(event.payload)?.["model"] === "napier/workflow-deterministic",
      ),
    ).toBe(true);
    timeoutFixture.store.close();
  }, 20_000);

  it("executes a policy-checked Tool node before one Agent node and resumes without rerun", async () => {
    const fixture = await createFixture();
    const definition = workflowDefinition(fixture.manifest.blueprint);
    const manifest = defineExecutionPlanWorkflow({
      ...definition,
      nodes: [
        {
          id: "inspect",
          type: "tool",
          tool: "list_files",
          effect: "read",
          inputBindings: {
            path: { source: "literal", value: "." },
            depth: { source: "literal", value: 1 },
          },
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string", minLength: 1, maxLength: 20 },
              depth: { type: "integer", minimum: 0, maximum: 4 },
            },
            required: ["path", "depth"],
            additionalProperties: false,
          },
          outputSchema: listFilesReceiptSchema(),
          timeoutMs: 5_000,
          maxAttempts: 2,
        },
        {
          ...definition.nodes[1]!,
          inputBindings: {
            inventory: { source: "node", nodeId: "inspect" },
          },
          inputSchema: {
            type: "object",
            properties: {
              inventory: listFilesReceiptSchema(),
            },
            required: ["inventory"],
            additionalProperties: false,
          },
        },
      ],
    });
    fixture.provider.setResponses([
      (context) => {
        const prompt = JSON.stringify(context.messages);
        expect(prompt).toContain('\\"count\\":1');
        return fauxAssistantMessage(
          '{"report":"Inventory verified","approved":true}',
        );
      },
    ]);

    const result = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest,
        input: { request: "Inventory the workspace." },
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "completed",
        output: { report: "Inventory verified", approved: true },
      }),
    );
    expect(result.nodeResults[0]).toEqual(
      expect.objectContaining({
        nodeId: "inspect",
        status: "completed",
        output: expect.objectContaining({
          count: 1,
          truncated: false,
          pathSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          entrySetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      }),
    );
    const runs = fixture.store.listRuns(fixture.targetThreadId);
    expect(runs).toHaveLength(2);
    expect(runs.map((run) => run.source)).toEqual(["workflow", "workflow"]);
    const events = await fixture.store.listEvents(fixture.targetThreadId);
    const toolStarted = events.find(
      (event) =>
        event.type === "tool.started" &&
        record(event.payload)?.["workflowNodeId"] === "inspect",
    );
    const toolCompleted = events.find(
      (event) =>
        event.type === "tool.completed" &&
        record(event.payload)?.["workflowNodeId"] === "inspect",
    );
    expect(toolStarted?.payload).toEqual(
      expect.objectContaining({
        toolName: "list_files",
        effect: "read",
        inputRedacted: true,
        inputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(toolCompleted?.payload).toEqual(
      expect.objectContaining({
        workflowOutputSha256: result.nodeResults[0]?.outputSha256,
        toolOutputRedacted: true,
        toolOutputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(JSON.stringify(toolCompleted)).not.toContain("evidence.txt");
    expect(events.some((event) => event.type === "model.response")).toBe(true);
    expect(
      events.filter(
        (event) =>
          event.type === "model.response" &&
          event.runId === result.nodeResults[0]?.runId,
      ),
    ).toHaveLength(0);
    expect(
      verifyThreadReplayBundle(
        await exportThreadReplayBundle(fixture.store, fixture.targetThreadId),
      ).status,
    ).toBe("valid");

    const resumed = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: { manifest, planId: result.planId },
    });
    expect(resumed.output).toEqual(result.output);
    expect(fixture.store.listRuns(fixture.targetThreadId)).toHaveLength(2);
    fixture.store.close();
  }, 20_000);

  it("executes a hash-bound SQLite query as a typed Tool node", async () => {
    const fixture = await createFixture();
    const database = new DatabaseSync(
      path.join(fixture.workspaceRoot, "workflow-data.db"),
    );
    database.exec(`
      CREATE TABLE metrics (category TEXT NOT NULL, value INTEGER NOT NULL) STRICT;
      INSERT INTO metrics VALUES ('alpha', 10), ('alpha', 20), ('beta', 30);
    `);
    database.close();
    const snapshot = await inspectSqliteDatabase(
      fixture.workspaceRoot,
      "workflow-data.db",
    );
    const definition = workflowDefinition(fixture.manifest.blueprint);
    const manifest = defineExecutionPlanWorkflow({
      ...definition,
      nodes: [
        {
          id: "inspect",
          type: "tool",
          tool: "sqlite_query",
          effect: "read",
          inputBindings: {
            action: { source: "literal", value: "query" },
            path: { source: "literal", value: "workflow-data.db" },
            databaseSha256: {
              source: "literal",
              value: snapshot.fileSha256,
            },
            sql: {
              source: "literal",
              value:
                "SELECT category, SUM(value) AS total FROM metrics GROUP BY category",
            },
          },
          inputSchema: {
            type: "object",
            properties: {
              action: { type: "string", enum: ["query"] },
              path: { type: "string", minLength: 1, maxLength: 500 },
              databaseSha256: {
                type: "string",
                minLength: 64,
                maxLength: 64,
              },
              sql: { type: "string", minLength: 1, maxLength: 1_000 },
            },
            required: ["action", "path", "databaseSha256", "sql"],
            additionalProperties: false,
          },
          outputSchema: sqliteQueryReceiptSchema(),
          timeoutMs: 5_000,
          maxAttempts: 1,
        },
        {
          ...definition.nodes[1]!,
          inputBindings: {
            analysis: { source: "node", nodeId: "inspect" },
          },
          inputSchema: {
            type: "object",
            properties: {
              analysis: sqliteQueryReceiptSchema(),
            },
            required: ["analysis"],
            additionalProperties: false,
          },
        },
      ],
    });
    fixture.provider.setResponses([
      (context) => {
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain('\\"rowCount\\":2');
        expect(messages).toContain(snapshot.fileSha256);
        expect(messages).not.toContain("alpha");
        return fauxAssistantMessage(
          '{"report":"SQLite receipt verified","approved":true}',
        );
      },
    ]);

    const result = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest,
        input: { request: "Run one SQLite aggregate." },
      },
    });

    expect(result.status).toBe("completed");
    expect(result.nodeResults[0]?.output).toEqual(
      expect.objectContaining({
        kind: "napier.sqlite-query",
        action: "query",
        databaseSha256: snapshot.fileSha256,
        rowCount: 2,
        resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    const completed = (
      await fixture.store.listEvents(fixture.targetThreadId)
    ).find(
      (event) =>
        event.type === "tool.completed" &&
        record(event.payload)?.["toolName"] === "sqlite_query",
    );
    expect(JSON.stringify(completed)).not.toContain("alpha");
    fixture.store.close();
  }, 20_000);

  it("executes a deterministic SQLite chart as a privacy-bounded Tool node", async () => {
    const fixture = await createFixture();
    const database = new DatabaseSync(
      path.join(fixture.workspaceRoot, "workflow-chart.db"),
    );
    database.exec(`
      CREATE TABLE metrics (category TEXT NOT NULL, value INTEGER NOT NULL) STRICT;
      INSERT INTO metrics VALUES ('alpha', 10), ('alpha', 20), ('beta', 30);
    `);
    database.close();
    const snapshot = await inspectSqliteDatabase(
      fixture.workspaceRoot,
      "workflow-chart.db",
    );
    const definition = workflowDefinition(fixture.manifest.blueprint);
    const chartInputSchema: WorkflowObjectSchema = {
      type: "object",
      properties: {
        action: { type: "string", enum: ["chart"] },
        path: { type: "string", minLength: 1, maxLength: 500 },
        databaseSha256: {
          type: "string",
          minLength: 64,
          maxLength: 64,
        },
        sql: { type: "string", minLength: 1, maxLength: 1_000 },
        chart: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["bar"] },
            xColumn: { type: "string", minLength: 1, maxLength: 256 },
            yColumn: { type: "string", minLength: 1, maxLength: 256 },
            title: { type: "string", minLength: 1, maxLength: 160 },
          },
          required: ["type", "xColumn", "yColumn", "title"],
          additionalProperties: false,
        },
      },
      required: ["action", "path", "databaseSha256", "sql", "chart"],
      additionalProperties: false,
    };
    const manifest = defineExecutionPlanWorkflow({
      ...definition,
      nodes: [
        {
          id: "inspect",
          type: "tool",
          tool: "sqlite_query",
          effect: "read",
          inputBindings: {
            action: { source: "literal", value: "chart" },
            path: { source: "literal", value: "workflow-chart.db" },
            databaseSha256: {
              source: "literal",
              value: snapshot.fileSha256,
            },
            sql: {
              source: "literal",
              value:
                "SELECT category, SUM(value) AS total FROM metrics GROUP BY category ORDER BY total DESC",
            },
            chart: {
              source: "literal",
              value: {
                type: "bar",
                xColumn: "category",
                yColumn: "total",
                title: "PRIVATE Workflow chart",
              },
            },
          },
          inputSchema: chartInputSchema,
          outputSchema: sqliteChartReceiptSchema(),
          timeoutMs: 5_000,
          maxAttempts: 1,
        },
        {
          ...definition.nodes[1]!,
          inputBindings: {
            analysis: { source: "node", nodeId: "inspect" },
          },
          inputSchema: {
            type: "object",
            properties: {
              analysis: sqliteChartReceiptSchema(),
            },
            required: ["analysis"],
            additionalProperties: false,
          },
        },
      ],
    });
    fixture.provider.setResponses([
      (context) => {
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain('\\"chartType\\":\\"bar\\"');
        expect(messages).toContain('\\"pointCount\\":2');
        expect(messages).toContain('\\"svgSha256\\":');
        expect(messages).not.toContain("PRIVATE Workflow chart");
        expect(messages).not.toContain("alpha");
        expect(messages).not.toContain("<svg");
        return fauxAssistantMessage(
          '{"report":"Chart receipt verified","approved":true}',
        );
      },
    ]);

    const result = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest,
        input: { request: "Render one SQLite chart." },
      },
    });

    expect(result.status).toBe("completed");
    expect(result.nodeResults[0]?.output).toEqual(
      expect.objectContaining({
        kind: "napier.sqlite-chart",
        action: "chart",
        databaseSha256: snapshot.fileSha256,
        chartType: "bar",
        pointCount: 2,
        svgSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    const completed = (
      await fixture.store.listEvents(fixture.targetThreadId)
    ).find(
      (event) =>
        event.type === "tool.completed" &&
        record(event.payload)?.["toolName"] === "sqlite_query",
    );
    expect(JSON.stringify(completed)).not.toContain("PRIVATE Workflow chart");
    expect(JSON.stringify(completed)).not.toContain("alpha");
    expect(JSON.stringify(completed)).not.toContain("<svg");
    fixture.store.close();
  }, 20_000);

  it("waits for one durable Approval and resumes the typed graph after approval", async () => {
    const fixture = await createFixture();
    const manifest = approvalWorkflowManifest(fixture.manifest.blueprint);

    const waiting = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest,
        input: { request: "Require an explicit release approval." },
      },
    });

    expect(validateExecutionPlanWorkflowResult(waiting)).toEqual(waiting);
    expect(waiting).toEqual(
      expect.objectContaining({
        status: "waiting",
        nodeResults: [
          expect.objectContaining({
            nodeId: "inspect",
            status: "waiting",
            decisionId: expect.stringMatching(/^decision_[a-z0-9]{20}$/u),
          }),
        ],
      }),
    );
    expect(fixture.store.getThread(fixture.targetThreadId).status).toBe(
      "waiting",
    );
    expect(
      (await fixture.store.listEvents(fixture.targetThreadId)).some(
        (event) => event.type === "model.response",
      ),
    ).toBe(false);
    const decision = (
      await fixture.store.listOperatorDecisions(fixture.targetThreadId)
    )[0]!;
    expect(decision).toEqual(
      expect.objectContaining({
        status: "pending",
        runId: waiting.nodeResults[0]?.runId,
        question: "Approve the verified input for final reporting?",
      }),
    );

    await fixture.store.answerOperatorDecision(
      fixture.targetThreadId,
      decision.id,
      {
        selectedOptionIds: ["option_1"],
        customText: "Proceed with the bounded report.",
      },
    );
    await expect(
      fixture.agentRuntime.continueOperatorDecision({
        threadId: fixture.targetThreadId,
        decisionId: decision.id,
      }),
    ).rejects.toThrow("through their Workflow Plan");
    fixture.provider.setResponses([
      (context) => {
        expect(JSON.stringify(context.messages)).toContain(
          '\\"approved\\":true',
        );
        return fauxAssistantMessage(
          '{"report":"Approval applied","approved":true}',
        );
      },
    ]);
    const completed = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: { manifest, planId: waiting.planId },
    });

    expect(completed).toEqual(
      expect.objectContaining({
        status: "completed",
        output: { report: "Approval applied", approved: true },
      }),
    );
    expect(completed.nodeResults[0]).toEqual(
      expect.objectContaining({
        nodeId: "inspect",
        status: "completed",
        runId: waiting.nodeResults[0]?.runId,
        output: expect.objectContaining({
          approved: true,
          decisionId: decision.id,
          selectedOptionId: "option_1",
          answerSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          customText: "Proceed with the bounded report.",
        }),
      }),
    );
    expect(
      await fixture.store.listOperatorDecisions(fixture.targetThreadId),
    ).toEqual([
      expect.objectContaining({
        id: decision.id,
        status: "continued",
        continuationRunId: expect.stringMatching(/^run_[a-z0-9]{20}$/u),
      }),
    ]);
    expect(
      fixture.store.listRuns(fixture.targetThreadId).map((run) => run.source),
    ).toEqual(["workflow", "workflow", "workflow"]);

    const observed = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: { manifest, planId: waiting.planId },
    });
    expect(observed.output).toEqual(completed.output);
    expect(fixture.store.listRuns(fixture.targetThreadId)).toHaveLength(3);
    fixture.store.close();
  });

  it("fails closed when the operator rejects a Workflow Approval", async () => {
    const fixture = await createFixture();
    const manifest = approvalWorkflowManifest(fixture.manifest.blueprint);
    const waiting = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest,
        input: { request: "Do not proceed without approval." },
      },
    });
    const decision = (
      await fixture.store.listOperatorDecisions(fixture.targetThreadId)
    )[0]!;
    await fixture.store.answerOperatorDecision(
      fixture.targetThreadId,
      decision.id,
      {
        selectedOptionIds: ["option_2"],
        customText: "The evidence is incomplete.",
      },
    );

    const rejected = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: { manifest, planId: waiting.planId },
    });

    expect(rejected).toEqual(
      expect.objectContaining({
        status: "blocked",
        nodeResults: [
          expect.objectContaining({
            nodeId: "inspect",
            status: "blocked",
            errorCode: "approval_rejected",
          }),
        ],
      }),
    );
    expect(
      (await fixture.store.listEvents(fixture.targetThreadId)).some(
        (event) => event.type === "model.response",
      ),
    ).toBe(false);
    expect(fixture.store.listRuns(fixture.targetThreadId)).toHaveLength(2);
    const retried = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest,
        planId: waiting.planId,
        retryBlocked: true,
      },
    });
    expect(retried).toEqual(
      expect.objectContaining({
        status: "waiting",
        nodeResults: [
          expect.objectContaining({
            nodeId: "inspect",
            status: "waiting",
            attempt: 2,
          }),
        ],
      }),
    );
    expect(
      (await fixture.store.listOperatorDecisions(fixture.targetThreadId)).map(
        (candidate) => candidate.status,
      ),
    ).toEqual(["continued", "pending"]);
    expect(fixture.store.listRuns(fixture.targetThreadId)).toHaveLength(3);
    fixture.store.close();
  });

  it("blocks cancelled and expired Workflow Approvals without downstream work", async () => {
    const cancelledFixture = await createFixture();
    const cancelledManifest = approvalWorkflowManifest(
      cancelledFixture.manifest.blueprint,
    );
    const cancelledWaiting = await cancelledFixture.workflows.run({
      threadId: cancelledFixture.targetThreadId,
      request: {
        manifest: cancelledManifest,
        input: { request: "Cancel this approval." },
      },
    });
    const cancelledDecision = (
      await cancelledFixture.store.listOperatorDecisions(
        cancelledFixture.targetThreadId,
      )
    )[0]!;
    await cancelledFixture.store.cancelOperatorDecision(
      cancelledFixture.targetThreadId,
      cancelledDecision.id,
    );
    const cancelled = await cancelledFixture.workflows.run({
      threadId: cancelledFixture.targetThreadId,
      request: {
        manifest: cancelledManifest,
        planId: cancelledWaiting.planId,
      },
    });
    expect(cancelled.nodeResults).toEqual([
      expect.objectContaining({
        status: "blocked",
        errorCode: "approval_cancelled",
      }),
    ]);
    cancelledFixture.store.close();

    const timeoutFixture = await createFixture();
    const timeoutManifest = approvalWorkflowManifest(
      timeoutFixture.manifest.blueprint,
      1_000,
    );
    const timeoutWaiting = await timeoutFixture.workflows.run({
      threadId: timeoutFixture.targetThreadId,
      request: {
        manifest: timeoutManifest,
        input: { request: "Expire this approval." },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const timedOut = await timeoutFixture.workflows.run({
      threadId: timeoutFixture.targetThreadId,
      request: {
        manifest: timeoutManifest,
        planId: timeoutWaiting.planId,
      },
    });
    expect(timedOut.nodeResults).toEqual([
      expect.objectContaining({
        status: "blocked",
        errorCode: "approval_timeout",
      }),
    ]);
    expect(
      await timeoutFixture.store.listOperatorDecisions(
        timeoutFixture.targetThreadId,
      ),
    ).toEqual([
      expect.objectContaining({
        status: "cancelled",
        cancellationReason: "workflow_timed_out",
      }),
    ]);
    timeoutFixture.store.close();

    const lateFixture = await createFixture();
    const lateManifest = approvalWorkflowManifest(
      lateFixture.manifest.blueprint,
      1_000,
    );
    const lateWaiting = await lateFixture.workflows.run({
      threadId: lateFixture.targetThreadId,
      request: {
        manifest: lateManifest,
        input: { request: "Reject a late low-level continuation." },
      },
    });
    const lateDecision = (
      await lateFixture.store.listOperatorDecisions(lateFixture.targetThreadId)
    )[0]!;
    const originRun = lateFixture.store.listRuns(
      lateFixture.targetThreadId,
    )[0]!;
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await lateFixture.store.answerOperatorDecision(
      lateFixture.targetThreadId,
      lateDecision.id,
      { selectedOptionIds: ["option_1"] },
    );
    const continuationRun = await lateFixture.store.createRun({
      threadId: lateFixture.targetThreadId,
      agentId: originRun.agentId,
      agentRevision: originRun.agentRevision,
      model: originRun.configuration!.model,
      source: "workflow",
      [WORKFLOW_NODE_EXECUTION]: { planId: lateWaiting.planId },
      parentRunId: originRun.id,
      operatorDecisionId: lateDecision.id,
    });
    await lateFixture.store.continueOperatorDecision(
      lateFixture.targetThreadId,
      lateDecision.id,
      continuationRun.id,
    );
    await lateFixture.store.finishRun(continuationRun.id, "completed");
    const late = await lateFixture.workflows.run({
      threadId: lateFixture.targetThreadId,
      request: { manifest: lateManifest, planId: lateWaiting.planId },
    });
    expect(late.nodeResults).toEqual([
      expect.objectContaining({
        status: "blocked",
        errorCode: "approval_timeout",
      }),
    ]);
    lateFixture.store.close();
  });

  it("cancels a pre-aborted Approval without creating a Run or decision", async () => {
    const fixture = await createFixture();
    const manifest = approvalWorkflowManifest(fixture.manifest.blueprint);
    const controller = new AbortController();
    controller.abort();

    await expect(
      fixture.workflows.run({
        threadId: fixture.targetThreadId,
        request: {
          manifest,
          input: { request: "Do not create an Approval Run." },
        },
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(fixture.store.listRuns(fixture.targetThreadId)).toEqual([]);
    expect(
      await fixture.store.listOperatorDecisions(fixture.targetThreadId),
    ).toEqual([]);
    fixture.store.close();
  });

  it("recovers a completed Tool Run after Plan completion fails", async () => {
    const fixture = await createFixture();
    const manifest = listToolWorkflowManifest(
      fixture.manifest.blueprint,
      5_000,
    );
    fixture.provider.setResponses([
      fauxAssistantMessage('{"report":"Commit gap recovered","approved":true}'),
    ]);
    const transitionPlanStep = fixture.store.transitionPlanStep.bind(
      fixture.store,
    );
    let failCompletion = true;
    fixture.store.transitionPlanStep = async (planId, stepId, request) => {
      if (request.action === "complete" && failCompletion) {
        failCompletion = false;
        throw new Error("Injected Plan completion failure");
      }
      return transitionPlanStep(planId, stepId, request);
    };

    const blocked = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest,
        input: { request: "Recover one commit gap." },
      },
    });
    expect(blocked).toEqual(
      expect.objectContaining({
        status: "blocked",
        nodeResults: [
          expect.objectContaining({
            nodeId: "inspect",
            status: "blocked",
            runId: expect.stringMatching(/^run_[a-z0-9]{20}$/u),
            errorCode: "tool_failed",
          }),
        ],
      }),
    );
    expect(fixture.store.listRuns(fixture.targetThreadId)).toEqual([
      expect.objectContaining({ status: "completed", source: "workflow" }),
    ]);
    expect(
      (await fixture.store.listEvents(fixture.targetThreadId)).filter(
        (event) => event.type === "workflow.completed",
      ),
    ).toEqual([]);

    fixture.store.transitionPlanStep = transitionPlanStep;
    const recovered = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest,
        planId: blocked.planId,
      },
    });
    expect(recovered).toEqual(
      expect.objectContaining({
        status: "completed",
        output: {
          report: "Commit gap recovered",
          approved: true,
        },
      }),
    );
    expect(
      (await fixture.store.listEvents(fixture.targetThreadId)).filter(
        (event) =>
          event.type === "tool.started" &&
          record(event.payload)?.["toolName"] === "list_files",
      ),
    ).toHaveLength(1);
    expect(fixture.store.listRuns(fixture.targetThreadId)).toHaveLength(2);
    fixture.store.close();
  });

  it("blocks a Tool node before execution when its declared effect drifts", async () => {
    const fixture = await createFixture();
    const definition = workflowDefinition(fixture.manifest.blueprint);
    const manifest = defineExecutionPlanWorkflow({
      ...definition,
      nodes: [
        {
          id: "inspect",
          type: "tool",
          tool: "list_files",
          effect: "write",
          inputBindings: {
            path: { source: "literal", value: "." },
          },
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string", minLength: 1, maxLength: 20 },
            },
            required: ["path"],
            additionalProperties: false,
          },
          outputSchema: listFilesReceiptSchema(),
          timeoutMs: 5_000,
          maxAttempts: 1,
        },
        definition.nodes[1]!,
      ],
    });

    const result = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest,
        input: { request: "Reject effect drift." },
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "blocked",
        nodeResults: [
          expect.objectContaining({
            nodeId: "inspect",
            errorCode: "effect_mismatch",
          }),
        ],
      }),
    );
    const events = await fixture.store.listEvents(fixture.targetThreadId);
    expect(
      events.some(
        (event) =>
          event.type === "tool.blocked" &&
          record(event.payload)?.["errorCode"] === "effect_mismatch",
      ),
    ).toBe(true);
    expect(events.some((event) => event.type === "tool.started")).toBe(false);
    fixture.store.close();
  });

  it("cancels and times out Tool preflight before tool.started", async () => {
    const cancelledFixture = await createFixture();
    const cancelledManifest = listToolWorkflowManifest(
      cancelledFixture.manifest.blueprint,
      5_000,
    );
    const controller = new AbortController();
    const cancelled = await cancelledFixture.workflows.run({
      threadId: cancelledFixture.targetThreadId,
      request: {
        manifest: cancelledManifest,
        input: { request: "Cancel Tool preflight." },
      },
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === "workflow.node.started") controller.abort();
      },
    });
    expect(cancelled).toEqual(
      expect.objectContaining({
        status: "cancelled",
        nodeResults: [
          expect.objectContaining({
            nodeId: "inspect",
            errorCode: "cancelled",
          }),
        ],
      }),
    );
    expect(
      (
        await cancelledFixture.store.listEvents(cancelledFixture.targetThreadId)
      ).some((event) => event.type === "tool.started"),
    ).toBe(false);
    cancelledFixture.store.close();

    const timeoutFixture = await createFixture();
    const timeoutManifest = listToolWorkflowManifest(
      timeoutFixture.manifest.blueprint,
      1_000,
    );
    const timedOut = await timeoutFixture.workflows.run({
      threadId: timeoutFixture.targetThreadId,
      request: {
        manifest: timeoutManifest,
        input: { request: "Time out Tool preflight." },
      },
      onEvent: async (event) => {
        if (event.type === "workflow.node.started") {
          await new Promise((resolve) => setTimeout(resolve, 1_100));
        }
      },
    });
    expect(timedOut).toEqual(
      expect.objectContaining({
        status: "blocked",
        nodeResults: [
          expect.objectContaining({
            nodeId: "inspect",
            errorCode: "timeout",
          }),
        ],
      }),
    );
    expect(
      (
        await timeoutFixture.store.listEvents(timeoutFixture.targetThreadId)
      ).some((event) => event.type === "tool.started"),
    ).toBe(false);
    timeoutFixture.store.close();
  }, 20_000);

  it("denies a write Tool node under the pinned observe policy", async () => {
    const fixture = await createFixture();
    const definition = workflowDefinition(fixture.manifest.blueprint);
    const manifest = defineExecutionPlanWorkflow({
      ...definition,
      nodes: [
        {
          id: "inspect",
          type: "tool",
          tool: "apply_patch",
          effect: "write",
          inputBindings: {
            operation: { source: "literal", value: "create" },
            path: { source: "literal", value: "should-not-exist.txt" },
            expectedSha256: { source: "literal", value: null },
            content: { source: "literal", value: "must not be written" },
          },
          inputSchema: {
            type: "object",
            properties: {
              operation: { type: "string", enum: ["create"] },
              path: { type: "string", minLength: 1, maxLength: 200 },
              expectedSha256: { type: "null" },
              content: { type: "string", minLength: 1, maxLength: 200 },
            },
            required: ["operation", "path", "expectedSha256", "content"],
            additionalProperties: false,
          },
          outputSchema: listFilesReceiptSchema(),
          timeoutMs: 5_000,
          maxAttempts: 1,
        },
        definition.nodes[1]!,
      ],
    });

    const result = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest,
        input: { request: "Attempt a denied write." },
      },
    });

    expect(result.nodeResults).toEqual([
      expect.objectContaining({
        nodeId: "inspect",
        errorCode: "policy_denied",
      }),
    ]);
    await expect(
      readFile(path.join(fixture.workspaceRoot, "should-not-exist.txt")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      (await fixture.store.listEvents(fixture.targetThreadId)).some(
        (event) => event.type === "tool.started",
      ),
    ).toBe(false);
    fixture.store.close();
  });

  it("executes a fresh CAS-bound write Tool under workspace policy", async () => {
    const fixture = await createFixture();
    const thread = fixture.store.getThread(fixture.targetThreadId);
    await fixture.store.updateAgent(thread.agentId, {
      toolPolicy: "workspace",
    });
    const definition = workflowDefinition(fixture.manifest.blueprint);
    const manifest = defineExecutionPlanWorkflow({
      ...definition,
      nodes: [
        {
          id: "inspect",
          type: "tool",
          tool: "apply_patch",
          effect: "write",
          inputBindings: {
            operation: { source: "literal", value: "create" },
            path: { source: "literal", value: "tool-created.txt" },
            expectedSha256: { source: "literal", value: null },
            content: { source: "literal", value: "created by Tool node\n" },
          },
          inputSchema: {
            type: "object",
            properties: {
              operation: { type: "string", enum: ["create"] },
              path: { type: "string", minLength: 1, maxLength: 200 },
              expectedSha256: { type: "null" },
              content: { type: "string", minLength: 1, maxLength: 200 },
            },
            required: ["operation", "path", "expectedSha256", "content"],
            additionalProperties: false,
          },
          outputSchema: workspacePatchReceiptSchema(),
          timeoutMs: 5_000,
          maxAttempts: 1,
        },
        {
          ...definition.nodes[1]!,
          inputBindings: {
            patch: { source: "node", nodeId: "inspect" },
          },
          inputSchema: {
            type: "object",
            properties: {
              patch: workspacePatchReceiptSchema(),
            },
            required: ["patch"],
            additionalProperties: false,
          },
        },
      ],
    });
    fixture.provider.setResponses([
      (context) => {
        expect(JSON.stringify(context.messages)).toContain(
          '\\"operation\\":\\"create\\"',
        );
        return fauxAssistantMessage(
          '{"report":"Write verified","approved":true}',
        );
      },
    ]);

    const result = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest,
        input: { request: "Create one file." },
      },
    });

    expect(result.status).toBe("completed");
    expect(result.nodeResults[0]?.output).toEqual(
      expect.objectContaining({
        kind: "napier.workspace-patch",
        operation: "create",
        beforeSha256: null,
        afterSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    await expect(
      readFile(path.join(fixture.workspaceRoot, "tool-created.txt"), "utf8"),
    ).resolves.toBe("created by Tool node\n");
    const started = (
      await fixture.store.listEvents(fixture.targetThreadId)
    ).find((event) => event.type === "tool.started");
    expect(started?.payload).toEqual(
      expect.objectContaining({
        toolName: "apply_patch",
        effect: "write",
        inputRedacted: true,
      }),
    );
    fixture.store.close();
  });

  it("records missing field-path input as a bounded blocked attempt", async () => {
    const fixture = await createFixture();
    const definition = workflowDefinition(fixture.manifest.blueprint);
    const manifest = defineExecutionPlanWorkflow({
      ...definition,
      inputSchema: {
        type: "object",
        properties: {
          optionalPath: { type: "string", minLength: 1, maxLength: 100 },
        },
        required: [],
        additionalProperties: false,
      },
      nodes: [
        {
          id: "inspect",
          type: "tool",
          tool: "list_files",
          effect: "read",
          inputBindings: {
            path: {
              source: "workflow",
              path: ["optionalPath"],
            },
          },
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string", minLength: 1, maxLength: 100 },
            },
            required: ["path"],
            additionalProperties: false,
          },
          outputSchema: listFilesReceiptSchema(),
          timeoutMs: 5_000,
          maxAttempts: 2,
        },
        definition.nodes[1]!,
      ],
    });

    const first = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: { manifest, input: {} },
    });
    expect(first.nodeResults).toEqual([
      expect.objectContaining({
        nodeId: "inspect",
        attempt: 1,
        errorCode: "input_invalid",
        inputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    ]);
    expect(fixture.store.listRuns(fixture.targetThreadId)).toHaveLength(0);

    const observed = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: { manifest, planId: first.planId },
    });
    expect(observed.nodeResults).toEqual(first.nodeResults);
    const retried = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: { manifest, planId: first.planId, retryBlocked: true },
    });
    expect(retried.nodeResults).toEqual([
      expect.objectContaining({
        attempt: 2,
        errorCode: "input_invalid",
      }),
    ]);
    expect(fixture.store.listRuns(fixture.targetThreadId)).toHaveLength(0);
    fixture.store.close();
  });

  it("isolates each node from Thread message history and unbound node outputs", async () => {
    const fixture = await createFixture();
    const definition = workflowDefinition(fixture.manifest.blueprint);
    const manifest = defineExecutionPlanWorkflow({
      ...definition,
      nodes: definition.nodes.map((node) =>
        node.id === "report"
          ? {
              ...node,
              inputBindings: {
                workflow: { source: "workflow" as const },
              },
              inputSchema: {
                type: "object" as const,
                properties: { workflow: requestSchema() },
                required: ["workflow"],
                additionalProperties: false as const,
              },
            }
          : node,
      ),
    });
    fixture.provider.setResponses([
      fauxAssistantMessage('{"summary":"PRIVATE_UNBOUND_OUTPUT","count":1}'),
      (context) => {
        expect(JSON.stringify(context.messages)).not.toContain(
          "PRIVATE_UNBOUND_OUTPUT",
        );
        expect((context.tools ?? []).map((tool) => tool.name)).toEqual(
          expect.not.arrayContaining([
            "create_plan",
            "update_plan_step",
            "update_plan_artifact",
            "record_agent_milestone",
            "request_operator_decision",
          ]),
        );
        return fauxAssistantMessage(
          '{"report":"History isolated","approved":true}',
        );
      },
    ]);

    const result = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest,
        input: { request: "Run isolated nodes." },
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "completed",
        output: { report: "History isolated", approved: true },
      }),
    );
    expect(
      fixture.store.listRuns(fixture.targetThreadId).map((run) => run.source),
    ).toEqual(["workflow", "workflow"]);
    const prepared = (await fixture.store.listEvents(fixture.targetThreadId))
      .filter((event) => event.type === "context.prepared")
      .map((event) => record(event.payload)?.["messageCount"]);
    expect(prepared).toEqual([0, 0]);
    fixture.store.close();
  }, 20_000);

  it("blocks invalid output and retries only after explicit bounded resume", async () => {
    const fixture = await createFixture();
    fixture.provider.setResponses([fauxAssistantMessage("not json")]);

    const blocked = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest: fixture.manifest,
        input: { request: "Produce a typed report." },
      },
    });

    expect(blocked).toEqual(
      expect.objectContaining({
        status: "blocked",
        nodeResults: [
          expect.objectContaining({
            nodeId: "inspect",
            attempt: 1,
            status: "blocked",
            errorCode: "output_invalid",
          }),
        ],
      }),
    );
    expect(fixture.store.getPlan(blocked.planId)).toEqual(
      expect.objectContaining({
        status: "blocked",
        steps: [
          expect.objectContaining({ id: "inspect", status: "blocked" }),
          expect.objectContaining({ id: "report", status: "pending" }),
        ],
      }),
    );
    const observedBlocked = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest: fixture.manifest,
        planId: blocked.planId,
      },
    });
    expect(observedBlocked.nodeResults).toEqual([
      expect.objectContaining({
        nodeId: "inspect",
        attempt: 1,
        status: "blocked",
        errorCode: "output_invalid",
      }),
    ]);
    expect(
      (await fixture.store.listEvents(fixture.targetThreadId)).filter(
        (event) => event.type === "workflow.blocked",
      ),
    ).toHaveLength(1);

    fixture.provider.setResponses([
      fauxAssistantMessage('{"summary":"Recovered","count":1}'),
      fauxAssistantMessage('{"report":"Recovered report","approved":true}'),
    ]);
    const completed = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest: fixture.manifest,
        planId: blocked.planId,
        retryBlocked: true,
      },
    });

    expect(completed).toEqual(
      expect.objectContaining({
        status: "completed",
        resumed: true,
        output: { report: "Recovered report", approved: true },
      }),
    );
    expect(completed.nodeResults[0]).toEqual(
      expect.objectContaining({
        nodeId: "inspect",
        attempt: 2,
        status: "completed",
      }),
    );
    const events = await fixture.store.listEvents(fixture.targetThreadId);
    expect(
      events.filter(
        (event) =>
          event.type === "workflow.node.started" &&
          record(event.payload)?.["nodeId"] === "inspect",
      ),
    ).toHaveLength(2);
    fixture.store.close();
  }, 20_000);

  it("records repeated blocked outcomes at distinct Plan revisions", async () => {
    const fixture = await createFixture();
    fixture.provider.setResponses([
      fauxAssistantMessage('{"summary":"Ready","count":1}'),
      fauxAssistantMessage("not json"),
    ]);
    const first = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest: fixture.manifest,
        input: { request: "Fail the report twice." },
      },
    });
    expect(first.status).toBe("blocked");

    fixture.provider.setResponses([fauxAssistantMessage("still not json")]);
    const second = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest: fixture.manifest,
        planId: first.planId,
        retryBlocked: true,
      },
    });
    expect(second.status).toBe("blocked");
    const blockedEvents = (
      await fixture.store.listEvents(fixture.targetThreadId)
    ).filter((event) => event.type === "workflow.blocked");
    expect(blockedEvents).toHaveLength(2);
    expect(
      blockedEvents.map((event) => record(event.payload)?.["planRevision"]),
    ).toEqual([expect.any(Number), expect.any(Number)]);
    expect(record(blockedEvents[1]?.payload)?.["planRevision"]).toBeGreaterThan(
      Number(record(blockedEvents[0]?.payload)?.["planRevision"]),
    );
    fixture.store.close();
  });

  it("fails pre-abort without mutation and records cancellation during a real model stream", async () => {
    const fixture = await createFixture({ tokensPerSecond: 1 });
    const preAborted = new AbortController();
    preAborted.abort();
    await expect(
      fixture.workflows.run({
        threadId: fixture.targetThreadId,
        request: {
          manifest: fixture.manifest,
          input: { request: "Do not start." },
        },
        signal: preAborted.signal,
      }),
    ).rejects.toThrow();
    expect(fixture.store.listPlans(fixture.targetThreadId)).toEqual([]);

    fixture.provider.setResponses([
      fauxAssistantMessage(
        JSON.stringify({
          summary: "x".repeat(200),
          count: 1,
        }),
      ),
    ]);
    const controller = new AbortController();
    const cancelled = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest: fixture.manifest,
        input: { request: "Cancel while streaming." },
      },
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === "workflow.node.started") controller.abort();
      },
    });

    expect(cancelled).toEqual(
      expect.objectContaining({
        status: "cancelled",
        nodeResults: [
          expect.objectContaining({
            nodeId: "inspect",
            status: "cancelled",
            errorCode: "cancelled",
          }),
        ],
      }),
    );
    expect(fixture.store.getPlan(cancelled.planId).status).toBe("blocked");
    expect(
      (await fixture.store.listEvents(fixture.targetThreadId)).some(
        (event) => event.type === "workflow.cancelled",
      ),
    ).toBe(true);
    fixture.store.close();
  }, 20_000);

  it("enforces node timeout and rejects concurrent execution on one Thread", async () => {
    const fixture = await createFixture({ tokensPerSecond: 1 });
    const manifest = defineExecutionPlanWorkflow({
      ...workflowDefinition(fixture.manifest.blueprint),
      nodes: workflowDefinition(fixture.manifest.blueprint).nodes.map((node) =>
        node.id === "inspect" ? { ...node, timeoutMs: 1_000 } : node,
      ),
    });
    fixture.provider.setResponses([
      fauxAssistantMessage(
        JSON.stringify({
          summary: "x".repeat(200),
          count: 1,
        }),
      ),
    ]);
    let releaseStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      releaseStarted = resolve;
    });
    const first = fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest,
        input: { request: "Time out while streaming." },
      },
      onEvent: (event) => {
        if (event.type === "workflow.node.started") releaseStarted();
      },
    });
    await started;
    await expect(
      fixture.workflows.run({
        threadId: fixture.targetThreadId,
        request: {
          manifest,
          input: { request: "Concurrent duplicate." },
        },
      }),
    ).rejects.toThrow("active Workflow");

    const timedOut = await first;
    expect(timedOut).toEqual(
      expect.objectContaining({
        status: "blocked",
        nodeResults: [
          expect.objectContaining({
            nodeId: "inspect",
            status: "blocked",
            errorCode: "timeout",
          }),
        ],
      }),
    );
    fixture.store.close();
  }, 20_000);

  it("executes independent Agent nodes concurrently before a typed join", async () => {
    const fixture = await createParallelFixture();
    const branchResponse = (context: { messages: unknown[] }) => {
      const prompt = JSON.stringify(context.messages);
      return fauxAssistantMessage(
        prompt.includes("analyze_a")
          ? '{"summary":"Left analysis","count":1}'
          : '{"summary":"Right analysis","count":1}',
      );
    };
    fixture.provider.setResponses([
      branchResponse,
      branchResponse,
      (context) => {
        const prompt = JSON.stringify(context.messages);
        expect(prompt).toContain('\\"summary\\":\\"Left analysis\\"');
        expect(prompt).toContain('\\"summary\\":\\"Right analysis\\"');
        return fauxAssistantMessage(
          '{"report":"Parallel join complete","approved":true}',
        );
      },
    ]);
    const startedNodeIds = new Set<string>();
    let releaseBranches!: () => void;
    const branchGate = new Promise<void>((resolve) => {
      releaseBranches = resolve;
    });
    let resolveBothStarted!: () => void;
    const bothStarted = new Promise<void>((resolve) => {
      resolveBothStarted = resolve;
    });
    const execution = fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest: fixture.manifest,
        input: { request: "Run both analyses concurrently." },
      },
      onEvent: async (event) => {
        if (event.type !== "workflow.node.started") return;
        const nodeId = record(event.payload)?.["nodeId"];
        if (nodeId !== "analyze_a" && nodeId !== "analyze_b") return;
        startedNodeIds.add(nodeId);
        if (startedNodeIds.size === 2) resolveBothStarted();
        await branchGate;
      },
    });
    await Promise.race([
      bothStarted,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Parallel Workflow nodes did not overlap")),
          2_000,
        ),
      ),
    ]);

    const activeRuns = fixture.store
      .listRuns(fixture.targetThreadId)
      .filter((run) => run.status === "running");
    expect(activeRuns).toHaveLength(2);
    expect(fixture.store.getThread(fixture.targetThreadId).currentRunId).toBe(
      activeRuns[0]?.id,
    );
    await expect(
      fixture.store.queueRunControlMessage({
        threadId: fixture.targetThreadId,
        runId: activeRuns[0]!.id,
        mode: "steering",
        text: "Do not inject detached control into a Workflow node.",
      }),
    ).rejects.toThrow("Workflow node Runs");
    releaseBranches();
    const result = await execution;

    expect(result).toEqual(
      expect.objectContaining({
        status: "completed",
        output: { report: "Parallel join complete", approved: true },
        nodeResults: [
          expect.objectContaining({
            nodeId: "analyze_a",
            status: "completed",
          }),
          expect.objectContaining({
            nodeId: "analyze_b",
            status: "completed",
          }),
          expect.objectContaining({
            nodeId: "report",
            status: "completed",
          }),
        ],
      }),
    );
    const branchRuns = fixture.store
      .listRuns(fixture.targetThreadId)
      .filter((run) =>
        result.nodeResults.slice(0, 2).some((node) => node.runId === run.id),
      );
    expect(branchRuns).toHaveLength(2);
    expect(
      Math.max(...branchRuns.map((run) => Date.parse(run.startedAt))),
    ).toBeLessThan(
      Math.min(...branchRuns.map((run) => Date.parse(run.finishedAt!))),
    );
    expect(fixture.store.getThread(fixture.targetThreadId)).toEqual(
      expect.objectContaining({
        status: "idle",
      }),
    );
    expect(
      fixture.store.getThread(fixture.targetThreadId).currentRunId,
    ).toBeUndefined();
    fixture.store.close();
  }, 20_000);

  it("skips a false conditional branch and joins its typed fallback", async () => {
    const fixture = await createParallelFixture();
    const manifest = conditionalWorkflowManifest(fixture.manifest.blueprint, 2);
    fixture.provider.setResponses([
      (context) => {
        const prompt = JSON.stringify(context.messages);
        expect(prompt).toContain('\\"summary\\":\\"Left skipped\\"');
        expect(prompt).toContain('\\"summary\\":\\"Right deterministic\\"');
        return fauxAssistantMessage(
          '{"report":"Conditional join complete","approved":true}',
        );
      },
    ]);
    const result = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest,
        input: {
          request: "Skip the left branch.",
          executeLeft: false,
        },
      },
    });

    expect(validateExecutionPlanWorkflowResult(result)).toEqual(result);
    expect(result).toEqual(
      expect.objectContaining({
        status: "completed",
        output: {
          report: "Conditional join complete",
          approved: true,
        },
        nodeResults: [
          expect.objectContaining({
            nodeId: "analyze_a",
            attempt: 0,
            status: "skipped",
            output: { summary: "Left skipped", count: 0 },
          }),
          expect.objectContaining({
            nodeId: "analyze_b",
            status: "completed",
          }),
          expect.objectContaining({
            nodeId: "report",
            status: "completed",
          }),
        ],
      }),
    );
    expect(
      fixture.store
        .getPlan(result.planId)
        .steps.map((step) => [step.id, step.status]),
    ).toEqual([
      ["analyze_a", "skipped"],
      ["analyze_b", "completed"],
      ["report", "completed"],
    ]);
    expect(fixture.store.listRuns(fixture.targetThreadId)).toHaveLength(2);
    const skipped = (
      await fixture.store.listEvents(fixture.targetThreadId)
    ).filter((event) => event.type === "workflow.node.skipped");
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.payload).toEqual(
      expect.objectContaining({
        attempt: 0,
        matched: false,
        recovered: false,
        reused: false,
        conditionSubjectSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        outputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(JSON.stringify(skipped[0]?.payload)).not.toContain("Left skipped");
    expect(
      verifyThreadReplayBundle(
        await exportThreadReplayBundle(fixture.store, fixture.targetThreadId),
      ).status,
    ).toBe("valid");
    fixture.store.close();
  });

  it("executes a true conditional branch as a normal Agent Run", async () => {
    const fixture = await createParallelFixture();
    const manifest = conditionalWorkflowManifest(fixture.manifest.blueprint, 2);
    fixture.provider.setResponses([
      fauxAssistantMessage('{"summary":"Left executed","count":1}'),
      fauxAssistantMessage(
        '{"report":"True conditional complete","approved":true}',
      ),
    ]);
    const result = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest,
        input: {
          request: "Execute the left branch.",
          executeLeft: true,
        },
      },
    });

    expect(result.status).toBe("completed");
    expect(result.nodeResults[0]).toEqual(
      expect.objectContaining({
        nodeId: "analyze_a",
        attempt: 1,
        status: "completed",
        output: { summary: "Left executed", count: 1 },
      }),
    );
    expect(fixture.store.listRuns(fixture.targetThreadId)).toHaveLength(3);
    expect(
      (await fixture.store.listEvents(fixture.targetThreadId)).filter(
        (event) => event.type === "workflow.node.skipped",
      ),
    ).toHaveLength(0);
    fixture.store.close();
  });

  it("blocks a conditional node when its typed runtime path is unavailable", async () => {
    const fixture = await createParallelFixture();
    const manifest = conditionalArrayWorkflowManifest(
      fixture.manifest.blueprint,
    );
    const result = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest,
        input: {
          request: "Reject an empty route list.",
          routes: [],
        },
      },
    });

    expect(result.status).toBe("blocked");
    expect(result.nodeResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: "analyze_a",
          status: "blocked",
          errorCode: "condition_invalid",
        }),
      ]),
    );
    expect(
      (await fixture.store.listEvents(fixture.targetThreadId)).filter(
        (event) => event.type === "workflow.node.skipped",
      ),
    ).toHaveLength(0);
    const second = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest,
        planId: result.planId,
        retryBlocked: true,
      },
    });
    expect(second.nodeResults[0]).toEqual(
      expect.objectContaining({
        nodeId: "analyze_a",
        attempt: 2,
        errorCode: "condition_invalid",
      }),
    );
    const exhausted = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest,
        planId: result.planId,
        retryBlocked: true,
      },
    });
    expect(exhausted.nodeResults[0]).toEqual(
      expect.objectContaining({
        nodeId: "analyze_a",
        attempt: 2,
        errorCode: "condition_invalid",
      }),
    );

    await fixture.store.transitionPlanStep(result.planId, "analyze_a", {
      action: "reopen",
    });
    const manuallyReopened = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest,
        planId: result.planId,
      },
    });
    expect(manuallyReopened.nodeResults[0]).toEqual(
      expect.objectContaining({
        nodeId: "analyze_a",
        attempt: 2,
        errorCode: "attempt_limit",
      }),
    );
    fixture.store.close();
  });

  it("repairs a conditional skip commit gap without executing the branch", async () => {
    const fixture = await createParallelFixture();
    const manifest = conditionalWorkflowManifest(fixture.manifest.blueprint, 1);
    const appendEvent = fixture.store.appendEvent.bind(fixture.store);
    let failSkipEvent = true;
    fixture.store.appendEvent = async (input) => {
      if (input.type === "workflow.node.skipped" && failSkipEvent) {
        failSkipEvent = false;
        throw new Error("Injected conditional skip evidence failure");
      }
      return appendEvent(input);
    };
    await expect(
      fixture.workflows.run({
        threadId: fixture.targetThreadId,
        request: {
          manifest,
          input: {
            request: "Recover the skipped branch.",
            executeLeft: false,
          },
        },
      }),
    ).rejects.toThrow("conditional skip evidence");
    const plan = fixture.store.listPlans(fixture.targetThreadId)[0]!;
    expect(plan.steps[0]?.status).toBe("skipped");
    expect(fixture.store.listRuns(fixture.targetThreadId)).toHaveLength(0);

    fixture.store.appendEvent = appendEvent;
    fixture.provider.setResponses([
      fauxAssistantMessage(
        '{"report":"Recovered conditional join","approved":true}',
      ),
    ]);
    const recovered = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: { manifest, planId: plan.id },
    });
    expect(recovered.status).toBe("completed");
    expect(recovered.nodeResults[0]).toEqual(
      expect.objectContaining({
        nodeId: "analyze_a",
        attempt: 0,
        status: "skipped",
      }),
    );
    const skipped = (
      await fixture.store.listEvents(fixture.targetThreadId)
    ).filter((event) => event.type === "workflow.node.skipped");
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.payload).toEqual(
      expect.objectContaining({ recovered: true }),
    );
    expect(fixture.store.listRuns(fixture.targetThreadId)).toHaveLength(2);
    await fixture.store.appendEvent({
      threadId: fixture.targetThreadId,
      runId: "runctl_duplicate_skip",
      type: "workflow.node.skipped",
      category: "plan",
      visibility: "user",
      payload: structuredClone(skipped[0]!.payload),
    });
    await expect(
      fixture.workflows.run({
        threadId: fixture.targetThreadId,
        request: { manifest, planId: plan.id },
      }),
    ).rejects.toThrow("skip evidence is ambiguous");
    fixture.store.close();
  });

  it("preserves a successful parallel sibling when another Agent node fails", async () => {
    const fixture = await createParallelFixture();
    const manifest = defineExecutionPlanWorkflow({
      ...parallelWorkflowDefinition(fixture.manifest.blueprint),
      maxConcurrency: 2,
      nodes: parallelWorkflowDefinition(fixture.manifest.blueprint).nodes.map(
        (node) =>
          node.id === "analyze_a"
            ? {
                ...node,
                model: { provider: "missing-parallel", id: "missing-1" },
              }
            : node,
      ),
    });
    fixture.provider.setResponses([
      fauxAssistantMessage('{"summary":"Right survived","count":1}'),
    ]);
    const result = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest,
        input: { request: "Preserve independent successful work." },
      },
    });

    expect(result.status).toBe("blocked");
    expect(result.nodeResults).toEqual([
      expect.objectContaining({
        nodeId: "analyze_a",
        status: "blocked",
      }),
      expect.objectContaining({
        nodeId: "analyze_b",
        status: "completed",
        output: { summary: "Right survived", count: 1 },
      }),
    ]);
    expect(
      fixture.store
        .listRuns(fixture.targetThreadId)
        .map((run) => run.status)
        .sort(),
    ).toEqual(["completed", "failed"]);
    expect(fixture.store.getThread(fixture.targetThreadId).status).toBe(
      "failed",
    );
    fixture.store.close();
  });

  it("cancels every active node in one parallel batch", async () => {
    const fixture = await createParallelFixture();
    fixture.provider.setResponses([
      fauxAssistantMessage('{"summary":"Left cancelled","count":1}'),
      fauxAssistantMessage('{"summary":"Right cancelled","count":1}'),
    ]);
    const controller = new AbortController();
    const startedNodeIds = new Set<string>();
    let releaseBranches!: () => void;
    const branchGate = new Promise<void>((resolve) => {
      releaseBranches = resolve;
    });
    const result = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest: fixture.manifest,
        input: { request: "Cancel the parallel batch." },
      },
      signal: controller.signal,
      onEvent: async (event) => {
        if (event.type !== "workflow.node.started") return;
        const nodeId = record(event.payload)?.["nodeId"];
        if (nodeId !== "analyze_a" && nodeId !== "analyze_b") return;
        startedNodeIds.add(nodeId);
        if (startedNodeIds.size === 2) {
          controller.abort();
          releaseBranches();
        }
        await branchGate;
      },
    });

    expect(result.status).toBe("cancelled");
    expect(result.nodeResults).toEqual([
      expect.objectContaining({
        nodeId: "analyze_a",
        status: "cancelled",
      }),
      expect.objectContaining({
        nodeId: "analyze_b",
        status: "cancelled",
      }),
    ]);
    expect(
      fixture.store.listRuns(fixture.targetThreadId).map((run) => run.status),
    ).toEqual(["cancelled", "cancelled"]);
    expect(fixture.store.getThread(fixture.targetThreadId)).toEqual(
      expect.objectContaining({
        status: "idle",
      }),
    );
    expect(
      fixture.store.getThread(fixture.targetThreadId).currentRunId,
    ).toBeUndefined();
    fixture.store.close();
  }, 20_000);

  it("runs an Approval as an exclusive barrier after parallel-ready work", async () => {
    const fixture = await createParallelFixture();
    const manifest = parallelApprovalWorkflowManifest(
      fixture.manifest.blueprint,
    );
    fixture.provider.setResponses([
      fauxAssistantMessage('{"summary":"Independent work complete","count":1}'),
    ]);
    const result = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest,
        input: { request: "Complete work before requesting approval." },
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "waiting",
        nodeResults: [
          expect.objectContaining({
            nodeId: "analyze_a",
            status: "waiting",
          }),
          expect.objectContaining({
            nodeId: "analyze_b",
            status: "completed",
          }),
        ],
      }),
    );
    const events = await fixture.store.listEvents(fixture.targetThreadId);
    const rightCompleted = events.find(
      (event) =>
        event.type === "workflow.node.completed" &&
        record(event.payload)?.["nodeId"] === "analyze_b",
    );
    const approvalStarted = events.find(
      (event) =>
        event.type === "workflow.node.started" &&
        record(event.payload)?.["nodeId"] === "analyze_a",
    );
    expect(rightCompleted?.seq).toBeLessThan(approvalStarted!.seq);
    expect(
      await fixture.store.listOperatorDecisions(fixture.targetThreadId),
    ).toEqual([
      expect.objectContaining({
        status: "pending",
        question: "Approve the completed parallel work?",
      }),
    ]);
    expect(fixture.store.getThread(fixture.targetThreadId).status).toBe(
      "waiting",
    );
    fixture.store.close();
  });

  it("binds an unavailable model failure to a Run and still exhausts attempts", async () => {
    const fixture = await createFixture();
    await fixture.store.setGoal(
      fixture.targetThreadId,
      createGoal("Keep this Thread goal independent from Workflow nodes."),
    );
    const definition = workflowDefinition(fixture.manifest.blueprint);
    const manifest = defineExecutionPlanWorkflow({
      ...definition,
      nodes: definition.nodes.map((node) =>
        node.id === "inspect"
          ? {
              ...node,
              model: { provider: "missing-workflow", id: "missing-1" },
              maxAttempts: 1,
            }
          : node,
      ),
    });

    const blocked = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest,
        input: { request: "Fail before creating a Run." },
      },
    });

    expect(blocked.nodeResults).toEqual([
      expect.objectContaining({
        nodeId: "inspect",
        attempt: 1,
        status: "blocked",
        errorCode: "run_failed",
        runId: expect.stringMatching(/^run_[a-z0-9]{20}$/u),
      }),
    ]);
    expect(fixture.store.listRuns(fixture.targetThreadId)).toHaveLength(1);
    const runCount = fixture.store.listRuns(fixture.targetThreadId).length;
    const exhausted = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest,
        planId: blocked.planId,
        retryBlocked: true,
      },
    });
    expect(exhausted.nodeResults).toEqual([
      expect.objectContaining({
        nodeId: "inspect",
        attempt: 1,
        errorCode: "run_failed",
      }),
    ]);
    expect(fixture.store.listRuns(fixture.targetThreadId)).toHaveLength(
      runCount,
    );
    expect(fixture.store.getPlan(blocked.planId).steps[0]?.status).toBe(
      "blocked",
    );
    expect(fixture.store.getThread(fixture.targetThreadId).goal?.status).toBe(
      "active",
    );

    await fixture.store.transitionPlanStep(blocked.planId, "inspect", {
      action: "reopen",
    });
    const manuallyReopened = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest,
        planId: blocked.planId,
      },
    });
    expect(manuallyReopened.nodeResults).toEqual([
      expect.objectContaining({
        nodeId: "inspect",
        attempt: 1,
        status: "blocked",
        errorCode: "attempt_limit",
      }),
    ]);
    expect(validateExecutionPlanWorkflowResult(manuallyReopened).status).toBe(
      "blocked",
    );
    fixture.store.close();
  });
});

async function createParallelFixture(): Promise<{
  store: LocalStore;
  provider: ReturnType<typeof fauxProvider>;
  agentRuntime: AgentRuntime;
  workflows: ExecutionPlanWorkflowRuntime;
  targetThreadId: string;
  manifest: ExecutionPlanWorkflowManifest;
}> {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-workflow-parallel-runtime-"),
  );
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  await store.initialize();
  const sourceThread = store.listThreads()[0]!;
  const sourcePlan = await store.createPlan(sourceThread.id, {
    objective: "Analyze two independent inputs and join one typed report.",
    steps: [
      {
        id: "analyze_a",
        title: "Analyze left",
        description: "Analyze the left branch.",
        verification: "Return typed left analysis.",
      },
      {
        id: "analyze_b",
        title: "Analyze right",
        description: "Analyze the right branch.",
        verification: "Return typed right analysis.",
      },
      {
        id: "report",
        title: "Join report",
        description: "Join both typed analyses.",
        verification: "Return one typed report.",
        dependsOn: ["analyze_a", "analyze_b"],
      },
    ],
  });
  const blueprint = await createExecutionPlanBlueprint(
    store,
    sourceThread.id,
    sourcePlan.id,
  );
  const targetThread = await store.createThread({
    title: "Parallel Workflow target",
    agentId: sourceThread.agentId,
  });
  const provider = fauxProvider({ provider: "faux-workflow" });
  const models = new ModelRegistry();
  models.registerProvider(provider.provider);
  const agentRuntime = new AgentRuntime(store, models);
  return {
    store,
    provider,
    agentRuntime,
    workflows: new ExecutionPlanWorkflowRuntime(store, agentRuntime),
    targetThreadId: targetThread.id,
    manifest: defineExecutionPlanWorkflow(
      parallelWorkflowDefinition(blueprint),
    ),
  };
}

async function createFixture(
  options: { tokensPerSecond?: number } = {},
): Promise<{
  store: LocalStore;
  provider: ReturnType<typeof fauxProvider>;
  agentRuntime: AgentRuntime;
  workflows: ExecutionPlanWorkflowRuntime;
  targetThreadId: string;
  manifest: ExecutionPlanWorkflowManifest;
  workspaceRoot: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-workflow-runtime-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  await writeFile(path.join(workspaceRoot, "evidence.txt"), "evidence\n");
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  await store.initialize();
  const sourceThread = store.listThreads()[0]!;
  const sourcePlan = await store.createPlan(sourceThread.id, {
    objective: "Create a typed report.",
    steps: [
      {
        id: "inspect",
        title: "Inspect",
        description: "Inspect the workflow input.",
        verification: "Return typed inspection JSON.",
      },
      {
        id: "report",
        title: "Report",
        description: "Produce the final report from inspected evidence.",
        verification: "Return typed report JSON.",
        dependsOn: ["inspect"],
      },
    ],
  });
  const blueprint = await createExecutionPlanBlueprint(
    store,
    sourceThread.id,
    sourcePlan.id,
  );
  const targetThread = await store.createThread({
    title: "Workflow target",
    agentId: sourceThread.agentId,
  });
  const provider = fauxProvider({
    provider: "faux-workflow",
    ...(options.tokensPerSecond
      ? { tokensPerSecond: options.tokensPerSecond }
      : {}),
  });
  const models = new ModelRegistry();
  models.registerProvider(provider.provider);
  const agentRuntime = new AgentRuntime(store, models);
  return {
    store,
    provider,
    agentRuntime,
    workflows: new ExecutionPlanWorkflowRuntime(store, agentRuntime),
    targetThreadId: targetThread.id,
    manifest: defineExecutionPlanWorkflow(workflowDefinition(blueprint)),
    workspaceRoot,
  };
}

function parallelWorkflowDefinition(blueprint: ExecutionPlanBlueprint) {
  return {
    name: "Parallel typed report",
    version: 1,
    description: "Run two independent typed analyses before one join.",
    blueprint,
    inputSchema: requestSchema(),
    outputSchema: reportSchema(),
    outputNodeId: "report",
    maxConcurrency: 2,
    nodes: [
      {
        id: "analyze_a",
        type: "agent" as const,
        inputBindings: {
          workflow: { source: "workflow" as const },
        },
        inputSchema: {
          type: "object" as const,
          properties: { workflow: requestSchema() },
          required: ["workflow"],
          additionalProperties: false as const,
        },
        outputSchema: inspectionSchema(),
        model: { provider: "faux-workflow", id: "faux-1" },
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
      {
        id: "analyze_b",
        type: "agent" as const,
        inputBindings: {
          workflow: { source: "workflow" as const },
        },
        inputSchema: {
          type: "object" as const,
          properties: { workflow: requestSchema() },
          required: ["workflow"],
          additionalProperties: false as const,
        },
        outputSchema: inspectionSchema(),
        model: { provider: "faux-workflow", id: "faux-1" },
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
      {
        id: "report",
        type: "agent" as const,
        inputBindings: {
          workflow: { source: "workflow" as const },
          left: { source: "node" as const, nodeId: "analyze_a" },
          right: { source: "node" as const, nodeId: "analyze_b" },
        },
        inputSchema: {
          type: "object" as const,
          properties: {
            workflow: requestSchema(),
            left: inspectionSchema(),
            right: inspectionSchema(),
          },
          required: ["workflow", "left", "right"],
          additionalProperties: false as const,
        },
        outputSchema: reportSchema(),
        model: { provider: "faux-workflow", id: "faux-1" },
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
    ],
  };
}

function switchWorkflowManifest(
  blueprint: ExecutionPlanBlueprint,
  options: {
    includeDefault?: boolean;
    auditEquals?: JsonValue;
  } = {},
): ExecutionPlanWorkflowManifest {
  const inputSchema: WorkflowObjectSchema = {
    type: "object",
    properties: {
      request: { type: "string", minLength: 1, maxLength: 500 },
      route: {
        type: "string",
        enum: ["priority", "audit", "other"],
      },
    },
    required: ["request", "route"],
    additionalProperties: false,
  };
  return defineExecutionPlanWorkflow({
    name: "Typed multi-way Switch",
    version: 1,
    description:
      "Select one deterministic typed branch without a model or tool call.",
    blueprint,
    inputSchema,
    outputSchema: reportSchema(),
    outputNodeId: "report",
    nodes: [
      {
        id: "inspect",
        type: "deterministic",
        inputBindings: {
          workflow: { source: "workflow" },
        },
        inputSchema: {
          type: "object",
          properties: { workflow: inputSchema },
          required: ["workflow"],
          additionalProperties: false,
        },
        outputSchema: inspectionSchema(),
        template: {
          kind: "switch",
          path: ["workflow", "route"],
          cases: [
            {
              id: "fast_path",
              equals: "priority",
              then: {
                kind: "object",
                properties: {
                  summary: {
                    kind: "input",
                    path: ["workflow", "request"],
                  },
                  count: { kind: "literal", value: 1 },
                },
              },
            },
            {
              id: "audit_path",
              equals: options.auditEquals ?? "audit",
              then: {
                kind: "literal",
                value: { summary: "Audit route", count: 2 },
              },
            },
          ],
          ...((options.includeDefault ?? true)
            ? {
                default: {
                  kind: "literal" as const,
                  value: { summary: "Default route", count: 0 },
                },
              }
            : {}),
        },
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
      {
        id: "report",
        type: "deterministic",
        inputBindings: {
          inspection: { source: "node", nodeId: "inspect" },
        },
        inputSchema: {
          type: "object",
          properties: { inspection: inspectionSchema() },
          required: ["inspection"],
          additionalProperties: false,
        },
        outputSchema: reportSchema(),
        template: {
          kind: "object",
          properties: {
            report: {
              kind: "input",
              path: ["inspection", "summary"],
            },
            approved: { kind: "literal", value: true },
          },
        },
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
    ],
  });
}

function conditionalWorkflowManifest(
  blueprint: ExecutionPlanBlueprint,
  maxConcurrency: number,
): ExecutionPlanWorkflowManifest {
  return defineExecutionPlanWorkflow({
    name: "Conditional typed report",
    version: 1,
    description: "Skip or execute one typed branch before a shared join.",
    blueprint,
    inputSchema: conditionalRequestSchema(),
    outputSchema: reportSchema(),
    outputNodeId: "report",
    maxConcurrency,
    nodes: [
      {
        id: "analyze_a",
        type: "agent",
        inputBindings: {
          workflow: { source: "workflow" },
        },
        inputSchema: {
          type: "object",
          properties: { workflow: conditionalRequestSchema() },
          required: ["workflow"],
          additionalProperties: false,
        },
        outputSchema: inspectionSchema(),
        when: {
          path: ["workflow", "executeLeft"],
          equals: true,
        },
        skipOutput: { summary: "Left skipped", count: 0 },
        model: { provider: "faux-workflow", id: "faux-1" },
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
      {
        id: "analyze_b",
        type: "deterministic",
        inputBindings: {
          workflow: { source: "workflow" },
        },
        inputSchema: {
          type: "object",
          properties: { workflow: conditionalRequestSchema() },
          required: ["workflow"],
          additionalProperties: false,
        },
        outputSchema: inspectionSchema(),
        template: {
          kind: "literal",
          value: { summary: "Right deterministic", count: 1 },
        },
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
      {
        id: "report",
        type: "agent",
        inputBindings: {
          left: { source: "node", nodeId: "analyze_a" },
          right: { source: "node", nodeId: "analyze_b" },
        },
        inputSchema: {
          type: "object",
          properties: {
            left: inspectionSchema(),
            right: inspectionSchema(),
          },
          required: ["left", "right"],
          additionalProperties: false,
        },
        outputSchema: reportSchema(),
        model: { provider: "faux-workflow", id: "faux-1" },
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
    ],
  });
}

function conditionalArrayWorkflowManifest(
  blueprint: ExecutionPlanBlueprint,
): ExecutionPlanWorkflowManifest {
  const base = conditionalWorkflowManifest(blueprint, 1);
  const inputSchema: WorkflowObjectSchema = {
    type: "object",
    properties: {
      request: { type: "string", minLength: 1, maxLength: 500 },
      routes: {
        type: "array",
        items: { type: "string", minLength: 1, maxLength: 20 },
        maxItems: 4,
      },
    },
    required: ["request", "routes"],
    additionalProperties: false,
  };
  return defineExecutionPlanWorkflow({
    name: "Conditional array report",
    version: 1,
    description: "Exercise a bounded runtime condition path failure.",
    blueprint,
    inputSchema,
    outputSchema: base.outputSchema,
    outputNodeId: base.outputNodeId,
    maxConcurrency: 1,
    nodes: base.nodes.map((node) =>
      node.id === "analyze_a"
        ? {
            ...node,
            inputSchema: {
              type: "object" as const,
              properties: { workflow: inputSchema },
              required: ["workflow"],
              additionalProperties: false as const,
            },
            when: {
              path: ["workflow", "routes", 0],
              equals: "execute",
            },
          }
        : node.id === "analyze_b"
          ? {
              ...node,
              inputSchema: {
                type: "object" as const,
                properties: { workflow: inputSchema },
                required: ["workflow"],
                additionalProperties: false as const,
              },
            }
          : node,
    ),
  });
}

function parallelApprovalWorkflowManifest(
  blueprint: ExecutionPlanBlueprint,
): ExecutionPlanWorkflowManifest {
  const definition = parallelWorkflowDefinition(blueprint);
  return defineExecutionPlanWorkflow({
    ...definition,
    nodes: [
      {
        id: "analyze_a",
        type: "approval",
        header: "Release",
        question: "Approve the completed parallel work?",
        approve: {
          label: "Approve",
          description: "Continue to the typed join.",
        },
        reject: {
          label: "Reject",
          description: "Block the final report.",
        },
        inputBindings: {
          workflow: { source: "workflow" },
        },
        inputSchema: {
          type: "object",
          properties: { workflow: requestSchema() },
          required: ["workflow"],
          additionalProperties: false,
        },
        outputSchema: structuredClone(
          EXECUTION_PLAN_WORKFLOW_APPROVAL_OUTPUT_SCHEMA,
        ),
        timeoutMs: 60_000,
        maxAttempts: 2,
      },
      definition.nodes[1]!,
      {
        ...definition.nodes[2]!,
        inputBindings: {
          approval: { source: "node", nodeId: "analyze_a" },
          right: { source: "node", nodeId: "analyze_b" },
        },
        inputSchema: {
          type: "object",
          properties: {
            approval: structuredClone(
              EXECUTION_PLAN_WORKFLOW_APPROVAL_OUTPUT_SCHEMA,
            ),
            right: inspectionSchema(),
          },
          required: ["approval", "right"],
          additionalProperties: false,
        },
      },
    ],
  });
}

function workflowDefinition(blueprint: ExecutionPlanBlueprint) {
  return {
    name: "Typed report",
    version: 1,
    description: "Inspect input and produce one typed report.",
    blueprint,
    inputSchema: requestSchema(),
    outputSchema: reportSchema(),
    outputNodeId: "report",
    nodes: [
      {
        id: "inspect",
        type: "agent" as const,
        inputBindings: {
          workflow: { source: "workflow" as const },
        },
        inputSchema: {
          type: "object" as const,
          properties: { workflow: requestSchema() },
          required: ["workflow"],
          additionalProperties: false as const,
        },
        outputSchema: inspectionSchema(),
        model: { provider: "faux-workflow", id: "faux-1" },
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
      {
        id: "report",
        type: "agent" as const,
        inputBindings: {
          workflow: { source: "workflow" as const },
          inspection: { source: "node" as const, nodeId: "inspect" },
        },
        inputSchema: {
          type: "object" as const,
          properties: {
            workflow: requestSchema(),
            inspection: inspectionSchema(),
          },
          required: ["workflow", "inspection"],
          additionalProperties: false as const,
        },
        outputSchema: reportSchema(),
        model: { provider: "faux-workflow", id: "faux-1" },
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
    ],
  };
}

function requestSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      request: { type: "string", minLength: 1, maxLength: 500 },
    },
    required: ["request"],
    additionalProperties: false,
  };
}

function conditionalRequestSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      request: { type: "string", minLength: 1, maxLength: 500 },
      executeLeft: { type: "boolean" },
    },
    required: ["request", "executeLeft"],
    additionalProperties: false,
  };
}

function inspectionSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      summary: { type: "string", minLength: 1, maxLength: 500 },
      count: { type: "integer", minimum: 0, maximum: 20 },
    },
    required: ["summary", "count"],
    additionalProperties: false,
  };
}

function reportSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      report: { type: "string", minLength: 1, maxLength: 1_000 },
      approved: { type: "boolean" },
    },
    required: ["report", "approved"],
    additionalProperties: false,
  };
}

function deterministicWorkflowManifest(
  blueprint: ExecutionPlanBlueprint,
  template: ExecutionPlanWorkflowDeterministicTemplate = {
    kind: "object",
    properties: {
      summary: {
        kind: "input",
        path: ["workflow", "request"],
      },
      count: { kind: "literal", value: 1 },
    },
  },
  timeoutMs = 5_000,
): ExecutionPlanWorkflowManifest {
  const definition = workflowDefinition(blueprint);
  return defineExecutionPlanWorkflow({
    ...definition,
    nodes: [
      {
        id: "inspect",
        type: "deterministic",
        inputBindings: {
          workflow: { source: "workflow" },
        },
        inputSchema: {
          type: "object",
          properties: { workflow: requestSchema() },
          required: ["workflow"],
          additionalProperties: false,
        },
        outputSchema: inspectionSchema(),
        template,
        timeoutMs,
        maxAttempts: 2,
      },
      definition.nodes[1]!,
    ],
  });
}

function approvalWorkflowManifest(
  blueprint: ExecutionPlanBlueprint,
  timeoutMs = 60_000,
): ExecutionPlanWorkflowManifest {
  const definition = workflowDefinition(blueprint);
  return defineExecutionPlanWorkflow({
    ...definition,
    nodes: [
      {
        id: "inspect",
        type: "approval",
        header: "Release",
        question: "Approve the verified input for final reporting?",
        approve: {
          label: "Approve",
          description: "Continue to the final typed report.",
        },
        reject: {
          label: "Reject",
          description: "Block the Workflow without running the report Agent.",
        },
        inputBindings: {
          workflow: { source: "workflow" },
        },
        inputSchema: {
          type: "object",
          properties: { workflow: requestSchema() },
          required: ["workflow"],
          additionalProperties: false,
        },
        outputSchema: structuredClone(
          EXECUTION_PLAN_WORKFLOW_APPROVAL_OUTPUT_SCHEMA,
        ),
        timeoutMs,
        maxAttempts: 2,
      },
      {
        ...definition.nodes[1]!,
        inputBindings: {
          approval: { source: "node", nodeId: "inspect" },
        },
        inputSchema: {
          type: "object",
          properties: {
            approval: structuredClone(
              EXECUTION_PLAN_WORKFLOW_APPROVAL_OUTPUT_SCHEMA,
            ),
          },
          required: ["approval"],
          additionalProperties: false,
        },
      },
    ],
  });
}

function listToolWorkflowManifest(
  blueprint: ExecutionPlanBlueprint,
  timeoutMs: number,
): ExecutionPlanWorkflowManifest {
  const definition = workflowDefinition(blueprint);
  return defineExecutionPlanWorkflow({
    ...definition,
    nodes: [
      {
        id: "inspect",
        type: "tool",
        tool: "list_files",
        effect: "read",
        inputBindings: {
          path: { source: "literal", value: "." },
        },
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", minLength: 1, maxLength: 20 },
          },
          required: ["path"],
          additionalProperties: false,
        },
        outputSchema: listFilesReceiptSchema(),
        timeoutMs,
        maxAttempts: 1,
      },
      {
        ...definition.nodes[1]!,
        inputBindings: {
          inventory: { source: "node", nodeId: "inspect" },
        },
        inputSchema: {
          type: "object",
          properties: {
            inventory: listFilesReceiptSchema(),
          },
          required: ["inventory"],
          additionalProperties: false,
        },
      },
    ],
  });
}

function listFilesReceiptSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      count: { type: "integer", minimum: 0 },
      truncated: { type: "boolean" },
      pathSha256: { type: "string", minLength: 64, maxLength: 64 },
      entrySetSha256: { type: "string", minLength: 64, maxLength: 64 },
    },
    required: ["count", "truncated", "pathSha256", "entrySetSha256"],
    additionalProperties: false,
  };
}

function sqliteQueryReceiptSchema(): WorkflowObjectSchema {
  const hash = { type: "string" as const, minLength: 64, maxLength: 64 };
  return {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["napier.sqlite-query"] },
      schemaVersion: { type: "integer", minimum: 1, maximum: 1 },
      action: { type: "string", enum: ["query"] },
      databasePathSha256: hash,
      databaseSha256: hash,
      databaseBytes: { type: "integer", minimum: 16 },
      sqlSha256: hash,
      parameterCount: { type: "integer", minimum: 0, maximum: 50 },
      parameterSetSha256: hash,
      columnCount: { type: "integer", minimum: 0, maximum: 80 },
      rowCount: { type: "integer", minimum: 0, maximum: 100 },
      truncated: { type: "boolean" },
      columnsSha256: hash,
      rowsSha256: hash,
      durationMs: { type: "integer", minimum: 0, maximum: 6_000 },
      workerSha256: hash,
      runtimeSha256: hash,
      limitsSha256: hash,
      resultSha256: hash,
    },
    required: [
      "kind",
      "schemaVersion",
      "action",
      "databasePathSha256",
      "databaseSha256",
      "databaseBytes",
      "sqlSha256",
      "parameterCount",
      "parameterSetSha256",
      "columnCount",
      "rowCount",
      "truncated",
      "columnsSha256",
      "rowsSha256",
      "durationMs",
      "workerSha256",
      "runtimeSha256",
      "limitsSha256",
      "resultSha256",
    ],
    additionalProperties: false,
  };
}

function sqliteChartReceiptSchema(): WorkflowObjectSchema {
  const base = sqliteQueryReceiptSchema();
  const hash = { type: "string" as const, minLength: 64, maxLength: 64 };
  return {
    ...base,
    properties: {
      ...base.properties,
      kind: { type: "string", enum: ["napier.sqlite-chart"] },
      action: { type: "string", enum: ["chart"] },
      rowCount: { type: "integer", minimum: 1, maximum: 50 },
      chartType: { type: "string", enum: ["bar", "line"] },
      pointCount: { type: "integer", minimum: 1, maximum: 50 },
      width: { type: "integer", minimum: 480, maximum: 1_600 },
      height: { type: "integer", minimum: 320, maximum: 1_000 },
      chartSpecSha256: hash,
      svgSha256: hash,
      svgBytes: { type: "integer", minimum: 1, maximum: 48 * 1024 },
      rendererSha256: hash,
      chartLimitsSha256: hash,
      queryResultSha256: hash,
    },
    required: [
      ...base.required,
      "chartType",
      "pointCount",
      "width",
      "height",
      "chartSpecSha256",
      "svgSha256",
      "svgBytes",
      "rendererSha256",
      "chartLimitsSha256",
      "queryResultSha256",
    ],
  };
}

function workspacePatchReceiptSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
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
    },
    required: [
      "kind",
      "schemaVersion",
      "pathSha256",
      "operation",
      "beforeSha256",
      "afterSha256",
      "beforeBytes",
      "afterBytes",
      "editCount",
      "resultSha256",
    ],
    additionalProperties: false,
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
