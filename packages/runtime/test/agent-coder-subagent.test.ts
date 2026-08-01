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
import { afterEach, describe, expect, it } from "vitest";

import { AgentRuntime } from "../src/agent-runtime.js";
import { ModelRegistry } from "../src/models.js";
import { exportThreadReplayBundle } from "../src/replay.js";
import type { OsSandboxAdapter } from "../src/sandbox.js";
import { LocalStore } from "../src/store.js";
import { verifyThreadReplayBundle } from "../src/thread-bundles.js";
import { controlledLspRenameSandbox } from "./lsp-rename-test-fixture.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Agent coder Subagent", () => {
  it("delegates, reviews, and applies an isolated candidate through one Run", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-agent-coder-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await Promise.all([
      mkdir(path.join(workspaceRoot, "src"), { recursive: true }),
      mkdir(path.join(workspaceRoot, "test"), { recursive: true }),
      mkdir(path.join(workspaceRoot, "node_modules/vitest"), {
        recursive: true,
      }),
    ]);
    const source = "export const value = 1;\n";
    const deleted = "export const deleted = true;\n";
    const moved = "export const moved = true;\n";
    const added = "export const added = true;\n";
    const testPath = "test/add.test.ts";
    await Promise.all([
      writeFile(path.join(workspaceRoot, "src/value.ts"), source),
      writeFile(path.join(workspaceRoot, "src/delete.ts"), deleted),
      writeFile(path.join(workspaceRoot, "src/move.ts"), moved),
      writeFile(
        path.join(workspaceRoot, testPath),
        'import { added } from "../src/add.js"; export const observed = added;\n',
      ),
      writeFile(
        path.join(workspaceRoot, "node_modules/vitest/vitest.mjs"),
        "// fixed verifier fixture\n",
      ),
    ]);
    const store = new LocalStore({
      dataRoot: path.join(root, "data"),
      workspaceRoot,
    });
    await store.initialize();
    const agent = await store.updateAgent(store.listAgents()[0]!.id, {
      toolPolicy: "workspace",
      enabledTools: [
        "apply_patch",
        "lsp_diagnostics",
        "run_command",
        "verify_workspace",
      ],
      enabledSubagents: ["coder"],
    });
    const thread = await store.createThread({
      title: "Coder worktree",
      agentId: agent.id,
    });
    const faux = fauxProvider({ provider: "faux-coder-worktree" });
    let previewId = "";
    let parentAfterApply = "";
    faux.setResponses([
      (context) => {
        expect(context.tools?.map((tool) => tool.name)).toEqual(
          expect.arrayContaining(["delegate_task", "subagent_worktree_apply"]),
        );
        return fauxAssistantMessage(
          fauxToolCall("delegate_task", {
            role: "coder",
            description: "Apply an isolated file lifecycle change",
            task: "Modify value.ts, create add.ts, delete delete.ts, and rename move.ts to renamed.ts.",
            writePaths: [
              "src/add.ts",
              "src/delete.ts",
              "src/move.ts",
              "src/renamed.ts",
              "src/value.ts",
            ],
          }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        expect(context.systemPrompt).toContain("private workspace snapshot");
        expect(context.tools?.map((tool) => tool.name)).not.toContain(
          "delegate_task",
        );
        return fauxAssistantMessage(
          fauxToolCall("apply_patch", {
            operation: "replace",
            path: "src/value.ts",
            expectedSha256: sha256(source),
            edits: [{ oldText: "value = 1", newText: "value = 2" }],
          }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        expect(context.tools?.map((tool) => tool.name)).toContain(
          "candidate_file",
        );
        return fauxAssistantMessage(
          fauxToolCall("apply_patch", {
            operation: "create",
            path: "src/add.ts",
            expectedSha256: null,
            content: added,
          }),
          { stopReason: "toolUse" },
        );
      },
      fauxAssistantMessage(
        fauxToolCall("candidate_file", {
          operation: "delete",
          path: "src/delete.ts",
          expectedSha256: sha256(deleted),
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        fauxToolCall("candidate_file", {
          operation: "move",
          sourcePath: "src/move.ts",
          destinationPath: "src/renamed.ts",
          expectedSourceSha256: sha256(moved),
          expectedDestinationSha256: null,
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        expect(context.tools?.map((tool) => tool.name)).toContain(
          "run_command",
        );
        return fauxAssistantMessage(
          fauxToolCall("run_command", {
            runtime: "node",
            args: ["-e", "console.log('TOP_SECRET_CANDIDATE_COMMAND_ARG')"],
          }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        expect(context.tools?.map((tool) => tool.name)).toContain(
          "verify_workspace",
        );
        return fauxAssistantMessage(
          fauxToolCall("verify_workspace", {
            kind: "test",
            target: testPath,
          }),
          { stopReason: "toolUse" },
        );
      },
      fauxAssistantMessage(
        JSON.stringify({
          summary: "Prepared the requested lifecycle candidate.",
          items: [
            {
              kind: "finding",
              severity: "info",
              title: "Lifecycle completed",
              detail: "The isolated candidate contains the added file.",
              evidence: [{ path: "src/add.ts", lineStart: 1, lineEnd: 1 }],
            },
          ],
          unknowns: [],
        }),
      ),
      (context) => {
        const serialized = JSON.stringify(context.messages);
        previewId =
          serialized.match(/subworkpreview_[a-z0-9]{8,80}/u)?.[0] ?? "";
        expect(previewId).toMatch(/^subworkpreview_/u);
        expect(serialized).toContain("src/value.ts");
        expect(serialized).toContain(
          "Lifecycle: 2 added / 1 modified / 2 deleted / 1 renamed",
        );
        expect(serialized).toContain(
          "Candidate verification: 1 fresh / 1 passed / 0 failed / 0 stale",
        );
        expect(serialized).toContain(
          "Candidate commands: 1 fresh / 1 succeeded / 0 failed / 0 stale",
        );
        return fauxAssistantMessage(
          fauxToolCall("subagent_worktree_apply", { previewId }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        parentAfterApply = JSON.stringify(context.messages);
        return fauxAssistantMessage(
          "The isolated coder candidate was reviewed and merged.",
        );
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const models = new ModelRegistry();
    models.registerProvider(faux.provider);
    const runtime = new AgentRuntime(store, models, undefined, coderSandbox());

    const run = await runtime.runPrompt({
      threadId: thread.id,
      text: "Delegate the bounded change and merge it only after review.",
      model: { provider: faux.provider.id, id: "faux-1" },
    });

    expect(run.status).toBe("completed");
    expect(parentAfterApply, parentAfterApply).toContain(
      "Subagent worktree apply: applied",
    );
    expect(parentAfterApply).toContain(testPath);
    expect(
      await readFile(path.join(workspaceRoot, "src/value.ts"), "utf8"),
    ).toBe("export const value = 2;\n");
    await expect(
      readFile(path.join(workspaceRoot, "src/add.ts"), "utf8"),
    ).resolves.toBe(added);
    await expect(
      readFile(path.join(workspaceRoot, "src/renamed.ts"), "utf8"),
    ).resolves.toBe(moved);
    await expect(
      readFile(path.join(workspaceRoot, "src/delete.ts")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(path.join(workspaceRoot, "src/move.ts")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const events = await store.listEvents(thread.id);
    const merge = events.find(
      (event) =>
        event.type === "tool.completed" &&
        event.payload["toolName"] === "subagent_worktree_apply",
    );
    expect(merge?.payload["details"]).toEqual(
      expect.objectContaining({
        kind: "napier.subagent-worktree-apply",
        status: "applied",
        fileCount: 5,
        taskId: expect.stringMatching(/^task_/u),
        candidateAddedFileCount: 2,
        candidateModifiedFileCount: 1,
        candidateDeletedFileCount: 2,
        candidateRenamedFileCount: 1,
        candidateVerificationAttemptCount: 1,
        candidateVerificationFreshCount: 1,
        candidateVerificationPassedCount: 1,
        candidateVerificationFailedCount: 0,
        candidateVerificationStaleCount: 0,
        candidateCommandAttemptCount: 1,
        candidateCommandFreshCount: 1,
        candidateCommandSucceededCount: 1,
        candidateCommandFailedCount: 0,
        candidateCommandStaleCount: 0,
        candidateCommandSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        diagnostics: expect.objectContaining({
          status: "clean",
          fileCount: 5,
        }),
        tests: expect.objectContaining({
          status: "passed",
          changedFileCount: 5,
          selectedTestCount: 1,
        }),
        resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    const durable = JSON.stringify(events);
    expect(durable).not.toContain(previewId);
    expect(durable).not.toContain("value = 2");
    expect(durable).toContain("src/add.ts");
    expect(durable).not.toContain("src/renamed.ts");
    expect(durable).not.toContain("src/delete.ts");
    expect(durable).not.toContain(testPath);
    expect(durable).not.toContain("TOP_SECRET_CANDIDATE_COMMAND_ARG");
    expect(durable).not.toContain("TOP_SECRET_CANDIDATE_STDOUT");
    expect(
      events.find(
        (event) =>
          event.type === "tool.started" &&
          event.payload["toolName"] === "delegate_task",
      )?.payload,
    ).toEqual(
      expect.objectContaining({
        inputRedacted: true,
        inputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    const replay = await exportThreadReplayBundle(store, thread.id);
    expect(verifyThreadReplayBundle(replay).status).toBe("valid");
  });
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function coderSandbox(): OsSandboxAdapter {
  const lsp = controlledLspRenameSandbox({}).sandbox;
  const verifier = passingVerifierSandbox();
  return {
    id: "candidate-agent-sandbox",
    launch(request) {
      return request.args.includes("--stdio")
        ? lsp.launch(request)
        : verifier.launch(request);
    },
  };
}

function passingVerifierSandbox(): OsSandboxAdapter {
  return {
    id: "candidate-agent-verifier",
    async launch() {
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const exit = new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve) => {
        setTimeout(() => {
          stdout.end("TOP_SECRET_CANDIDATE_STDOUT");
          stderr.end();
          resolve({ code: 0, signal: null });
        }, 0);
      });
      return {
        stdin,
        stdout,
        stderr,
        exit,
        async terminate() {
          stdout.end();
          stderr.end();
          await exit;
        },
      };
    },
  };
}
