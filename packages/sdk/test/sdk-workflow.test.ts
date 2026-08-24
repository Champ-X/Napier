import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  exportThreadReplayBundle,
  UnsupportedSandboxAdapter,
  verifyThreadReplayBundle,
} from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { createNapierClient, loadNapierWorkflow } from "../src/index.js";
import {
  blockedWorkflowDefinition,
  createFixture,
  directSandbox,
  draftWorkflowDefinition,
  javascriptWorkflowDefinition,
  mapWorkflowDefinition,
  openStore,
  pythonWorkflowDefinition,
  reduceWorkflowDefinition,
  sdkWorkflowTemporaryRoots,
  switchWorkflowDefinition,
} from "./sdk-workflow-fixtures.js";

const execFileAsync = promisify(execFile);

type DraftRequest = {
  text: string;
  publish: boolean;
};

type DraftReport = {
  message: string;
};

type MapRequest = {
  items: string[];
};

type MapReport = Array<{
  item: string;
}>;

type ReduceRequest = {
  values: number[];
};

type ReduceReport = number;

type SwitchRequest = {
  route: "priority" | "audit" | "other";
  text: string;
};

type SwitchReport = {
  message: string;
};

type JavascriptRequest = {
  values: number[];
};

type JavascriptReport = {
  total: number;
};

type PythonRequest = {
  values: number[];
};

type PythonReport = {
  total: number;
};

