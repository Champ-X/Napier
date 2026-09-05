import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { agentCapabilityPresetUpdate } from "@napier/contracts/agent-capabilities";

import { AgentRuntime } from "../src/agent-runtime.js";
import { ModelRegistry } from "../src/models.js";
import type { OsSandboxAdapter } from "../src/sandbox.js";
import { LocalStore } from "../src/store.js";
import { WorkspaceProcessManager } from "../src/workspace-processes.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Governed Code Bridge", () => {
  it("routes nested reads through policy, lifecycle, Receipt, and Ledger", async () => {
    const fixture = await createFixture();
    try {
      const provider = fauxProvider({ provider: "faux-code-bridge" });
      provider.setResponses([
        fauxAssistantMessage(
          fauxToolCall("javascript_kernel", {
            action: "start",
            sessionTimeoutMs: 20_000,
          }),
          { stopReason: "toolUse" },
        ),
        (context) =>
          fauxAssistantMessage(
            fauxToolCall("javascript_kernel", {
              action: "evaluate",
              processId: processId(context.messages),
              bridge: true,
              code: 'napier.call("read_file",{path:"evidence.txt"}).then(result=>result.content[0].text)',
            }),
            { stopReason: "toolUse" },
          ),
        (context) => {
          expect(JSON.stringify(context.messages)).toContain(
            "CODE_BRIDGE_EVIDENCE",
          );
          return fauxAssistantMessage("Nested read verified.");
        },
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      fixture.registry.registerProvider(provider.provider);

      const run = await fixture.runtime.runPrompt({
        threadId: fixture.threadId,
        text: "Read the evidence through napier.call in JavaScript.",
        model: { provider: provider.provider.id, id: "faux-1" },
      });
      expect(run.status, run.error).toBe("completed");
      const events = (await fixture.store.listEvents(fixture.threadId)).filter(
        (event) => event.runId === run.id,
      );
      const nestedStarted = events.find(
        (event) =>
          event.type === "tool.started" &&
          event.payload["toolName"] === "read_file" &&
          event.payload["nestedDispatch"] === true,
      );
      const nestedCompleted = events.find(
        (event) =>
          event.type === "tool.completed" &&
          event.payload["toolName"] === "read_file" &&
          event.payload["nestedDispatch"] === true,
      );
      const authorized = events.find(
        (event) =>
          event.type === "code_bridge.authorized" &&
          event.payload["callId"] === nestedStarted?.payload["callId"],
      );
      expect(nestedStarted?.payload["callId"]).toMatch(/^codebridge_/u);
      expect(
        events.filter(
          (event) =>
            event.type === "tool.admitted" &&
            event.payload["callId"] === nestedStarted?.payload["callId"],
        ),
      ).toHaveLength(1);
      expect(
        events.filter(
          (event) =>
            event.type === "tool.started" &&
            event.payload["callId"] === nestedStarted?.payload["callId"],
        ),
      ).toHaveLength(1);
      expect(nestedCompleted?.payload["parentEvaluationId"]).toMatch(
        /^kernelrequest_/u,
      );
      expect(
        events.some(
          (event) =>
            event.type === "context.tool_invocation" &&
            event.payload["callId"] === nestedStarted?.payload["callId"],
        ),
      ).toBe(true);
      const resultReceipt = events.find(
        (event) =>
          event.type === "context.tool_result" &&
          event.payload["callId"] === nestedStarted?.payload["callId"],
      );
      const executionSettled = events.find(
        (event) =>
          event.type === "tool.operation.settled" &&
          event.payload["parentCallId"] === nestedStarted?.payload["callId"],
      );
      expect(resultReceipt!.seq).toBeLessThan(executionSettled!.seq);
      expect(executionSettled!.seq).toBeLessThan(nestedCompleted!.seq);
      expect(authorized?.payload).toEqual(
        expect.objectContaining({
          nestedDispatch: true,
          concurrency: "safe",
          sideEffect: "none",
          validationChecked: true,
          policyChecked: true,
          workspaceBoundaryChecked: true,
          budgetChecked: true,
          sandboxDelegated: true,
          inputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          definitionSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          toolVersionSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      );
      const startedProtocol = nestedStarted?.payload["toolProtocol"] as
        | Record<string, unknown>
        | undefined;
      expect(startedProtocol).toEqual(
        expect.objectContaining({
          kind: "napier.tool-ui-projection",
          schemaVersion: 2,
          toolId: "read_file",
          semanticVersion: "2.0.0",
          definitionSha256: authorized?.payload["definitionSha256"],
          implementationSha256: authorized?.payload["toolVersionSha256"],
          status: "started",
          sideEffect: "none",
          concurrency: "safe",
          compatibilityMode: "native",
        }),
      );
      expect(nestedCompleted?.payload["toolProtocol"]).toEqual({
        ...startedProtocol,
        status: "completed",
        progress: {
          ...(startedProtocol?.["progress"] as Record<string, unknown>),
          stateSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        },
      });
      expect(authorized!.seq).toBeLessThan(nestedStarted!.seq);
      expect(
        events.some(
          (event) =>
            event.type === "context.tool_result" &&
            event.payload["callId"] === nestedStarted?.payload["callId"],
        ),
      ).toBe(true);
    } finally {
      await fixture.processes.shutdown();
      fixture.store.close();
    }
  }, 20_000);

  it("fails closed when a nested call violates workspace policy", async () => {
    const fixture = await createFixture();
    try {
      const provider = fauxProvider({ provider: "faux-code-bridge-block" });
      provider.setResponses([
        fauxAssistantMessage(
          fauxToolCall("javascript_kernel", {
            action: "start",
            sessionTimeoutMs: 20_000,
          }),
          { stopReason: "toolUse" },
        ),
        (context) =>
          fauxAssistantMessage(
            fauxToolCall("javascript_kernel", {
              action: "evaluate",
              processId: processId(context.messages),
              bridge: true,
              code: 'napier.call("read_file",{path:"../outside.txt"})',
            }),
            { stopReason: "toolUse" },
          ),
        (context) => {
          expect(JSON.stringify(context.messages)).toContain(
            "path escapes the configured workspace",
          );
          return fauxAssistantMessage("Nested traversal was blocked.");
        },
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      fixture.registry.registerProvider(provider.provider);

      const run = await fixture.runtime.runPrompt({
        threadId: fixture.threadId,
        text: "Attempt an out-of-workspace nested read.",
        model: { provider: provider.provider.id, id: "faux-1" },
      });

      expect(run.status, run.error).toBe("completed");
      const events = (await fixture.store.listEvents(fixture.threadId)).filter(
        (event) => event.runId === run.id,
      );
      const blocked = events.find(
        (event) =>
          event.type === "tool.blocked" &&
          event.payload["toolName"] === "read_file" &&
          String(event.payload["callId"]).startsWith("codebridge_"),
      );
      expect(blocked?.payload["policyReason"]).toBe(
        "path escapes the configured workspace",
      );
      expect(blocked?.payload["toolProtocol"]).toEqual(
        expect.objectContaining({
          kind: "napier.tool-ui-projection",
          schemaVersion: 2,
          toolId: "read_file",
          semanticVersion: "2.0.0",
          status: "blocked",
          sideEffect: "none",
          concurrency: "safe",
          compatibilityMode: "native",
        }),
      );
      expect(
        events.some(
          (event) =>
            event.type === "tool.started" &&
            event.payload["toolName"] === "read_file" &&
            event.payload["nestedDispatch"] === true,
        ),
      ).toBe(false);
    } finally {
      await fixture.processes.shutdown();
      fixture.store.close();
    }
  }, 20_000);

  it("gives Python napier.call the same policy, Receipt, and Ledger path", async () => {
    const fixture = await createFixture(undefined, [
      "python_kernel",
      "read_file",
    ]);
    try {
      const provider = fauxProvider({ provider: "faux-python-code-bridge" });
      provider.setResponses([
        fauxAssistantMessage(
          fauxToolCall("python_kernel", {
            action: "start",
            sessionTimeoutMs: 20_000,
          }),
          { stopReason: "toolUse" },
        ),
        (context) =>
          fauxAssistantMessage(
            fauxToolCall("python_kernel", {
              action: "evaluate",
              processId: processId(context.messages),
              bridge: true,
              code: 'napier.call("read_file", {"path": "evidence.txt"})["content"][0]["text"]',
            }),
            { stopReason: "toolUse" },
          ),
        (context) => {
          expect(JSON.stringify(context.messages)).toContain(
            "CODE_BRIDGE_EVIDENCE",
          );
          return fauxAssistantMessage("Python nested read verified.");
        },
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      fixture.registry.registerProvider(provider.provider);

      const run = await fixture.runtime.runPrompt({
        threadId: fixture.threadId,
        text: "Read the evidence through napier.call in Python.",
        model: { provider: provider.provider.id, id: "faux-1" },
      });

      expect(run.status, run.error).toBe("completed");
      const events = (await fixture.store.listEvents(fixture.threadId)).filter(
        (event) => event.runId === run.id,
      );
      const nestedStarted = events.find(
        (event) =>
          event.type === "tool.started" &&
          event.payload["toolName"] === "read_file" &&
          event.payload["nestedDispatch"] === true,
      );
      expect(nestedStarted?.payload["callId"]).toMatch(/^codebridge_/u);
      expect(nestedStarted?.payload["parentEvaluationId"]).toMatch(
        /^pykernelrequest_/u,
      );
      expect(
        events.some(
          (event) =>
            event.type === "context.tool_invocation" &&
            event.payload["callId"] === nestedStarted?.payload["callId"],
        ),
      ).toBe(true);
      expect(
        events.some(
          (event) =>
            event.type === "context.tool_result" &&
            event.payload["callId"] === nestedStarted?.payload["callId"],
        ),
      ).toBe(true);
    } finally {
      await fixture.processes.shutdown();
      fixture.store.close();
    }
  }, 20_000);

  it("exposes catalog discovery through napier.capability without host authority", async () => {
    const fixture = await createFixture("safe_automation");
    try {
      let observedMessages = "";
      const provider = fauxProvider({ provider: "faux-code-bridge-catalog" });
      provider.setResponses([
        (context) => {
          const names = (context.tools ?? []).map((tool) => tool.name);
          expect(names).toContain("capability");
          expect(names).not.toContain("javascript_kernel");
          return fauxAssistantMessage(
            fauxToolCall("capability", {
              uri: "cap://tools/javascript_kernel",
            }),
            { stopReason: "toolUse" },
          );
        },
        (context) => {
          expect((context.tools ?? []).map((tool) => tool.name)).toContain(
            "javascript_kernel",
          );
          return fauxAssistantMessage(
            fauxToolCall("javascript_kernel", {
              action: "start",
              sessionTimeoutMs: 20_000,
            }),
            { stopReason: "toolUse" },
          );
        },
        (context) =>
          fauxAssistantMessage(
            fauxToolCall("javascript_kernel", {
              action: "evaluate",
              processId: processId(context.messages),
              bridge: true,
              code: 'napier.capability("commit").then(items=>items.map(item=>item.toolId))',
            }),
            { stopReason: "toolUse" },
          ),
        (context) => {
          observedMessages = JSON.stringify(context.messages);
          return fauxAssistantMessage("Nested catalog discovery verified.");
        },
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      fixture.registry.registerProvider(provider.provider);

      const run = await fixture.runtime.runPrompt({
        threadId: fixture.threadId,
        text: "Use JavaScript to discover configured commit capabilities.",
        model: { provider: provider.provider.id, id: "faux-1" },
      });

      expect(run.status, run.error).toBe("completed");
      expect(observedMessages).toContain("git_commit_apply");
      expect(
        (await fixture.store.listEvents(fixture.threadId)).some(
          (event) =>
            event.runId === run.id &&
            event.type === "tool.completed" &&
            event.payload["toolName"] === "capability" &&
            event.payload["nestedDispatch"] === true,
        ),
      ).toBe(true);
    } finally {
      await fixture.processes.shutdown();
      fixture.store.close();
    }
  }, 20_000);

  it("routes a reversible nested edit through the existing workspace boundary", async () => {
    const fixture = await createFixture(undefined, [
      "javascript_kernel",
      "apply_patch",
    ]);
    try {
      const before = "status=draft\n";
      const after = "status=verified\n";
      await writeFile(path.join(fixture.workspaceRoot, "status.txt"), before);
      const expectedSha256 = createHash("sha256").update(before).digest("hex");
      const provider = fauxProvider({ provider: "faux-code-bridge-write" });
      provider.setResponses([
        fauxAssistantMessage(
          fauxToolCall("javascript_kernel", {
            action: "start",
            sessionTimeoutMs: 20_000,
          }),
          { stopReason: "toolUse" },
        ),
        (context) =>
          fauxAssistantMessage(
            fauxToolCall("javascript_kernel", {
              action: "evaluate",
              processId: processId(context.messages),
              bridge: true,
              code: `napier.call("apply_patch",${JSON.stringify({
                operation: "replace",
                path: "status.txt",
                expectedSha256,
                edits: [{ oldText: before, newText: after }],
              })}).then(result=>result.details.afterSha256)`,
            }),
            { stopReason: "toolUse" },
          ),
        fauxAssistantMessage("Nested reversible edit verified."),
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      fixture.registry.registerProvider(provider.provider);

      const run = await fixture.runtime.runPrompt({
        threadId: fixture.threadId,
        text: "Apply the prepared edit through the governed JavaScript bridge.",
        model: { provider: provider.provider.id, id: "faux-1" },
      });

      expect(run.status, run.error).toBe("completed");
      expect(
        await import("node:fs/promises").then((fs) =>
          fs.readFile(path.join(fixture.workspaceRoot, "status.txt"), "utf8"),
        ),
      ).toBe(after);
      const events = (await fixture.store.listEvents(fixture.threadId)).filter(
        (event) => event.runId === run.id,
      );
      const started = events.find(
        (event) =>
          event.type === "tool.started" &&
          event.payload["toolName"] === "apply_patch" &&
          event.payload["nestedDispatch"] === true,
      );
      expect(started?.payload["effect"]).toBe("write");
      expect(
        events.some(
          (event) =>
            event.type === "tool.completed" &&
            event.payload["callId"] === started?.payload["callId"],
        ),
      ).toBe(true);
      expect(
        events.find(
          (event) =>
            event.type === "tool.completed" &&
            event.payload["callId"] === started?.payload["callId"],
        )?.payload["resultSha256"],
      ).toMatch(/^[a-f0-9]{64}$/u);
    } finally {
      await fixture.processes.shutdown();
      fixture.store.close();
    }
  }, 20_000);

  it("requires unknown effects to leave code mode for an approval checkpoint", async () => {
    const fixture = await createFixture(undefined, ["javascript_kernel"]);
    try {
      const provider = fauxProvider({ provider: "faux-code-bridge-approval" });
      provider.setResponses([
        fauxAssistantMessage(
          fauxToolCall("javascript_kernel", {
            action: "start",
            sessionTimeoutMs: 20_000,
          }),
          { stopReason: "toolUse" },
        ),
        (context) =>
          fauxAssistantMessage(
            fauxToolCall("javascript_kernel", {
              action: "evaluate",
              processId: processId(context.messages),
              bridge: true,
              code: `napier.call("javascript_kernel",{action:"cancel",processId:${JSON.stringify(processId(context.messages))}})`,
            }),
            { stopReason: "toolUse" },
          ),
        (context) => {
          expect(JSON.stringify(context.messages)).toContain(
            "requires an approval checkpoint outside the code session",
          );
          return fauxAssistantMessage("Approval boundary verified.");
        },
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      fixture.registry.registerProvider(provider.provider);

      const run = await fixture.runtime.runPrompt({
        threadId: fixture.threadId,
        text: "Try an unknown-effect nested operation.",
        model: { provider: provider.provider.id, id: "faux-1" },
      });

      expect(run.status, run.error).toBe("completed");
      const events = (await fixture.store.listEvents(fixture.threadId)).filter(
        (event) => event.runId === run.id,
      );
      expect(
        events.find(
          (event) =>
            event.type === "tool.blocked" &&
            event.payload["toolName"] === "javascript_kernel" &&
            event.payload["nestedDispatch"] === true,
        )?.payload["harnessInterventionReason"],
      ).toBe("approval_block");
      expect(
        events.some(
          (event) =>
            event.type === "tool.started" &&
            event.payload["toolName"] === "javascript_kernel" &&
            event.payload["nestedDispatch"] === true,
        ),
      ).toBe(false);
    } finally {
      await fixture.processes.shutdown();
      fixture.store.close();
    }
  }, 20_000);
});

async function createFixture(
  preset?: "safe_automation",
  enabledTools = ["javascript_kernel", "read_file"],
) {
  const root = await mkdtemp(path.join(tmpdir(), "napier-code-bridge-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  await writeFile(
    path.join(workspaceRoot, "evidence.txt"),
    "CODE_BRIDGE_EVIDENCE\n",
  );
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "state"),
  });
  await store.initialize();
  const sandbox = directSandbox();
  const processes = new WorkspaceProcessManager({
    store,
    workspaceRoot,
    sandbox,
  });
  await processes.initialize();
  const agent = await store.updateAgent(
    store.listAgents()[0]!.id,
    preset
      ? agentCapabilityPresetUpdate(preset)
      : {
          toolPolicy: "workspace",
          enabledTools,
        },
  );
  const thread = await store.createThread({
    title: "Governed Code Bridge",
    agentId: agent.id,
  });
  const registry = new ModelRegistry();
  return {
    store,
    workspaceRoot,
    processes,
    registry,
    threadId: thread.id,
    runtime: new AgentRuntime(store, registry, undefined, sandbox, processes),
  };
}

function processId(messages: unknown): string {
  const id = JSON.stringify(messages).match(/process_[a-z0-9]{20}/u)?.[0];
  if (!id) throw new Error("Code kernel process ID is unavailable");
  return id;
}

function directSandbox(): OsSandboxAdapter {
  return {
    id: "direct-code-bridge-test",
    async launch(request) {
      const child = spawn(request.command, request.args, {
        cwd: request.cwd,
        env: { ...request.env },
        detached: true,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const exit = new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve) =>
        child.once("exit", (code, signal) => resolve({ code, signal })),
      );
      return {
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        exit,
        async terminate() {
          if (child.exitCode === null && child.signalCode === null) {
            if (child.pid !== undefined) {
              try {
                process.kill(-child.pid, "SIGTERM");
              } catch {
                child.kill("SIGTERM");
              }
            }
          }
          await exit;
        },
      };
    },
  };
}
