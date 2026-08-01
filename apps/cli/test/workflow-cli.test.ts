import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { EXECUTION_PLAN_WORKFLOW_APPROVAL_OUTPUT_SCHEMA } from "@napier/contracts";
import type {
  ExecutionPlanWorkflowExperimentPreview,
  ExecutionPlanWorkflowExperimentResultFrame,
  ExecutionPlanWorkflowResultFrame,
  JsonValue,
  StreamFrame,
  WorkflowObjectSchema,
} from "@napier/contracts";
import {
  canonicalJson,
  createExecutionPlanBlueprint,
  createLocalAgentRuntime,
  defineExecutionPlanWorkflow,
  sha256,
  UnsupportedSandboxAdapter,
  validateExecutionPlanWorkflowExperimentResultFrame,
  validateExecutionPlanWorkflowResultFrame,
  type LocalAgentRuntimeOptions,
} from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import {
  parseCliArgs,
  runCli,
  type CliIo,
  type RunCliDependencies,
} from "../src/cli.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Napier Workflow CLI", () => {
  it("parses new and resume modes without ambiguous inputs", () => {
    expect(
      parseCliArgs([
        "workflow",
        "--workspace",
        ".",
        "--manifest",
        "workflow.json",
        "--input-json",
        '{"request":"ship"}',
        "--jsonl",
      ]),
    ).toEqual({
      kind: "workflow",
      options: {
        workspace: ".",
        manifestPath: "workflow.json",
        inputJson: '{"request":"ship"}',
        timeoutMs: 600_000,
        jsonl: true,
        retryBlocked: false,
      },
    });
    expect(
      parseCliArgs([
        "workflow",
        "--workspace",
        ".",
        "--manifest",
        "workflow.json",
        "--thread",
        "thread_abcdefghijklmnopqrst",
        "--plan",
        "plan_abcdefghijklmnopqrst",
        "--from-node",
        "inspect",
        "--replace-input-json",
        '{"workflow":{"request":"replacement"}}',
        "--preview-experiment",
        "--jsonl",
      ]),
    ).toEqual({
      kind: "workflow",
      options: {
        workspace: ".",
        manifestPath: "workflow.json",
        threadId: "thread_abcdefghijklmnopqrst",
        planId: "plan_abcdefghijklmnopqrst",
        fromNodeId: "inspect",
        replaceInputJson: '{"workflow":{"request":"replacement"}}',
        previewExperiment: true,
        timeoutMs: 600_000,
        jsonl: true,
        retryBlocked: false,
      },
    });
    expect(
      parseCliArgs([
        "workflow",
        "--workspace",
        ".",
        "--manifest",
        "workflow.json",
        "--thread",
        "thread_abcdefghijklmnopqrst",
        "--plan",
        "plan_abcdefghijklmnopqrst",
        "--retry-blocked",
      ]),
    ).toEqual({
      kind: "workflow",
      options: {
        workspace: ".",
        manifestPath: "workflow.json",
        threadId: "thread_abcdefghijklmnopqrst",
        planId: "plan_abcdefghijklmnopqrst",
        timeoutMs: 600_000,
        jsonl: false,
        retryBlocked: true,
      },
    });
    expect(
      parseCliArgs([
        "workflow",
        "--workspace",
        ".",
        "--manifest",
        "workflow.json",
        "--thread",
        "thread_abcdefghijklmnopqrst",
        "--plan",
        "plan_abcdefghijklmnopqrst",
        "--approve",
        "--decision-note",
        "Ship the verified result.",
      ]),
    ).toEqual({
      kind: "workflow",
      options: {
        workspace: ".",
        manifestPath: "workflow.json",
        threadId: "thread_abcdefghijklmnopqrst",
        planId: "plan_abcdefghijklmnopqrst",
        approval: "approve",
        decisionNote: "Ship the verified result.",
        timeoutMs: 600_000,
        jsonl: false,
        retryBlocked: false,
      },
    });
    expect(
      parseCliArgs([
        "workflow",
        "--workspace",
        ".",
        "--manifest",
        "workflow.json",
        "--thread",
        "thread_abcdefghijklmnopqrst",
        "--plan",
        "plan_abcdefghijklmnopqrst",
        "--from-node",
        "inspect",
        "--simulate-output-json",
        '{"summary":"simulated","count":2}',
        "--preview-experiment",
        "--jsonl",
      ]),
    ).toEqual({
      kind: "workflow",
      options: {
        workspace: ".",
        manifestPath: "workflow.json",
        threadId: "thread_abcdefghijklmnopqrst",
        planId: "plan_abcdefghijklmnopqrst",
        fromNodeId: "inspect",
        simulateOutputJson: '{"summary":"simulated","count":2}',
        previewExperiment: true,
        timeoutMs: 600_000,
        jsonl: true,
        retryBlocked: false,
      },
    });
    expect(
      parseCliArgs([
        "workflow",
        "--workspace",
        ".",
        "--manifest",
        "workflow.json",
        "--thread",
        "thread_abcdefghijklmnopqrst",
        "--plan",
        "plan_abcdefghijklmnopqrst",
        "--from-node",
        "report",
        "--step-nodes",
        "--preview-experiment",
        "--jsonl",
      ]),
    ).toEqual({
      kind: "workflow",
      options: {
        workspace: ".",
        manifestPath: "workflow.json",
        threadId: "thread_abcdefghijklmnopqrst",
        planId: "plan_abcdefghijklmnopqrst",
        fromNodeId: "report",
        stepNodes: true,
        previewExperiment: true,
        timeoutMs: 600_000,
        jsonl: true,
        retryBlocked: false,
      },
    });
    expect(() =>
      parseCliArgs([
        "workflow",
        "--workspace",
        ".",
        "--manifest",
        "workflow.json",
        "--thread",
        "thread_abcdefghijklmnopqrst",
        "--plan",
        "plan_abcdefghijklmnopqrst",
        "--from-node",
        "report",
        "--single-node",
        "--step-nodes",
        "--preview-experiment",
      ]),
    ).toThrow("mutually exclusive");
    expect(() =>
      parseCliArgs([
        "workflow",
        "--workspace",
        ".",
        "--manifest",
        "workflow.json",
        "--thread",
        "thread_abcdefghijklmnopqrst",
        "--plan",
        "plan_abcdefghijklmnopqrst",
        "--from-node",
        "inspect",
        "--simulate-output-json",
        '{"summary":"simulated","count":2}',
      ]),
    ).toThrow("requires --expected-preview");
    expect(() =>
      parseCliArgs([
        "workflow",
        "--workspace",
        ".",
        "--manifest",
        "workflow.json",
        "--thread",
        "thread_abcdefghijklmnopqrst",
        "--plan",
        "plan_abcdefghijklmnopqrst",
        "--from-node",
        "inspect",
        "--single-node",
        "--simulate-output-json",
        '{"summary":"simulated","count":2}',
        "--preview-experiment",
      ]),
    ).toThrow("mutually exclusive");
    expect(() =>
      parseCliArgs([
        "workflow",
        "--workspace",
        ".",
        "--manifest",
        "workflow.json",
        "--thread",
        "thread_abcdefghijklmnopqrst",
        "--plan",
        "plan_abcdefghijklmnopqrst",
        "--from-node",
        "inspect",
        "--single-node",
      ]),
    ).toThrow("requires --expected-preview");
    expect(() =>
      parseCliArgs([
        "workflow",
        "--workspace",
        ".",
        "--manifest",
        "workflow.json",
        "--thread",
        "thread_abcdefghijklmnopqrst",
        "--plan",
        "plan_abcdefghijklmnopqrst",
        "--approve",
        "--reject",
      ]),
    ).toThrow("mutually exclusive");
    expect(() =>
      parseCliArgs([
        "workflow",
        "--workspace",
        ".",
        "--manifest",
        "workflow.json",
      ]),
    ).toThrow("--input-json is required");
    expect(() =>
      parseCliArgs([
        "workflow",
        "--workspace",
        ".",
        "--manifest",
        "workflow.json",
        "--thread",
        "thread_abcdefghijklmnopqrst",
        "--plan",
        "plan_abcdefghijklmnopqrst",
        "--input-json",
        "{}",
      ]),
    ).toThrow("normal Workflow resume");
    expect(
      parseCliArgs([
        "workflow",
        "--workspace",
        ".",
        "--manifest",
        "workflow.json",
        "--thread",
        "thread_abcdefghijklmnopqrst",
        "--plan",
        "plan_abcdefghijklmnopqrst",
        "--from-node",
        "report",
        "--single-node",
        "--preview-experiment",
        "--jsonl",
      ]),
    ).toEqual({
      kind: "workflow",
      options: {
        workspace: ".",
        manifestPath: "workflow.json",
        threadId: "thread_abcdefghijklmnopqrst",
        planId: "plan_abcdefghijklmnopqrst",
        fromNodeId: "report",
        singleNode: true,
        previewExperiment: true,
        timeoutMs: 600_000,
        jsonl: true,
        retryBlocked: false,
      },
    });
    expect(() =>
      parseCliArgs([
        "workflow",
        "--workspace",
        ".",
        "--manifest",
        "workflow.json",
        "--input-json",
        "{}",
        "--single-node",
      ]),
    ).toThrow("experiment options require --from-node");
  });

  it("streams one typed Workflow through the shared Runtime and resumes from Ledger", async () => {
    const fixture = await createFixture();
    const provider = fauxProvider({ provider: "faux-workflow-cli" });
    provider.setResponses([
      fauxAssistantMessage('{"summary":"CLI inspection","count":1}'),
      fauxAssistantMessage('{"report":"CLI report","approved":true}'),
    ]);
    const dependencies = providerDependencies(provider);
    const stdout = new CaptureWritable();

    const code = await runCli(
      [
        "workflow",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--manifest",
        "workflow.json",
        "--input-json",
        '{"request":"Create the CLI report."}',
        "--jsonl",
      ],
      cliIo(fixture.root, stdout),
      dependencies,
    );

    expect(code).toBe(0);
    const frames = parseFrames(stdout.text());
    expect(frames[0]?.type).toBe("event");
    expect(frames.at(-2)?.type).toBe("snapshot");
    expect(frames.at(-1)?.type).toBe("workflow_result");
    const workflowFrame = validateExecutionPlanWorkflowResultFrame(
      frames.at(-1),
    );
    expect(workflowFrame).toEqual(
      expect.objectContaining({
        status: "completed",
        result: expect.objectContaining({
          output: { report: "CLI report", approved: true },
          resumed: false,
        }),
      }),
    );
    const tampered = structuredClone(workflowFrame);
    tampered.result.output = { report: "TAMPERED", approved: true };
    expect(() => validateExecutionPlanWorkflowResultFrame(tampered)).toThrow(
      "output",
    );
    const eventFrames = frames.filter(
      (frame): frame is Extract<StreamFrame, { type: "event" }> =>
        frame.type === "event",
    );
    expect(eventFrames.map((frame) => frame.event.seq)).toEqual(
      eventFrames.map((_, index) => index + 1),
    );

    const resumedStdout = new CaptureWritable();
    const resumedCode = await runCli(
      [
        "workflow",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--manifest",
        "workflow.json",
        "--thread",
        workflowFrame.threadId,
        "--plan",
        workflowFrame.planId,
        "--jsonl",
      ],
      cliIo(fixture.root, resumedStdout),
      dependencies,
    );
    expect(resumedCode).toBe(0);
    expect(
      validateExecutionPlanWorkflowResultFrame(
        parseFrames(resumedStdout.text()).at(-1),
      ).result,
    ).toEqual(
      expect.objectContaining({
        resumed: true,
        output: { report: "CLI report", approved: true },
      }),
    );
  }, 20_000);

  it("streams a model-free Tool Workflow through ordered JSONL", async () => {
    const fixture = await createToolFixture();
    const stdout = new CaptureWritable();
    const code = await runCli(
      [
        "workflow",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--manifest",
        "workflow.json",
        "--input-json",
        '{"request":"Inventory without a model."}',
        "--jsonl",
      ],
      cliIo(fixture.root, stdout),
      {
        createRuntime: (options) =>
          createLocalAgentRuntime({
            ...options,
            sandbox: new UnsupportedSandboxAdapter("workflow-tool-cli-test"),
          }),
      },
    );

    expect(code).toBe(0);
    const frames = parseFrames(stdout.text());
    const result = validateExecutionPlanWorkflowResultFrame(frames.at(-1));
    expect(result).toEqual(
      expect.objectContaining({
        status: "completed",
        result: expect.objectContaining({
          output: expect.objectContaining({
            count: 1,
            truncated: false,
            pathSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
            entrySetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          }),
        }),
      }),
    );
    const events = frames.flatMap((frame) =>
      frame.type === "event" ? [frame.event] : [],
    );
    expect(events.some((event) => event.type === "model.response")).toBe(false);
    expect(
      events.filter(
        (event) =>
          event.type === "tool.started" || event.type === "tool.completed",
      ),
    ).toHaveLength(2);
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "plan.artifact.produced",
        "plan.artifact.verified",
        "workflow.artifacts.settled",
      ]),
    );
    expect(frames.at(-2)?.type).toBe("snapshot");
  });

  it("pauses and explicitly continues a Tool Workflow through JSONL", async () => {
    const fixture = await createToolFixture();
    const dependencies = {
      createRuntime: (options: LocalAgentRuntimeOptions) =>
        createLocalAgentRuntime({
          ...options,
          sandbox: new UnsupportedSandboxAdapter(
            "workflow-breakpoint-cli-test",
          ),
        }),
    };
    const pausedStdout = new CaptureWritable();
    expect(
      await runCli(
        [
          "workflow",
          "--workspace",
          fixture.workspaceRoot,
          "--data-root",
          fixture.dataRoot,
          "--manifest",
          "workflow.json",
          "--input-json",
          '{"request":"Pause before inventory."}',
          "--break-before",
          "inventory",
          "--jsonl",
        ],
        cliIo(fixture.root, pausedStdout),
        dependencies,
      ),
    ).toBe(0);
    const pausedFrames = parseFrames(pausedStdout.text());
    const paused = validateExecutionPlanWorkflowResultFrame(
      pausedFrames.at(-1),
    );
    expect(paused).toEqual(
      expect.objectContaining({
        status: "paused",
        result: expect.objectContaining({
          breakpoint: expect.objectContaining({ nodeId: "inventory" }),
          nodeResults: [],
        }),
      }),
    );
    const rebound = structuredClone(paused);
    rebound.status = "waiting";
    expect(() => validateExecutionPlanWorkflowResultFrame(rebound)).toThrow(
      "binding",
    );
    const missingBreakpoint = structuredClone(paused);
    delete missingBreakpoint.result.breakpoint;
    expect(() =>
      validateExecutionPlanWorkflowResultFrame(missingBreakpoint),
    ).toThrow("breakpoint");
    const impossibleSequence = structuredClone(paused);
    impossibleSequence.result.breakpoint!.reachedEventSeq =
      impossibleSequence.eventCount + 1;
    const { resultSha256: _resultSha256, ...resultContent } =
      impossibleSequence.result;
    impossibleSequence.result.resultSha256 = sha256(
      canonicalJson(resultContent as JsonValue),
    );
    const { contentSha256: _contentSha256, ...frameContent } =
      impossibleSequence;
    impossibleSequence.contentSha256 = sha256(
      canonicalJson(frameContent as JsonValue),
    );
    expect(() =>
      validateExecutionPlanWorkflowResultFrame(impossibleSequence),
    ).toThrow("binding");
    expect(
      pausedFrames.some(
        (frame) =>
          frame.type === "event" && frame.event.type === "tool.started",
      ),
    ).toBe(false);

    const resumedStdout = new CaptureWritable();
    expect(
      await runCli(
        [
          "workflow",
          "--workspace",
          fixture.workspaceRoot,
          "--data-root",
          fixture.dataRoot,
          "--manifest",
          "workflow.json",
          "--thread",
          paused.threadId,
          "--plan",
          paused.planId,
          "--continue-breakpoint",
          "--jsonl",
        ],
        cliIo(fixture.root, resumedStdout),
        dependencies,
      ),
    ).toBe(0);
    const resumedFrames = parseFrames(resumedStdout.text());
    expect(
      validateExecutionPlanWorkflowResultFrame(resumedFrames.at(-1)),
    ).toEqual(expect.objectContaining({ status: "completed" }));
    expect(
      resumedFrames.some(
        (frame) =>
          frame.type === "event" &&
          frame.event.type === "workflow.breakpoint.continued",
      ),
    ).toBe(true);
    expect(
      resumedFrames.some(
        (frame) =>
          frame.type === "event" && frame.event.type === "tool.completed",
      ),
    ).toBe(true);
  });

  it("streams concurrent Map item Runs through ordered JSONL", async () => {
    const fixture = await createMapFixture();
    const provider = fauxProvider({ provider: "faux-workflow-cli-map" });
    const responseForItem = (context: { messages: unknown[] }) => {
      const prompt = JSON.stringify(context.messages);
      const item = mapDocuments().find((document) =>
        prompt.includes(document.id),
      );
      if (!item) throw new Error("Unknown CLI Map item");
      return fauxAssistantMessage(
        JSON.stringify({ id: item.id, length: item.text.length }),
      );
    };
    provider.setResponses([responseForItem, responseForItem, responseForItem]);
    const stdout = new CaptureWritable();

    const code = await runCli(
      [
        "workflow",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--manifest",
        "workflow.json",
        "--input-json",
        JSON.stringify({ documents: mapDocuments() }),
        "--jsonl",
      ],
      cliIo(fixture.root, stdout),
      providerDependencies(provider),
    );

    expect(code).toBe(0);
    const frames = parseFrames(stdout.text());
    const result = validateExecutionPlanWorkflowResultFrame(frames.at(-1));
    expect(result.result.output).toEqual([
      { id: "cli_a", length: 5 },
      { id: "cli_b", length: 4 },
      { id: "cli_c", length: 5 },
    ]);
    const events = frames.filter(
      (frame): frame is Extract<StreamFrame, { type: "event" }> =>
        frame.type === "event",
    );
    expect(events.map((frame) => frame.event.seq)).toEqual(
      events.map((_, index) => index + 1),
    );
    expect(
      events.filter(
        (frame) => frame.event.type === "workflow.map.item.completed",
      ),
    ).toHaveLength(3);
  }, 20_000);

  it("streams a model-free Deterministic Workflow through ordered JSONL", async () => {
    const fixture = await createDeterministicFixture();
    const stdout = new CaptureWritable();
    const code = await runCli(
      [
        "workflow",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--manifest",
        "workflow.json",
        "--input-json",
        '{"request":"Shape through CLI JSONL."}',
        "--jsonl",
      ],
      cliIo(fixture.root, stdout),
      {
        createRuntime: (options) =>
          createLocalAgentRuntime({
            ...options,
            sandbox: new UnsupportedSandboxAdapter(
              "workflow-deterministic-cli-test",
            ),
          }),
      },
    );

    expect(code).toBe(0);
    const frames = parseFrames(stdout.text());
    const result = validateExecutionPlanWorkflowResultFrame(frames.at(-1));
    expect(result).toEqual(
      expect.objectContaining({
        status: "completed",
        result: expect.objectContaining({
          output: {
            report: "Shape through CLI JSONL.",
            approved: true,
          },
        }),
      }),
    );
    const events = frames.flatMap((frame) =>
      frame.type === "event" ? [frame.event] : [],
    );
    expect(events.some((event) => event.type === "model.response")).toBe(false);
    expect(
      events.filter(
        (event) => event.type === "workflow.deterministic.completed",
      ),
    ).toEqual([
      expect.objectContaining({
        payload: expect.not.objectContaining({ output: expect.anything() }),
      }),
    ]);
    expect(frames.at(-2)?.type).toBe("snapshot");
  });

  it("streams a typed deterministic Switch through ordered JSONL", async () => {
    const fixture = await createSwitchFixture();
    const stdout = new CaptureWritable();
    const code = await runCli(
      [
        "workflow",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--manifest",
        "workflow.json",
        "--input-json",
        JSON.stringify({
          request: "CLI Switch output",
          route: "priority",
        }),
        "--jsonl",
      ],
      cliIo(fixture.root, stdout),
      {
        createRuntime: (options) =>
          createLocalAgentRuntime({
            ...options,
            sandbox: new UnsupportedSandboxAdapter("workflow-switch-cli-test"),
          }),
      },
    );

    expect(code).toBe(0);
    const frames = parseFrames(stdout.text());
    const result = validateExecutionPlanWorkflowResultFrame(frames.at(-1));
    expect(result.result.output).toEqual({
      report: "CLI Switch output",
      approved: true,
    });
    const events = frames.flatMap((frame) =>
      frame.type === "event" ? [frame.event] : [],
    );
    const switchEvent = events.find(
      (event) => event.type === "workflow.deterministic.completed",
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
      "CLI Switch output",
    );
    expect(events.some((event) => event.type === "model.response")).toBe(false);
  });

  it("streams a deterministic Reduce Workflow through ordered JSONL", async () => {
    const fixture = await createReduceFixture();
    const stdout = new CaptureWritable();
    const code = await runCli(
      [
        "workflow",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--manifest",
        "workflow.json",
        "--input-json",
        '{"values":[2,3,4]}',
        "--jsonl",
      ],
      cliIo(fixture.root, stdout),
      {
        createRuntime: (options) =>
          createLocalAgentRuntime({
            ...options,
            sandbox: new UnsupportedSandboxAdapter("workflow-reduce-cli-test"),
          }),
      },
    );

    expect(code).toBe(0);
    const frames = parseFrames(stdout.text());
    const result = validateExecutionPlanWorkflowResultFrame(frames.at(-1));
    expect(result).toEqual(
      expect.objectContaining({
        status: "completed",
        result: expect.objectContaining({
          output: 9,
          nodeResults: [
            expect.objectContaining({
              nodeId: "total",
              status: "completed",
              output: 9,
            }),
          ],
        }),
      }),
    );
    const events = frames.flatMap((frame) =>
      frame.type === "event" ? [frame.event] : [],
    );
    expect(events.some((event) => event.type === "model.response")).toBe(false);
    expect(
      events.filter((event) => event.type === "workflow.reduce.completed"),
    ).toHaveLength(1);
    expect(
      events.some(
        (event) =>
          event.type === "tool.started" || event.type === "tool.completed",
      ),
    ).toBe(false);
    expect(events.map((event) => event.seq)).toEqual(
      events.map((_, index) => index + 1),
    );
  });

  it("streams a conditional fallback without creating a node Run", async () => {
    const fixture = await createConditionalFixture();
    const stdout = new CaptureWritable();
    const code = await runCli(
      [
        "workflow",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--manifest",
        "workflow.json",
        "--input-json",
        '{"execute":false}',
        "--jsonl",
      ],
      cliIo(fixture.root, stdout),
      {
        createRuntime: (options) =>
          createLocalAgentRuntime({
            ...options,
            sandbox: new UnsupportedSandboxAdapter(
              "workflow-conditional-cli-test",
            ),
          }),
      },
    );

    expect(code).toBe(0);
    const frames = parseFrames(stdout.text());
    const result = validateExecutionPlanWorkflowResultFrame(frames.at(-1));
    expect(result.result).toEqual(
      expect.objectContaining({
        status: "completed",
        output: { report: "CLI conditional fallback", approved: true },
        nodeResults: [
          expect.objectContaining({
            nodeId: "fallback",
            attempt: 0,
            status: "skipped",
          }),
        ],
      }),
    );
    const snapshot = frames.find((frame) => frame.type === "snapshot");
    expect(
      snapshot?.type === "snapshot" ? snapshot.detail.runs : undefined,
    ).toHaveLength(0);
    const events = frames.flatMap((frame) =>
      frame.type === "event" ? [frame.event] : [],
    );
    expect(
      events.filter((event) => event.type === "workflow.node.skipped"),
    ).toHaveLength(1);
    expect(events.some((event) => event.type === "run.started")).toBe(false);
  });

  it("streams parallel Agent nodes and their typed join through ordered JSONL", async () => {
    const fixture = await createParallelFixture();
    const provider = fauxProvider({
      provider: "faux-workflow-cli",
      tokensPerSecond: 20,
    });
    provider.setResponses([
      fauxAssistantMessage(`{"summary":"${"L".repeat(120)}","count":1}`),
      fauxAssistantMessage(`{"summary":"${"R".repeat(120)}","count":1}`),
      fauxAssistantMessage('{"report":"Parallel CLI report","approved":true}'),
    ]);
    const stdout = new CaptureWritable();
    const code = await runCli(
      [
        "workflow",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--manifest",
        "workflow.json",
        "--input-json",
        '{"request":"Run parallel CLI branches."}',
        "--jsonl",
      ],
      cliIo(fixture.root, stdout),
      providerDependencies(provider),
    );

    expect(code).toBe(0);
    const frames = parseFrames(stdout.text());
    const result = validateExecutionPlanWorkflowResultFrame(frames.at(-1));
    expect(result.result.output).toEqual({
      report: "Parallel CLI report",
      approved: true,
    });
    const events = frames.flatMap((frame) =>
      frame.type === "event" ? [frame.event] : [],
    );
    const branchStarts = events.filter(
      (event) =>
        event.type === "workflow.node.started" &&
        ["analyze_a", "analyze_b"].includes(
          String(record(event.payload)?.["nodeId"]),
        ),
    );
    const branchCompletions = events.filter(
      (event) =>
        event.type === "workflow.node.completed" &&
        ["analyze_a", "analyze_b"].includes(
          String(record(event.payload)?.["nodeId"]),
        ),
    );
    expect(branchStarts).toHaveLength(2);
    expect(branchCompletions).toHaveLength(2);
    expect(Math.max(...branchStarts.map((event) => event.seq))).toBeLessThan(
      Math.min(...branchCompletions.map((event) => event.seq)),
    );
    expect(events.map((event) => event.seq)).toEqual(
      events.map((_, index) => index + 1),
    );
  }, 20_000);

  it("answers and resumes a model-free Approval Workflow through JSONL", async () => {
    const fixture = await createApprovalFixture();
    const dependencies: RunCliDependencies = {
      createRuntime: (options) =>
        createLocalAgentRuntime({
          ...options,
          sandbox: new UnsupportedSandboxAdapter("workflow-approval-cli-test"),
        }),
    };
    const waitingStdout = new CaptureWritable();
    const waitingCode = await runCli(
      [
        "workflow",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--manifest",
        "workflow.json",
        "--input-json",
        '{"request":"Require a CLI approval."}',
        "--jsonl",
      ],
      cliIo(fixture.root, waitingStdout),
      dependencies,
    );
    expect(waitingCode).toBe(0);
    const waiting = validateExecutionPlanWorkflowResultFrame(
      parseFrames(waitingStdout.text()).at(-1),
    );
    expect(waiting).toEqual(
      expect.objectContaining({
        status: "waiting",
        result: expect.objectContaining({
          nodeResults: [
            expect.objectContaining({
              status: "waiting",
              decisionId: expect.stringMatching(/^decision_[a-z0-9]{20}$/u),
            }),
          ],
        }),
      }),
    );

    const approvedStdout = new CaptureWritable();
    const approvedCode = await runCli(
      [
        "workflow",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--manifest",
        "workflow.json",
        "--thread",
        waiting.threadId,
        "--plan",
        waiting.planId,
        "--approve",
        "--decision-note",
        "Approved from the CLI.",
        "--jsonl",
      ],
      cliIo(fixture.root, approvedStdout),
      dependencies,
    );
    expect(approvedCode).toBe(0);
    const frames = parseFrames(approvedStdout.text());
    const approved = validateExecutionPlanWorkflowResultFrame(frames.at(-1));
    expect(approved).toEqual(
      expect.objectContaining({
        status: "completed",
        result: expect.objectContaining({
          output: expect.objectContaining({
            approved: true,
            selectedOptionId: "option_1",
            customText: "Approved from the CLI.",
          }),
        }),
      }),
    );
    expect(
      frames
        .flatMap((frame) => (frame.type === "event" ? [frame.event] : []))
        .some((event) => event.type === "operator.decision.answered"),
    ).toBe(true);
  });

  it("previews and executes a checkpoint experiment through ordered JSONL", async () => {
    const fixture = await createFixture();
    const provider = fauxProvider({ provider: "faux-workflow-cli" });
    provider.setResponses([
      fauxAssistantMessage('{"summary":"Experiment source","count":1}'),
      fauxAssistantMessage('{"report":"Experiment source","approved":true}'),
    ]);
    const dependencies = providerDependencies(provider);
    const sourceStdout = new CaptureWritable();
    expect(
      await runCli(
        [
          "workflow",
          "--workspace",
          fixture.workspaceRoot,
          "--data-root",
          fixture.dataRoot,
          "--manifest",
          "workflow.json",
          "--input-json",
          '{"request":"Create an experiment source."}',
          "--jsonl",
        ],
        cliIo(fixture.root, sourceStdout),
        dependencies,
      ),
    ).toBe(0);
    const source = validateExecutionPlanWorkflowResultFrame(
      parseFrames(sourceStdout.text()).at(-1),
    );

    const simulationPreviewStdout = new CaptureWritable();
    expect(
      await runCli(
        [
          "workflow",
          "--workspace",
          fixture.workspaceRoot,
          "--data-root",
          fixture.dataRoot,
          "--manifest",
          "workflow.json",
          "--thread",
          source.threadId,
          "--plan",
          source.planId,
          "--from-node",
          "inspect",
          "--simulate-output-json",
          '{"summary":"CLI simulated inspection","count":4}',
          "--preview-experiment",
          "--jsonl",
        ],
        cliIo(fixture.root, simulationPreviewStdout),
        dependencies,
      ),
    ).toBe(0);
    const simulationPreview = JSON.parse(
      simulationPreviewStdout.text(),
    ) as ExecutionPlanWorkflowExperimentPreview;
    expect(simulationPreview).toEqual(
      expect.objectContaining({
        schemaVersion: 3,
        mode: "simulate_node",
        executionNodeIds: ["report"],
        simulatedNodeId: "inspect",
      }),
    );
    provider.setResponses([
      fauxAssistantMessage(
        '{"report":"CLI report from simulation","approved":true}',
      ),
    ]);
    const simulationStdout = new CaptureWritable();
    expect(
      await runCli(
        [
          "workflow",
          "--workspace",
          fixture.workspaceRoot,
          "--data-root",
          fixture.dataRoot,
          "--manifest",
          "workflow.json",
          "--thread",
          source.threadId,
          "--plan",
          source.planId,
          "--from-node",
          "inspect",
          "--simulate-output-json",
          '{"summary":"CLI simulated inspection","count":4}',
          "--expected-preview",
          simulationPreview.previewSha256,
          "--jsonl",
        ],
        cliIo(fixture.root, simulationStdout),
        dependencies,
      ),
    ).toBe(0);
    const simulation = validateExecutionPlanWorkflowExperimentResultFrame(
      parseFrames(simulationStdout.text()).at(-1),
    );
    expect(simulation).toEqual(
      expect.objectContaining({
        status: "completed",
        experiment: expect.objectContaining({
          preview: expect.objectContaining({ schemaVersion: 3 }),
          result: expect.objectContaining({
            output: {
              report: "CLI report from simulation",
              approved: true,
            },
          }),
          comparison: expect.objectContaining({
            nodes: expect.arrayContaining([
              expect.objectContaining({
                nodeId: "inspect",
                execution: "simulated",
              }),
            ]),
          }),
        }),
      }),
    );

    const replacementInput = JSON.stringify({
      workflow: { request: "CLI replacement workflow" },
      inspection: { summary: "CLI replacement input", count: 9 },
    });
    const replacementPreviewStdout = new CaptureWritable();
    expect(
      await runCli(
        [
          "workflow",
          "--workspace",
          fixture.workspaceRoot,
          "--data-root",
          fixture.dataRoot,
          "--manifest",
          "workflow.json",
          "--thread",
          source.threadId,
          "--plan",
          source.planId,
          "--from-node",
          "report",
          "--replace-input-json",
          replacementInput,
          "--preview-experiment",
          "--jsonl",
        ],
        cliIo(fixture.root, replacementPreviewStdout),
        dependencies,
      ),
    ).toBe(0);
    const replacementPreview = JSON.parse(
      replacementPreviewStdout.text(),
    ) as ExecutionPlanWorkflowExperimentPreview;
    expect(replacementPreview).toEqual(
      expect.objectContaining({
        schemaVersion: 4,
        mode: "replace_input",
        executionNodeIds: ["report"],
        replacedInputNodeId: "report",
      }),
    );
    provider.setResponses([
      fauxAssistantMessage(
        '{"report":"CLI report from replacement","approved":true}',
      ),
    ]);
    const replacementStdout = new CaptureWritable();
    expect(
      await runCli(
        [
          "workflow",
          "--workspace",
          fixture.workspaceRoot,
          "--data-root",
          fixture.dataRoot,
          "--manifest",
          "workflow.json",
          "--thread",
          source.threadId,
          "--plan",
          source.planId,
          "--from-node",
          "report",
          "--replace-input-json",
          replacementInput,
          "--expected-preview",
          replacementPreview.previewSha256,
          "--jsonl",
        ],
        cliIo(fixture.root, replacementStdout),
        dependencies,
      ),
    ).toBe(0);
    const replacement = validateExecutionPlanWorkflowExperimentResultFrame(
      parseFrames(replacementStdout.text()).at(-1),
    );
    expect(replacement).toEqual(
      expect.objectContaining({
        status: "completed",
        experiment: expect.objectContaining({
          result: expect.objectContaining({
            output: {
              report: "CLI report from replacement",
              approved: true,
            },
          }),
          comparison: expect.objectContaining({
            nodes: expect.arrayContaining([
              expect.objectContaining({
                nodeId: "report",
                execution: "input_replaced",
                inputChange: "changed",
              }),
            ]),
          }),
        }),
      }),
    );

    const singleNodePreviewStdout = new CaptureWritable();
    expect(
      await runCli(
        [
          "workflow",
          "--workspace",
          fixture.workspaceRoot,
          "--data-root",
          fixture.dataRoot,
          "--manifest",
          "workflow.json",
          "--thread",
          source.threadId,
          "--plan",
          source.planId,
          "--from-node",
          "inspect",
          "--single-node",
          "--preview-experiment",
          "--jsonl",
        ],
        cliIo(fixture.root, singleNodePreviewStdout),
        dependencies,
      ),
    ).toBe(0);
    const singleNodePreview = JSON.parse(
      singleNodePreviewStdout.text(),
    ) as ExecutionPlanWorkflowExperimentPreview;
    provider.setResponses([
      fauxAssistantMessage('{"summary":"CLI single node","count":1}'),
    ]);
    const singleNodeStdout = new CaptureWritable();
    expect(
      await runCli(
        [
          "workflow",
          "--workspace",
          fixture.workspaceRoot,
          "--data-root",
          fixture.dataRoot,
          "--manifest",
          "workflow.json",
          "--thread",
          source.threadId,
          "--plan",
          source.planId,
          "--from-node",
          "inspect",
          "--single-node",
          "--expected-preview",
          singleNodePreview.previewSha256,
          "--jsonl",
        ],
        cliIo(fixture.root, singleNodeStdout),
        dependencies,
      ),
    ).toBe(0);
    const singleNode = validateExecutionPlanWorkflowExperimentResultFrame(
      parseFrames(singleNodeStdout.text()).at(-1),
    );
    expect(singleNode).toEqual(
      expect.objectContaining({
        status: "paused",
        experiment: expect.objectContaining({
          preview: expect.objectContaining({
            schemaVersion: 2,
            mode: "single_node",
            executionNodeIds: ["inspect"],
            stopBeforeNodeIds: ["report"],
          }),
          result: expect.objectContaining({
            breakpoint: expect.objectContaining({ nodeId: "report" }),
          }),
        }),
      }),
    );
    provider.setResponses([
      fauxAssistantMessage(
        '{"report":"CLI continued single node","approved":true}',
      ),
    ]);
    const continuedStdout = new CaptureWritable();
    expect(
      await runCli(
        [
          "workflow",
          "--workspace",
          fixture.workspaceRoot,
          "--data-root",
          fixture.dataRoot,
          "--manifest",
          "workflow.json",
          "--thread",
          singleNode.targetThreadId,
          "--plan",
          singleNode.targetPlanId,
          "--continue-breakpoint",
          "--jsonl",
        ],
        cliIo(fixture.root, continuedStdout),
        dependencies,
      ),
    ).toBe(0);
    expect(
      validateExecutionPlanWorkflowResultFrame(
        parseFrames(continuedStdout.text()).at(-1),
      ),
    ).toEqual(
      expect.objectContaining({
        status: "completed",
        result: expect.objectContaining({
          output: {
            report: "CLI continued single node",
            approved: true,
          },
        }),
      }),
    );

    const stepPreviewStdout = new CaptureWritable();
    expect(
      await runCli(
        [
          "workflow",
          "--workspace",
          fixture.workspaceRoot,
          "--data-root",
          fixture.dataRoot,
          "--manifest",
          "workflow.json",
          "--thread",
          source.threadId,
          "--plan",
          source.planId,
          "--from-node",
          "inspect",
          "--step-nodes",
          "--preview-experiment",
          "--jsonl",
        ],
        cliIo(fixture.root, stepPreviewStdout),
        dependencies,
      ),
    ).toBe(0);
    const stepPreview = JSON.parse(
      stepPreviewStdout.text(),
    ) as ExecutionPlanWorkflowExperimentPreview;
    provider.setResponses([
      fauxAssistantMessage('{"summary":"CLI step inspect","count":1}'),
    ]);
    const stepStdout = new CaptureWritable();
    expect(
      await runCli(
        [
          "workflow",
          "--workspace",
          fixture.workspaceRoot,
          "--data-root",
          fixture.dataRoot,
          "--manifest",
          "workflow.json",
          "--thread",
          source.threadId,
          "--plan",
          source.planId,
          "--from-node",
          "inspect",
          "--step-nodes",
          "--expected-preview",
          stepPreview.previewSha256,
          "--jsonl",
        ],
        cliIo(fixture.root, stepStdout),
        dependencies,
      ),
    ).toBe(0);
    const stepped = validateExecutionPlanWorkflowExperimentResultFrame(
      parseFrames(stepStdout.text()).at(-1),
    );
    expect(stepped).toEqual(
      expect.objectContaining({
        status: "paused",
        experiment: expect.objectContaining({
          preview: expect.objectContaining({
            schemaVersion: 5,
            mode: "step_nodes",
            executionNodeIds: ["inspect"],
            stopBeforeNodeIds: ["report"],
          }),
          result: expect.objectContaining({
            breakpoint: expect.objectContaining({ nodeId: "report" }),
          }),
        }),
      }),
    );
    provider.setResponses([
      fauxAssistantMessage(
        '{"report":"CLI continued step control","approved":true}',
      ),
    ]);
    const steppedContinueStdout = new CaptureWritable();
    expect(
      await runCli(
        [
          "workflow",
          "--workspace",
          fixture.workspaceRoot,
          "--data-root",
          fixture.dataRoot,
          "--manifest",
          "workflow.json",
          "--thread",
          stepped.targetThreadId,
          "--plan",
          stepped.targetPlanId,
          "--continue-breakpoint",
          "--jsonl",
        ],
        cliIo(fixture.root, steppedContinueStdout),
        dependencies,
      ),
    ).toBe(0);
    expect(
      validateExecutionPlanWorkflowResultFrame(
        parseFrames(steppedContinueStdout.text()).at(-1),
      ),
    ).toEqual(
      expect.objectContaining({
        status: "completed",
        result: expect.objectContaining({
          output: {
            report: "CLI continued step control",
            approved: true,
          },
        }),
      }),
    );

    const previewStdout = new CaptureWritable();
    expect(
      await runCli(
        [
          "workflow",
          "--workspace",
          fixture.workspaceRoot,
          "--data-root",
          fixture.dataRoot,
          "--manifest",
          "workflow.json",
          "--thread",
          source.threadId,
          "--plan",
          source.planId,
          "--from-node",
          "report",
          "--preview-experiment",
          "--jsonl",
        ],
        cliIo(fixture.root, previewStdout),
        dependencies,
      ),
    ).toBe(0);
    expect(JSON.parse(previewStdout.text()) as unknown).toEqual(
      expect.objectContaining({
        kind: "napier.execution-plan-workflow-experiment-preview",
        reusedNodeIds: ["inspect"],
        rerunNodeIds: ["report"],
      }),
    );

    provider.setResponses([
      fauxAssistantMessage('{"report":"CLI experiment","approved":true}'),
    ]);
    const experimentStdout = new CaptureWritable();
    expect(
      await runCli(
        [
          "workflow",
          "--workspace",
          fixture.workspaceRoot,
          "--data-root",
          fixture.dataRoot,
          "--manifest",
          "workflow.json",
          "--thread",
          source.threadId,
          "--plan",
          source.planId,
          "--from-node",
          "report",
          "--model-overrides-json",
          '{"report":{"provider":"faux-workflow-cli","id":"faux-1"}}',
          "--jsonl",
        ],
        cliIo(fixture.root, experimentStdout),
        dependencies,
      ),
    ).toBe(0);
    const frames = parseFrames(experimentStdout.text());
    const experiment = validateExecutionPlanWorkflowExperimentResultFrame(
      frames.at(-1),
    );
    expect(experiment).toEqual(
      expect.objectContaining({
        type: "workflow_experiment_result",
        sourceThreadId: source.threadId,
        status: "completed",
        experiment: expect.objectContaining({
          comparison: expect.objectContaining({
            inputChange: "unchanged",
            outputChange: "changed",
            changedNodeIds: ["report"],
          }),
          result: expect.objectContaining({
            output: { report: "CLI experiment", approved: true },
          }),
        }),
      }),
    );
    expect(experiment.targetThreadId).not.toBe(source.threadId);

    provider.setResponses([
      fauxAssistantMessage('{"report":"Human experiment","approved":true}'),
    ]);
    const humanStdout = new CaptureWritable();
    const humanStderr = new CaptureWritable();
    expect(
      await runCli(
        [
          "workflow",
          "--workspace",
          fixture.workspaceRoot,
          "--data-root",
          fixture.dataRoot,
          "--manifest",
          "workflow.json",
          "--thread",
          source.threadId,
          "--plan",
          source.planId,
          "--from-node",
          "report",
        ],
        cliIo(fixture.root, humanStdout, humanStderr),
        dependencies,
      ),
    ).toBe(0);
    expect(JSON.parse(humanStdout.text()) as unknown).toEqual({
      report: "Human experiment",
      approved: true,
    });
    expect(humanStderr.text()).toContain("Delta (target-source):");
  }, 20_000);

  it("returns blocked evidence and requires explicit retry for a failed node", async () => {
    const fixture = await createFixture();
    const provider = fauxProvider({ provider: "faux-workflow-cli" });
    provider.setResponses([fauxAssistantMessage("not json")]);
    const dependencies = providerDependencies(provider);
    const firstStdout = new CaptureWritable();
    const firstCode = await runCli(
      [
        "workflow",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--manifest",
        "workflow.json",
        "--input-json",
        '{"request":"Retry this report."}',
        "--jsonl",
      ],
      cliIo(fixture.root, firstStdout),
      dependencies,
    );
    expect(firstCode).toBe(1);
    const blockedFrame = validateExecutionPlanWorkflowResultFrame(
      parseFrames(firstStdout.text()).at(-1),
    );
    expect(blockedFrame.status).toBe("blocked");

    provider.setResponses([
      fauxAssistantMessage('{"summary":"Retried","count":1}'),
      fauxAssistantMessage('{"report":"Retried report","approved":true}'),
    ]);
    const retryStdout = new CaptureWritable();
    const retryCode = await runCli(
      [
        "workflow",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--manifest",
        "workflow.json",
        "--thread",
        blockedFrame.threadId,
        "--plan",
        blockedFrame.planId,
        "--retry-blocked",
        "--jsonl",
      ],
      cliIo(fixture.root, retryStdout),
      dependencies,
    );
    expect(retryCode).toBe(0);
    expect(
      validateExecutionPlanWorkflowResultFrame(
        parseFrames(retryStdout.text()).at(-1),
      ),
    ).toEqual(expect.objectContaining({ status: "completed" }));
  }, 20_000);

  it("rejects an escaping Manifest path before Runtime bootstrap", async () => {
    const fixture = await createFixture();
    let bootstraps = 0;
    const stdout = new CaptureWritable();
    const code = await runCli(
      [
        "workflow",
        "--workspace",
        fixture.workspaceRoot,
        "--manifest",
        "../workflow.json",
        "--input-json",
        "{}",
        "--jsonl",
      ],
      cliIo(fixture.root, stdout),
      {
        async createRuntime() {
          bootstraps += 1;
          throw new Error("must not bootstrap");
        },
      },
    );
    expect(code).toBe(1);
    expect(bootstraps).toBe(0);
    expect(parseFrames(stdout.text())).toEqual([
      expect.objectContaining({
        type: "error",
        threadId: "thread_cli_workflow_preflight",
      }),
    ]);
  });

  it("validates typed input before Runtime bootstrap or Thread creation", async () => {
    const fixture = await createFixture();
    let bootstraps = 0;
    const stdout = new CaptureWritable();
    const code = await runCli(
      [
        "workflow",
        "--workspace",
        fixture.workspaceRoot,
        "--manifest",
        "workflow.json",
        "--input-json",
        "{}",
        "--jsonl",
      ],
      cliIo(fixture.root, stdout),
      {
        async createRuntime() {
          bootstraps += 1;
          throw new Error("must not bootstrap");
        },
      },
    );

    expect(code).toBe(1);
    expect(bootstraps).toBe(0);
    expect(parseFrames(stdout.text())).toEqual([
      expect.objectContaining({
        type: "error",
        threadId: "thread_cli_workflow_preflight",
      }),
    ]);
  });
});