afterEach(async () => {
  await Promise.all(
    sdkWorkflowTemporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Napier TypeScript SDK Workflows", () => {
  it("defines, serializes, executes, and resumes through one local Ledger", async () => {
    const fixture = await createFixture("execute");
    const client = await createNapierClient({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      sandbox: new UnsupportedSandboxAdapter("sdk-workflow-test"),
    });
    const defined = await client.defineWorkflow<DraftRequest, DraftReport>(
      draftWorkflowDefinition(),
    );
    const workflow = loadNapierWorkflow<DraftRequest, DraftReport>(
      JSON.parse(JSON.stringify(defined.manifest)),
    );
    const tampered = structuredClone(defined.manifest);
    tampered.nodes[0]!.timeoutMs += 1;
    expect(() =>
      loadNapierWorkflow<DraftRequest, DraftReport>(tampered),
    ).toThrow("content hash mismatch");
    const eventTypes: string[] = [];
    const execution = await client.runWorkflow({
      workflow,
      input: { text: "SDK evidence", publish: false },
      onEvent: (event) => {
        eventTypes.push(event.type);
      },
    });

    expect(execution).toEqual(
      expect.objectContaining({
        status: "completed",
        output: { message: "Draft retained by SDK Workflow" },
      }),
    );
    expect(execution.result.nodeResults).toEqual([
      expect.objectContaining({
        nodeId: "normalize",
        attempt: 1,
        status: "completed",
        runId: expect.stringMatching(/^run_[a-z0-9]{20}$/u),
      }),
      expect.objectContaining({
        nodeId: "publish",
        attempt: 0,
        status: "skipped",
      }),
    ]);
    expect(execution.result.nodeResults[1]).not.toHaveProperty("runId");
    expect(eventTypes).toEqual(
      expect.arrayContaining([
        "workflow.started",
        "workflow.node.started",
        "workflow.node.completed",
        "workflow.node.skipped",
        "workflow.completed",
      ]),
    );

    const resumed = await client.resumeWorkflow({
      workflow,
      threadId: execution.threadId,
      planId: execution.planId,
    });
    expect(resumed.result.resumed).toBe(true);
    expect(resumed.output).toEqual(execution.output);
    await client.close();
    await client.close();
    await expect(
      client.runWorkflow({
        workflow,
        input: { text: "Closed client", publish: true },
      }),
    ).rejects.toThrow("client is closed");

    const store = await openStore(fixture);
    expect(store.listRuns(execution.threadId)).toHaveLength(1);
    const events = await store.listEvents(execution.threadId);
    expect(
      events.filter((event) => event.type === "workflow.node.skipped"),
    ).toHaveLength(1);
    expect(
      verifyThreadReplayBundle(
        await exportThreadReplayBundle(store, execution.threadId),
      ).status,
    ).toBe("valid");
    store.close();
  });

  it("requires explicit SDK continuation for a persisted breakpoint", async () => {
    const fixture = await createFixture("breakpoint");
    const client = await createNapierClient({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      sandbox: new UnsupportedSandboxAdapter("sdk-workflow-breakpoint"),
    });
    const workflow = await client.defineWorkflow<DraftRequest, DraftReport>(
      draftWorkflowDefinition(),
    );
    const paused = await client.runWorkflow({
      workflow,
      input: { text: "SDK breakpoint output", publish: true },
      breakBeforeNodeIds: ["publish"],
    });

    expect(paused).toEqual(
      expect.objectContaining({
        status: "paused",
        breakpoint: expect.objectContaining({ nodeId: "publish" }),
        result: expect.objectContaining({
          nodeResults: [
            expect.objectContaining({
              nodeId: "normalize",
              status: "completed",
            }),
          ],
        }),
      }),
    );
    const repeated = await client.resumeWorkflow({
      workflow,
      threadId: paused.threadId,
      planId: paused.planId,
    });
    expect(repeated.status).toBe("paused");
    const completed = await client.resumeWorkflow({
      workflow,
      threadId: paused.threadId,
      planId: paused.planId,
      continueBreakpoint: true,
    });
    expect(completed).toEqual(
      expect.objectContaining({
        status: "completed",
        output: { message: "SDK breakpoint output" },
      }),
    );
    await client.close();
  });

  it("rejects invalid definitions, inputs, and cancellation before mutation", async () => {
    const fixture = await createFixture("preflight");
    const client = await createNapierClient({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      sandbox: new UnsupportedSandboxAdapter("sdk-preflight-test"),
    });
    const invalid = draftWorkflowDefinition();
    invalid.nodes[1] = {
      ...invalid.nodes[1]!,
      when: { path: ["workflow", "constructor"], equals: true },
    };
    await expect(
      client.defineWorkflow<DraftRequest, DraftReport>(invalid),
    ).rejects.toThrow("path segment is invalid");

    const workflow = await client.defineWorkflow<DraftRequest, DraftReport>(
      draftWorkflowDefinition(),
    );
    await expect(
      client.runWorkflow({
        workflow,
        input: { text: "", publish: true },
      }),
    ).rejects.toThrow("does not match its schema");
    const controller = new AbortController();
    controller.abort();
    await expect(
      client.runWorkflow({
        workflow,
        input: { text: "Do not persist", publish: true },
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    await client.close();

    const store = await openStore(fixture);
    const threads = store.listThreads();
    expect(threads).toHaveLength(2);
    expect(
      threads.flatMap((thread) => store.listPlans(thread.id)),
    ).toHaveLength(1);
    expect(store.listRuns(workflow.sourceThreadId)).toHaveLength(0);
    store.close();
  });

  it("keeps concurrent executions isolated and retries a blocked node explicitly", async () => {
    const fixture = await createFixture("isolation");
    const client = await createNapierClient({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      sandbox: new UnsupportedSandboxAdapter("sdk-isolation-test"),
    });
    const workflow = await client.defineWorkflow<DraftRequest, DraftReport>(
      draftWorkflowDefinition(),
    );
    const [left, right] = await Promise.all([
      client.runWorkflow({
        workflow,
        input: { text: "Left SDK run", publish: true },
      }),
      client.runWorkflow({
        workflow,
        input: { text: "Right SDK run", publish: true },
      }),
    ]);
    expect(left.threadId).not.toBe(right.threadId);
    expect(left.output).toEqual({ message: "Left SDK run" });
    expect(right.output).toEqual({ message: "Right SDK run" });

    const blockedWorkflow = await client.defineWorkflow<
      DraftRequest,
      DraftReport
    >(blockedWorkflowDefinition());
    const blocked = await client.runWorkflow({
      workflow: blockedWorkflow,
      input: { text: "Retry missing provider", publish: true },
    });
    expect(blocked.result.nodeResults).toEqual([
      expect.objectContaining({
        nodeId: "publish",
        attempt: 1,
        status: "blocked",
      }),
    ]);
    const retried = await client.resumeWorkflow({
      workflow: blockedWorkflow,
      threadId: blocked.threadId,
      planId: blocked.planId,
      retryBlocked: true,
    });
    expect(retried.result.nodeResults).toEqual([
      expect.objectContaining({
        nodeId: "publish",
        attempt: 2,
        status: "blocked",
      }),
    ]);
    await client.close();

    const store = await openStore(fixture);
    expect(store.listRuns(blocked.threadId)).toHaveLength(2);
    expect(
      (await store.listEvents(blocked.threadId)).filter(
        (event) => event.type === "workflow.node.failed",
      ),
    ).toHaveLength(2);
    store.close();
  });

  it("aborts and settles an active Workflow before closing shared services", async () => {
    const fixture = await createFixture("active-close");
    const client = await createNapierClient({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      sandbox: new UnsupportedSandboxAdapter("sdk-active-close-test"),
    });
    const workflow = await client.defineWorkflow<DraftRequest, DraftReport>(
      draftWorkflowDefinition(),
    );
    let releaseStarted!: () => void;
    const startedGate = new Promise<void>((resolve) => {
      releaseStarted = resolve;
    });
    let releaseCallback!: () => void;
    const callbackGate = new Promise<void>((resolve) => {
      releaseCallback = resolve;
    });
    const executionPromise = client.runWorkflow({
      workflow,
      input: { text: "Cancel before close", publish: true },
      onEvent: async (event) => {
        if (event.type === "workflow.node.started") {
          releaseStarted();
          await callbackGate;
        }
      },
    });
    await startedGate;
    const closing = client.close();
    releaseCallback();
    const execution = await executionPromise;
    expect(execution.status).toBe("cancelled");
    await closing;

    const store = await openStore(fixture);
    expect(store.listRuns(execution.threadId)).toEqual([
      expect.objectContaining({ status: "cancelled" }),
    ]);
    expect(
      (await store.listEvents(execution.threadId)).some(
        (event) => event.type === "workflow.cancelled",
      ),
    ).toBe(true);
    store.close();
  });

  it("runs the built SDK example as a real external Node application", async () => {
    const fixture = await createFixture("example");
    const examplePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../examples/typed-workflow.mjs",
    );
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      examplePath,
      fixture.workspaceRoot,
      fixture.dataRoot,
    ]);
    expect(stderr).toBe("");
    const output = JSON.parse(stdout) as Record<string, unknown>;
    expect(output).toEqual(
      expect.objectContaining({
        status: "completed",
        output: { message: "Draft retained by SDK Workflow" },
        runCount: 1,
        skippedNodeCount: 1,
      }),
    );
    expect(output["manifestSha256"]).toMatch(/^[a-f0-9]{64}$/u);
    expect(output["eventTypes"]).toEqual(
      expect.arrayContaining([
        "workflow.started",
        "workflow.node.completed",
        "workflow.node.skipped",
        "workflow.completed",
      ]),
    );
  });

  it("defines and reloads a typed bounded Map manifest", async () => {
    const fixture = await createFixture("map-definition");
    const client = await createNapierClient({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      sandbox: new UnsupportedSandboxAdapter("sdk-map-definition-test"),
    });
    const workflow = await client.defineWorkflow<MapRequest, MapReport>(
      mapWorkflowDefinition(),
    );
    const loaded = loadNapierWorkflow<MapRequest, MapReport>(
      JSON.parse(JSON.stringify(workflow.manifest)),
    );

    expect(loaded.manifest.nodes).toEqual([
      expect.objectContaining({
        id: "map_items",
        type: "map",
        itemsPath: ["items"],
        maxConcurrency: 3,
        itemTimeoutMs: 5_000,
      }),
    ]);
    await client.close();
  });

  it("defines and executes a deterministic Reduce through the SDK", async () => {
    const fixture = await createFixture("reduce-execution");
    const client = await createNapierClient({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      sandbox: new UnsupportedSandboxAdapter("sdk-reduce-execution-test"),
    });
    const workflow = await client.defineWorkflow<ReduceRequest, ReduceReport>(
      reduceWorkflowDefinition(),
    );
    const eventTypes: string[] = [];
    const execution = await client.runWorkflow({
      workflow,
      input: { values: [2, 3, 4] },
      onEvent: (event) => {
        eventTypes.push(event.type);
      },
    });

    expect(execution).toEqual(
      expect.objectContaining({
        status: "completed",
        output: 9,
        result: expect.objectContaining({
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
    expect(eventTypes).toContain("workflow.reduce.completed");
    await client.close();
  });

  it("defines and executes a typed deterministic Switch through the SDK", async () => {
    const fixture = await createFixture("switch-execution");
    const client = await createNapierClient({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      sandbox: new UnsupportedSandboxAdapter("sdk-switch-execution-test"),
    });
    const workflow = await client.defineWorkflow<SwitchRequest, SwitchReport>(
      switchWorkflowDefinition(),
    );
    let switchPayload: unknown;
    const execution = await client.runWorkflow({
      workflow,
      input: { route: "priority", text: "SDK Switch output" },
      onEvent: (event) => {
        if (event.type === "workflow.deterministic.completed") {
          switchPayload = event.payload;
        }
      },
    });

    expect(execution).toEqual(
      expect.objectContaining({
        status: "completed",
        output: { message: "SDK Switch output" },
      }),
    );
    expect(switchPayload).toEqual(
      expect.objectContaining({
        switchCaseId: "fast_path",
        switchSelectorSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        switchDefault: false,
      }),
    );
    expect(JSON.stringify(switchPayload)).not.toContain("priority");
    expect(JSON.stringify(switchPayload)).not.toContain("SDK Switch output");
    await client.close();
  });

  it("executes a stateful JavaScript node through the SDK", async () => {
    const fixture = await createFixture("javascript");
    const store = await openStore(fixture);
    const agent = store.listAgents()[0]!;
    await store.updateAgent(agent.id, {
      toolPolicy: "workspace",
      enabledTools: ["javascript_kernel"],
    });
    store.close();
    const client = await createNapierClient({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      sandbox: directSandbox(),
    });
    const workflow = await client.defineWorkflow<
      JavascriptRequest,
      JavascriptReport
    >(javascriptWorkflowDefinition());
    const eventTypes: string[] = [];
    const eventSeqs: number[] = [];
    const execution = await client.runWorkflow({
      workflow,
      input: { values: [4, 6, 8] },
      onEvent: (event) => {
        eventTypes.push(event.type);
        eventSeqs.push(event.seq);
      },
    });
    expect(execution).toEqual(
      expect.objectContaining({
        status: "completed",
        output: { total: 18 },
      }),
    );
    expect(execution.result.nodeResults).toEqual([
      expect.objectContaining({
        nodeId: "calculate",
        status: "completed",
        attempt: 1,
      }),
    ]);
    expect(eventTypes).toEqual(
      expect.arrayContaining([
        "workspace.process.started",
        "workspace.process.input",
        "workspace.process.settled",
        "workflow.javascript.completed",
      ]),
    );
    expect(eventSeqs).toEqual(eventSeqs.map((_, index) => index + 1));
    await client.close();
  }, 20_000);

  it("executes an exact stateful Python node through the SDK", async () => {
    const fixture = await createFixture("python");
    const store = await openStore(fixture);
    const agent = store.listAgents()[0]!;
    await store.updateAgent(agent.id, {
      toolPolicy: "workspace",
      enabledTools: ["python_kernel"],
    });
    store.close();
    const client = await createNapierClient({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      sandbox: directSandbox(),
    });
    const workflow = await client.defineWorkflow<PythonRequest, PythonReport>(
      pythonWorkflowDefinition(),
    );
    let completionPayload: unknown;
    const execution = await client.runWorkflow({
      workflow,
      input: { values: [4, 6, 8] },
      onEvent: (event) => {
        if (event.type === "workflow.python.completed") {
          completionPayload = event.payload;
        }
      },
    });
    expect(execution).toEqual(
      expect.objectContaining({
        status: "completed",
        output: { total: 18 },
      }),
    );
    expect(completionPayload).toEqual(
      expect.objectContaining({
        cellCount: 2,
        jsonValueSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        outputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(JSON.stringify(completionPayload)).not.toContain(
      "PRIVATE_SDK_PYTHON_VALUES",
    );
    expect(completionPayload).not.toEqual(
      expect.objectContaining({ output: expect.anything() }),
    );
    await client.close();
  }, 20_000);
});
