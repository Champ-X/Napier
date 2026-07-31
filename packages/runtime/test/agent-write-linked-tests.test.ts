import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AgentRuntime,
  exportThreadReplayBundle,
  LocalStore,
  ModelRegistry,
  type OsSandboxAdapter,
  type SandboxedProcess,
  verifyThreadReplayBundle,
} from "../src/index.js";
import { createStatelessAgentTools } from "../src/stateless-agent-tools.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Agent write-linked test verification", () => {
  it("patches code, selects its dependent test, and accepts fresh pass evidence", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-agent-linked-test-"),
    );
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const sourcePath = "src/private-calculator.ts";
    const testPath = "test/private-calculator.test.ts";
    const source = "export const privateTotal = 2 + 2;\n";
    const updated = "export const privateTotal = 2 + 3;\n";
    await Promise.all([
      mkdir(path.join(workspaceRoot, "src"), { recursive: true }),
      mkdir(path.join(workspaceRoot, "test"), { recursive: true }),
      mkdir(path.join(workspaceRoot, "node_modules/vitest"), {
        recursive: true,
      }),
    ]);
    await Promise.all([
      writeFile(path.join(workspaceRoot, sourcePath), source),
      writeFile(
        path.join(workspaceRoot, testPath),
        [
          'import { privateTotal } from "../src/private-calculator.js";',
          "export const observedPrivateTotal = privateTotal;",
          "",
        ].join("\n"),
      ),
      writeFile(
        path.join(workspaceRoot, "node_modules/vitest/vitest.mjs"),
        "// fixed private verifier\n",
      ),
    ]);
    const store = new LocalStore({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
    });
    await store.initialize();
    const agent = await store.updateAgent(store.listAgents()[0]!.id, {
      toolPolicy: "workspace",
      enabledTools: ["apply_patch", "verify_workspace"],
    });
    const thread = await store.createThread({
      title: "Write-linked test Agent",
      agentId: agent.id,
    });
    const provider = fauxProvider({ provider: "faux-write-linked-tests" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("apply_patch", {
          operation: "replace",
          path: sourcePath,
          expectedSha256: sha256(source),
          edits: [{ oldText: "2 + 2", newText: "2 + 3" }],
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain("Write-linked tests: passed");
        expect(messages).toContain(testPath);
        expect(messages).toContain("privateTotal");
        return fauxAssistantMessage("The relevant tests passed.");
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);
    const runtime = new AgentRuntime(
      store,
      models,
      undefined,
      passingVerificationSandbox(),
    );

    const run = await runtime.runPrompt({
      threadId: thread.id,
      text: "Update the private calculator and verify its relevant tests.",
      model: { provider: "faux-write-linked-tests", id: "faux-1" },
    });

    expect(run.status, run.error).toBe("completed");
    expect(await readFile(path.join(workspaceRoot, sourcePath), "utf8")).toBe(
      updated,
    );
    const events = await store.listEvents(thread.id);
    const patchEvent = events.find(
      (event) =>
        event.type === "tool.completed" &&
        record(event.payload) &&
        event.payload["toolName"] === "apply_patch",
    );
    expect(patchEvent?.payload).toEqual(
      expect.objectContaining({
        details: expect.objectContaining({
          tests: expect.objectContaining({
            kind: "napier.write-linked-test-verification",
            status: "passed",
            changedFileCount: 1,
            changedSymbolCount: 1,
            selectedTestCount: 1,
            graphTruncated: false,
            resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          }),
        }),
      }),
    );
    expect(events.some((event) => event.type === "model.advisor.notice")).toBe(
      false,
    );
    const durable = JSON.stringify(
      events.filter(
        (event) =>
          event.type.startsWith("tool.") ||
          event.type === "model.response" ||
          event.type === "model.advisor.notice",
      ),
    );
    expect(durable).not.toContain(sourcePath);
    expect(durable).not.toContain(testPath);
    expect(durable).not.toContain("privateTotal");
    expect(durable).not.toContain("PRIVATE_TEST_STDOUT");
    expect(
      verifyThreadReplayBundle(await exportThreadReplayBundle(store, thread.id))
        .status,
    ).toBe("valid");
    store.close();
  });

  it("does not auto-run tests without the explicit verifier capability", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-agent-linked-policy-"),
    );
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const sourcePath = "src/value.ts";
    const source = "export const value = 1;\n";
    await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    await writeFile(path.join(workspaceRoot, sourcePath), source);
    const store = new LocalStore({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
    });
    await store.initialize();
    const profile = await store.updateAgent(store.listAgents()[0]!.id, {
      toolPolicy: "workspace",
      enabledTools: ["apply_patch"],
    });
    const launch = vi.fn(async () => {
      throw new Error("verification must not launch");
    });
    const patch = createStatelessAgentTools({
      store,
      profile,
      threadId: "thread_policy",
      runId: "run_policy",
      sandbox: { id: "policy-sandbox", launch },
    }).find((tool) => tool.name === "apply_patch");

    expect(patch).toBeDefined();
    const result = await patch!.execute("policy-patch", {
      operation: "replace",
      path: sourcePath,
      expectedSha256: sha256(source),
      edits: [{ oldText: "= 1", newText: "= 2" }],
    });

    expect(launch).not.toHaveBeenCalled();
    expect(result.details).not.toHaveProperty("tests");
    expect(await readFile(path.join(workspaceRoot, sourcePath), "utf8")).toBe(
      "export const value = 2;\n",
    );
    store.close();
  });

  it("does not expose writes or verifier processes in read-only modes", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-agent-linked-read-only-"),
    );
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot, { recursive: true });
    const store = new LocalStore({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
    });
    await store.initialize();
    const observe = await store.updateAgent(store.listAgents()[0]!.id, {
      toolPolicy: "observe",
      enabledTools: ["apply_patch", "verify_workspace"],
    });
    const sandbox = { id: "read-only-sandbox", launch: vi.fn() };
    const observeTools = createStatelessAgentTools({
      store,
      profile: observe,
      threadId: "thread_observe",
      runId: "run_observe",
      sandbox,
    }).map((tool) => tool.name);
    const workspace = await store.updateAgent(observe.id, {
      toolPolicy: "workspace",
    });
    const restrictedTools = createStatelessAgentTools({
      store,
      profile: workspace,
      threadId: "thread_restricted",
      runId: "run_restricted",
      sandbox,
      restrictedReadOnlyExecution: true,
    }).map((tool) => tool.name);

    expect(observeTools).not.toContain("apply_patch");
    expect(observeTools).not.toContain("verify_workspace");
    expect(restrictedTools).not.toContain("apply_patch");
    expect(restrictedTools).not.toContain("verify_workspace");
    expect(sandbox.launch).not.toHaveBeenCalled();
    store.close();
  });
});

function passingVerificationSandbox(): OsSandboxAdapter {
  return {
    id: "write-linked-test-sandbox",
    async launch() {
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      let settled = false;
      let resolveExit:
        | ((value: {
            code: number | null;
            signal: NodeJS.Signals | null;
          }) => void)
        | undefined;
      const exit = new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve) => {
        resolveExit = resolve;
      });
      const settle = (
        code: number | null,
        signal: NodeJS.Signals | null,
      ): void => {
        if (settled) return;
        settled = true;
        stdout.end();
        stderr.end();
        resolveExit?.({ code, signal });
      };
      setTimeout(() => {
        stdout.write("PRIVATE_TEST_STDOUT");
        settle(0, null);
      }, 0);
      return {
        stdin,
        stdout,
        stderr,
        exit,
        terminate: async () => settle(null, "SIGTERM"),
      } satisfies SandboxedProcess;
    },
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