async function createFixture(): Promise<{
  root: string;
  workspaceRoot: string;
  dataRoot: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-workflow-cli-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot, { recursive: true });
  const services = await createLocalAgentRuntime({
    workspaceRoot,
    dataRoot,
    sandbox: new UnsupportedSandboxAdapter("workflow-cli-setup"),
  });
  const sourceThread = services.store.listThreads()[0]!;
  const sourcePlan = await services.store.createPlan(sourceThread.id, {
    objective: "Create a typed CLI report.",
    steps: [
      {
        id: "inspect",
        title: "Inspect",
        description: "Inspect the CLI Workflow input.",
        verification: "Return typed inspection JSON.",
      },
      {
        id: "report",
        title: "Report",
        description: "Produce the typed CLI report.",
        verification: "Return typed report JSON.",
        dependsOn: ["inspect"],
      },
    ],
  });
  const blueprint = await createExecutionPlanBlueprint(
    services.store,
    sourceThread.id,
    sourcePlan.id,
  );
  const manifest = defineExecutionPlanWorkflow({
    name: "CLI report",
    version: 1,
    description: "Execute a typed report through the CLI.",
    blueprint,
    inputSchema: requestSchema(),
    outputSchema: reportSchema(),
    outputNodeId: "report",
    nodes: [
      {
        id: "inspect",
        type: "agent",
        inputBindings: { workflow: { source: "workflow" } },
        inputSchema: {
          type: "object",
          properties: { workflow: requestSchema() },
          required: ["workflow"],
          additionalProperties: false,
        },
        outputSchema: inspectionSchema(),
        model: { provider: "faux-workflow-cli", id: "faux-1" },
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
      {
        id: "report",
        type: "agent",
        inputBindings: {
          workflow: { source: "workflow" },
          inspection: { source: "node", nodeId: "inspect" },
        },
        inputSchema: {
          type: "object",
          properties: {
            workflow: requestSchema(),
            inspection: inspectionSchema(),
          },
          required: ["workflow", "inspection"],
          additionalProperties: false,
        },
        outputSchema: reportSchema(),
        model: { provider: "faux-workflow-cli", id: "faux-1" },
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
    ],
  });
  await writeFile(
    path.join(workspaceRoot, "workflow.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await services.shutdown();
  return { root, workspaceRoot, dataRoot };
}

async function createConditionalFixture(): Promise<{
  root: string;
  workspaceRoot: string;
  dataRoot: string;
}> {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-conditional-workflow-cli-"),
  );
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot, { recursive: true });
  const services = await createLocalAgentRuntime({
    workspaceRoot,
    dataRoot,
    sandbox: new UnsupportedSandboxAdapter("workflow-conditional-cli-setup"),
  });
  const sourceThread = services.store.listThreads()[0]!;
  const sourcePlan = await services.store.createPlan(sourceThread.id, {
    objective: "Return one conditional CLI fallback.",
    steps: [
      {
        id: "fallback",
        title: "Conditional fallback",
        description: "Execute only when requested.",
        verification: "Return a typed report in both branches.",
      },
    ],
  });
  const blueprint = await createExecutionPlanBlueprint(
    services.store,
    sourceThread.id,
    sourcePlan.id,
  );
  const inputSchema = conditionalInputSchema();
  const manifest = defineExecutionPlanWorkflow({
    name: "CLI conditional fallback",
    version: 1,
    description: "Exercise model-free conditional control through JSONL.",
    blueprint,
    inputSchema,
    outputSchema: reportSchema(),
    outputNodeId: "fallback",
    nodes: [
      {
        id: "fallback",
        type: "agent",
        inputBindings: { workflow: { source: "workflow" } },
        inputSchema: {
          type: "object",
          properties: { workflow: inputSchema },
          required: ["workflow"],
          additionalProperties: false,
        },
        outputSchema: reportSchema(),
        when: { path: ["workflow", "execute"], equals: true },
        skipOutput: {
          report: "CLI conditional fallback",
          approved: true,
        },
        model: { provider: "missing-conditional", id: "missing-1" },
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
    ],
  });
  await writeFile(
    path.join(workspaceRoot, "workflow.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await services.shutdown();
  return { root, workspaceRoot, dataRoot };
}

async function createToolFixture(): Promise<{
  root: string;
  workspaceRoot: string;
  dataRoot: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-tool-workflow-cli-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot, { recursive: true });
  const services = await createLocalAgentRuntime({
    workspaceRoot,
    dataRoot,
    sandbox: new UnsupportedSandboxAdapter("workflow-tool-cli-setup"),
  });
  const sourceThread = services.store.listThreads()[0]!;
  const sourcePlan = await services.store.createPlan(sourceThread.id, {
    objective: "Inventory the CLI workspace.",
    steps: [
      {
        id: "inventory",
        title: "Inventory",
        description: "List the workspace root.",
        verification: "Return a typed list-files receipt.",
      },
    ],
    artifacts: [
      {
        id: "workflow-manifest",
        path: "workflow.json",
        kind: "file",
        description: "The exact Workflow Manifest consumed by the CLI.",
      },
    ],
  });
  const blueprint = await createExecutionPlanBlueprint(
    services.store,
    sourceThread.id,
    sourcePlan.id,
  );
  const outputSchema = listFilesReceiptSchema();
  const manifest = defineExecutionPlanWorkflow({
    name: "CLI Tool inventory",
    version: 1,
    description: "Execute a model-free Tool node through CLI JSONL.",
    blueprint,
    inputSchema: requestSchema(),
    outputSchema,
    outputNodeId: "inventory",
    nodes: [
      {
        id: "inventory",
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
        outputSchema,
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
    ],
  });
  await writeFile(
    path.join(workspaceRoot, "workflow.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await services.shutdown();
  return { root, workspaceRoot, dataRoot };
}

async function createParallelFixture(): Promise<{
  root: string;
  workspaceRoot: string;
  dataRoot: string;
}> {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-parallel-workflow-cli-"),
  );
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot, { recursive: true });
  const services = await createLocalAgentRuntime({
    workspaceRoot,
    dataRoot,
    sandbox: new UnsupportedSandboxAdapter("workflow-parallel-cli-setup"),
  });
  const sourceThread = services.store.listThreads()[0]!;
  const sourcePlan = await services.store.createPlan(sourceThread.id, {
    objective: "Run two CLI analyses and join one report.",
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
        title: "Report",
        description: "Join both analyses.",
        verification: "Return one typed report.",
        dependsOn: ["analyze_a", "analyze_b"],
      },
    ],
  });
  const blueprint = await createExecutionPlanBlueprint(
    services.store,
    sourceThread.id,
    sourcePlan.id,
  );
  const branchNode = (id: "analyze_a" | "analyze_b") => ({
    id,
    type: "agent" as const,
    inputBindings: { workflow: { source: "workflow" as const } },
    inputSchema: {
      type: "object" as const,
      properties: { workflow: requestSchema() },
      required: ["workflow"],
      additionalProperties: false as const,
    },
    outputSchema: inspectionSchema(),
    model: { provider: "faux-workflow-cli", id: "faux-1" },
    timeoutMs: 5_000,
    maxAttempts: 2,
  });
  const manifest = defineExecutionPlanWorkflow({
    name: "CLI parallel report",
    version: 1,
    description: "Execute two Agent nodes concurrently through CLI JSONL.",
    blueprint,
    inputSchema: requestSchema(),
    outputSchema: reportSchema(),
    outputNodeId: "report",
    maxConcurrency: 2,
    nodes: [
      branchNode("analyze_a"),
      branchNode("analyze_b"),
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
        model: { provider: "faux-workflow-cli", id: "faux-1" },
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
    ],
  });
  await writeFile(
    path.join(workspaceRoot, "workflow.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await services.shutdown();
  return { root, workspaceRoot, dataRoot };
}

async function createMapFixture(): Promise<{
  root: string;
  workspaceRoot: string;
  dataRoot: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-map-workflow-cli-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot, { recursive: true });
  const services = await createLocalAgentRuntime({
    workspaceRoot,
    dataRoot,
    sandbox: new UnsupportedSandboxAdapter("workflow-map-cli-setup"),
  });
  const sourceThread = services.store.listThreads()[0]!;
  const sourcePlan = await services.store.createPlan(sourceThread.id, {
    objective: "Map a bounded CLI document collection.",
    steps: [
      {
        id: "analyze",
        title: "Analyze documents",
        description: "Return the ID and length for the current document.",
        verification: "Every input document has one typed output.",
      },
    ],
  });
  const blueprint = await createExecutionPlanBlueprint(
    services.store,
    sourceThread.id,
    sourcePlan.id,
  );
  const documentSchema = {
    type: "object" as const,
    properties: {
      id: { type: "string" as const, minLength: 1, maxLength: 20 },
      text: { type: "string" as const, minLength: 1, maxLength: 100 },
    },
    required: ["id", "text"],
    additionalProperties: false as const,
  };
  const inputSchema = {
    type: "object" as const,
    properties: {
      documents: {
        type: "array" as const,
        items: documentSchema,
        minItems: 0,
        maxItems: 3,
      },
    },
    required: ["documents"],
    additionalProperties: false as const,
  };
  const outputSchema = {
    type: "array" as const,
    items: {
      type: "object" as const,
      properties: {
        id: { type: "string" as const, minLength: 1, maxLength: 20 },
        length: { type: "integer" as const, minimum: 0, maximum: 100 },
      },
      required: ["id", "length"],
      additionalProperties: false as const,
    },
    minItems: 0,
    maxItems: 3,
  };
  const manifest = defineExecutionPlanWorkflow({
    name: "CLI bounded Map",
    version: 1,
    description: "Execute read-only Agent items through CLI JSONL.",
    blueprint,
    inputSchema,
    outputSchema,
    outputNodeId: "analyze",
    maxConcurrency: 4,
    nodes: [
      {
        id: "analyze",
        type: "map",
        inputBindings: {
          documents: {
            source: "workflow",
            path: ["documents"],
          },
        },
        inputSchema,
        outputSchema,
        itemsPath: ["documents"],
        model: { provider: "faux-workflow-cli-map", id: "faux-1" },
        maxConcurrency: 3,
        itemTimeoutMs: 5_000,
        timeoutMs: 15_000,
        maxAttempts: 2,
      },
    ],
  });
  await writeFile(
    path.join(workspaceRoot, "workflow.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await services.shutdown();
  return { root, workspaceRoot, dataRoot };
}

function mapDocuments() {
  return [
    { id: "cli_a", text: "alpha" },
    { id: "cli_b", text: "beta" },
    { id: "cli_c", text: "gamma" },
  ];
}

async function createDeterministicFixture(): Promise<{
  root: string;
  workspaceRoot: string;
  dataRoot: string;
}> {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-deterministic-workflow-cli-"),
  );
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot, { recursive: true });
  const services = await createLocalAgentRuntime({
    workspaceRoot,
    dataRoot,
    sandbox: new UnsupportedSandboxAdapter("workflow-deterministic-cli-setup"),
  });
  const sourceThread = services.store.listThreads()[0]!;
  const sourcePlan = await services.store.createPlan(sourceThread.id, {
    objective: "Shape one typed CLI result without a model.",
    steps: [
      {
        id: "report",
        title: "Report",
        description: "Shape the Workflow input into a typed result.",
        verification: "Return the deterministic report.",
      },
    ],
  });
  const blueprint = await createExecutionPlanBlueprint(
    services.store,
    sourceThread.id,
    sourcePlan.id,
  );
  const manifest = defineExecutionPlanWorkflow({
    name: "CLI Deterministic report",
    version: 1,
    description: "Execute a model-free Deterministic node through CLI JSONL.",
    blueprint,
    inputSchema: requestSchema(),
    outputSchema: reportSchema(),
    outputNodeId: "report",
    nodes: [
      {
        id: "report",
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
        outputSchema: reportSchema(),
        template: {
          kind: "object",
          properties: {
            report: {
              kind: "input",
              path: ["workflow", "request"],
            },
            approved: { kind: "literal", value: true },
          },
        },
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
    ],
  });
  await writeFile(
    path.join(workspaceRoot, "workflow.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await services.shutdown();
  return { root, workspaceRoot, dataRoot };
}

async function createSwitchFixture(): Promise<{
  root: string;
  workspaceRoot: string;
  dataRoot: string;
}> {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-switch-workflow-cli-"),
  );
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot, { recursive: true });
  const services = await createLocalAgentRuntime({
    workspaceRoot,
    dataRoot,
    sandbox: new UnsupportedSandboxAdapter("workflow-switch-cli-setup"),
  });
  const sourceThread = services.store.listThreads()[0]!;
  const sourcePlan = await services.store.createPlan(sourceThread.id, {
    objective: "Route one typed CLI result without a model.",
    steps: [
      {
        id: "report",
        title: "Route report",
        description: "Select one typed deterministic branch.",
        verification: "Return the selected deterministic report.",
      },
    ],
  });
  const blueprint = await createExecutionPlanBlueprint(
    services.store,
    sourceThread.id,
    sourcePlan.id,
  );
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
  const manifest = defineExecutionPlanWorkflow({
    name: "CLI Deterministic Switch",
    version: 1,
    description: "Execute a typed multi-way Switch through CLI JSONL.",
    blueprint,
    inputSchema,
    outputSchema: reportSchema(),
    outputNodeId: "report",
    nodes: [
      {
        id: "report",
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
        outputSchema: reportSchema(),
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
                  report: {
                    kind: "input",
                    path: ["workflow", "request"],
                  },
                  approved: { kind: "literal", value: true },
                },
              },
            },
            {
              id: "audit_path",
              equals: "audit",
              then: {
                kind: "literal",
                value: { report: "CLI audit route", approved: true },
              },
            },
          ],
          default: {
            kind: "literal",
            value: { report: "CLI default route", approved: false },
          },
        },
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
    ],
  });
  await writeFile(
    path.join(workspaceRoot, "workflow.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await services.shutdown();
  return { root, workspaceRoot, dataRoot };
}

async function createReduceFixture(): Promise<{
  root: string;
  workspaceRoot: string;
  dataRoot: string;
}> {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-reduce-workflow-cli-"),
  );
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot, { recursive: true });
  const services = await createLocalAgentRuntime({
    workspaceRoot,
    dataRoot,
    sandbox: new UnsupportedSandboxAdapter("workflow-reduce-cli-setup"),
  });
  const sourceThread = services.store.listThreads()[0]!;
  const sourcePlan = await services.store.createPlan(sourceThread.id, {
    objective: "Sum one typed CLI collection without a model.",
    steps: [
      {
        id: "total",
        title: "Total values",
        description: "Sum every typed integer.",
        verification: "Return the exact deterministic sum.",
      },
    ],
  });
  const blueprint = await createExecutionPlanBlueprint(
    services.store,
    sourceThread.id,
    sourcePlan.id,
  );
  const valuesSchema = {
    type: "array" as const,
    items: { type: "integer" as const },
    minItems: 0,
    maxItems: 16,
  };
  const inputSchema = {
    type: "object" as const,
    properties: { values: valuesSchema },
    required: ["values"],
    additionalProperties: false as const,
  };
  const manifest = defineExecutionPlanWorkflow({
    name: "CLI deterministic Reduce",
    version: 1,
    description: "Execute a model-free Reduce node through CLI JSONL.",
    blueprint,
    inputSchema,
    outputSchema: { type: "integer" },
    outputNodeId: "total",
    nodes: [
      {
        id: "total",
        type: "reduce",
        inputBindings: {
          values: { source: "workflow", path: ["values"] },
        },
        inputSchema,
        outputSchema: { type: "integer" },
        itemsPath: ["values"],
        operation: "sum",
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
    ],
  });
  await writeFile(
    path.join(workspaceRoot, "workflow.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await services.shutdown();
  return { root, workspaceRoot, dataRoot };
}

async function createApprovalFixture(): Promise<{
  root: string;
  workspaceRoot: string;
  dataRoot: string;
}> {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-approval-workflow-cli-"),
  );
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot, { recursive: true });
  const services = await createLocalAgentRuntime({
    workspaceRoot,
    dataRoot,
    sandbox: new UnsupportedSandboxAdapter("workflow-approval-cli-setup"),
  });
  const sourceThread = services.store.listThreads()[0]!;
  const sourcePlan = await services.store.createPlan(sourceThread.id, {
    objective: "Approve one CLI delivery.",
    steps: [
      {
        id: "approval",
        title: "Approval",
        description: "Wait for an explicit operator approval.",
        verification: "Return the bound approval receipt.",
      },
    ],
  });
  const blueprint = await createExecutionPlanBlueprint(
    services.store,
    sourceThread.id,
    sourcePlan.id,
  );
  const outputSchema = structuredClone(
    EXECUTION_PLAN_WORKFLOW_APPROVAL_OUTPUT_SCHEMA,
  );
  const manifest = defineExecutionPlanWorkflow({
    name: "CLI Approval",
    version: 1,
    description: "Pause and resume one model-free Approval node.",
    blueprint,
    inputSchema: requestSchema(),
    outputSchema,
    outputNodeId: "approval",
    nodes: [
      {
        id: "approval",
        type: "approval",
        header: "Release",
        question: "Approve this CLI Workflow delivery?",
        approve: {
          label: "Approve",
          description: "Complete the typed Workflow.",
        },
        reject: {
          label: "Reject",
          description: "Block the typed Workflow.",
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
        outputSchema,
        timeoutMs: 60_000,
        maxAttempts: 2,
      },
    ],
  });
  await writeFile(
    path.join(workspaceRoot, "workflow.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await services.shutdown();
  return { root, workspaceRoot, dataRoot };
}

function providerDependencies(
  provider: ReturnType<typeof fauxProvider>,
): RunCliDependencies {
  return {
    async createRuntime(options: LocalAgentRuntimeOptions) {
      const services = await createLocalAgentRuntime({
        ...options,
        sandbox: new UnsupportedSandboxAdapter("workflow-cli-test"),
      });
      services.models.registerProvider(provider.provider);
      return services;
    },
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

function conditionalInputSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      execute: { type: "boolean" },
    },
    required: ["execute"],
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

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseFrames(
  value: string,
): Array<
  | StreamFrame
  | ExecutionPlanWorkflowResultFrame
  | ExecutionPlanWorkflowExperimentResultFrame
> {
  return value
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(
      (line) =>
        JSON.parse(line) as
          | StreamFrame
          | ExecutionPlanWorkflowResultFrame
          | ExecutionPlanWorkflowExperimentResultFrame,
    );
}

function cliIo(
  root: string,
  stdout: Writable,
  stderr: Writable = new CaptureWritable(),
): CliIo {
  return {
    cwd: root,
    env: {},
    stdout,
    stderr,
  };
}

class CaptureWritable extends Writable {
  private readonly chunks: Buffer[] = [];

  _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }

  text(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}
