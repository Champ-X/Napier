import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { OsSandboxAdapter } from "../src/sandbox.js";
import { LocalStore } from "../src/store.js";
import { SubagentWorktreeMutationManager } from "../src/subagent-worktree-mutation.js";
import { WriteLinkedTestVerificationRunner } from "../src/write-linked-test-verification.js";
import { WorkspaceProcessManager } from "../src/workspace-processes.js";

const describeLive =
  process.env["NAPIER_LIVE_CODER_SUBAGENT_SMOKE"] === "1"
    ? describe
    : describe.skip;
const cleanupTargets: string[] = [];
const openProcesses: WorkspaceProcessManager[] = [];
const openStores: LocalStore[] = [];

afterEach(async () => {
  await Promise.allSettled(
    openProcesses.splice(0).map((processes) => processes.shutdown()),
  );
  for (const store of openStores.splice(0)) store.close();
  await Promise.all(
    cleanupTargets
      .splice(0)
      .map((target) => rm(target, { recursive: true, force: true })),
  );
});

describeLive("live coder Subagent smoke", () => {
  it("merges a real TypeScript candidate with diagnostics and selected Vitest", async () => {
    const workspaceRoot = await realpath(path.resolve(process.cwd(), "../.."));
    const suffix = randomBytes(5).toString("hex");
    const fixtureName = `subagent-coder-live-${suffix}`;
    const fixtureRoot = path.join(workspaceRoot, fixtureName);
    const dataRoot = await mkdtemp(
      path.join(tmpdir(), "napier-coder-live-data-"),
    );
    cleanupTargets.push(fixtureRoot, dataRoot);
    await Promise.all([
      mkdir(path.join(fixtureRoot, "src"), { recursive: true }),
      mkdir(path.join(fixtureRoot, "test"), { recursive: true }),
    ]);
    const apiPath = `${fixtureName}/src/api.ts`;
    const consumerPath = `${fixtureName}/src/consumer.ts`;
    const debugPath = `${fixtureName}/src/debug-target.mjs`;
    const testPath = `${fixtureName}/test/value.test.ts`;
    const api = [
      "export function currentName(value: number): number {",
      "  const adjusted = value + 1;",
      "  return adjusted;",
      "}",
      "",
    ].join("\n");
    const consumer = [
      'import { currentName } from "./api.js";',
      "export const semanticValue = currentName(4);",
      "",
    ].join("\n");
    const debugSource = [
      "function debugValue(input) {",
      "  const adjusted = input + 1;",
      "  return adjusted;",
      "}",
      "globalThis.CANDIDATE_DEBUG_RESULT = debugValue(3);",
      "",
    ].join("\n");
    await Promise.all([
      writeFile(
        path.join(fixtureRoot, "package.json"),
        JSON.stringify({
          name: `napier-live-coder-${suffix}`,
          private: true,
          type: "module",
        }),
      ),
      writeFile(
        path.join(fixtureRoot, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            noEmit: true,
            module: "NodeNext",
            moduleResolution: "NodeNext",
          },
          include: ["src/**/*.ts", "test/**/*.ts"],
        }),
      ),
      writeFile(path.join(workspaceRoot, apiPath), api),
      writeFile(path.join(workspaceRoot, consumerPath), consumer),
      writeFile(path.join(workspaceRoot, debugPath), debugSource),
      writeFile(
        path.join(workspaceRoot, testPath),
        [
          'import { expect, test } from "vitest";',
          'import { semanticValue } from "../src/consumer.js";',
          'test("coder semantic rename", () => expect(semanticValue).toBe(5));',
          "",
        ].join("\n"),
      ),
    ]);
    const sandbox = directProcessAdapter();
    const store = new LocalStore({ workspaceRoot, dataRoot });
    await store.initialize();
    openStores.push(store);
    const processes = new WorkspaceProcessManager({
      store,
      workspaceRoot,
      sandbox,
    });
    await processes.initialize();
    openProcesses.push(processes);
    const thread = store.listThreads()[0]!;
    const run = store.listRuns(thread.id)[0]!;
    const manager = new SubagentWorktreeMutationManager({
      workspaceRoot,
      dataRoot,
      ownerId: `worker_live_${suffix}`,
      sandbox,
      processes,
      debuggerOwner: { threadId: thread.id, runId: run.id },
      enableCandidateDebugger: true,
      enableCandidateVerification: true,
      enableCandidateCommand: true,
      enabledSemanticLspTools: [
        "lsp_symbols",
        "lsp_definition",
        "lsp_references",
        "lsp_rename",
        "lsp_rename_apply",
        "lsp_code_actions",
        "lsp_code_action_apply",
      ],
      tests: new WriteLinkedTestVerificationRunner({
        workspaceRoot,
        sandbox,
      }),
    });
    const worktree = await manager.createWorktree("task_livecoder1", [
      apiPath,
      consumerPath,
      debugPath,
    ]);
    const tools = manager.createCoderTools(worktree);
    const lsp = tools.find((tool) => tool.name === "lsp_diagnostics")!;
    const verify = tools.find((tool) => tool.name === "verify_workspace")!;
    const command = tools.find((tool) => tool.name === "run_command")!;
    const symbols = tools.find((tool) => tool.name === "lsp_symbols")!;
    const definition = tools.find((tool) => tool.name === "lsp_definition")!;
    const references = tools.find((tool) => tool.name === "lsp_references")!;
    const rename = tools.find((tool) => tool.name === "lsp_rename")!;
    const renameApply = tools.find((tool) => tool.name === "lsp_rename_apply")!;
    const debuggerTool = tools.find((tool) => tool.name === "node_debugger")!;
    const patch = tools.find((tool) => tool.name === "apply_patch")!;
    const candidateSymbols = await symbols.execute("live-coder-symbols", {
      path: apiPath,
      timeoutMs: 30_000,
    });
    expect(candidateSymbols.details).toEqual(
      expect.objectContaining({ status: "found", symbolCount: 2 }),
    );
    const candidateDefinition = await definition.execute(
      "live-coder-definition",
      {
        path: consumerPath,
        line: 1,
        character: 10,
        timeoutMs: 30_000,
      },
    );
    expect(candidateDefinition.details).toEqual(
      expect.objectContaining({ status: "found", definitionCount: 1 }),
    );
    const candidateReferences = await references.execute(
      "live-coder-references",
      {
        path: consumerPath,
        line: 1,
        character: 10,
        includeDeclaration: true,
        timeoutMs: 30_000,
      },
    );
    expect(candidateReferences.details).toEqual(
      expect.objectContaining({ status: "found", referenceCount: 3 }),
    );
    const renamePreview = await rename.execute("live-coder-rename", {
      path: apiPath,
      line: 1,
      character: 17,
      newName: "canonicalName",
      timeoutMs: 30_000,
    });
    const renameText = renamePreview.content.find(
      (item) => item.type === "text",
    )?.text;
    const renamePreviewId = renameText?.match(
      /renamepreview_[a-z0-9]{8,80}/u,
    )?.[0];
    expect(renamePreviewId).toMatch(/^renamepreview_/u);
    const semanticApply = await renameApply.execute("live-coder-rename-apply", {
      previewId: renamePreviewId!,
    });
    expect(semanticApply.details).toEqual(
      expect.objectContaining({
        status: "applied",
        postcondition: "verified",
      }),
    );
    await expect(
      readFile(path.join(worktree.root, apiPath), "utf8"),
    ).resolves.toContain("canonicalName");
    await expect(
      readFile(path.join(worktree.root, consumerPath), "utf8"),
    ).resolves.toContain("canonicalName");
    await patch.execute("live-coder-debug-patch", {
      operation: "replace",
      path: debugPath,
      expectedSha256: sha256(debugSource),
      edits: [{ oldText: "debugValue(3)", newText: "debugValue(4)" }],
    });
    const debugLaunch = await debuggerTool.execute("live-coder-debug-launch", {
      action: "launch",
      path: debugPath,
      breakpoints: [{ line: 2 }],
      timeoutMs: 5_000,
      sessionTimeoutMs: 30_000,
    });
    const debugLaunchText =
      debugLaunch.content.find((item) => item.type === "text")?.text ?? "";
    const debugProcessId = debugLaunchText.match(/process_[a-z0-9]{20}/u)?.[0];
    const debugFrameId = debugLaunchText.match(/#(\d+) debugValue/u)?.[1];
    expect(debugLaunchText).toContain("Stop reason: breakpoint");
    expect(debugProcessId).toBeDefined();
    expect(debugFrameId).toBeDefined();
    const debugEvaluation = await debuggerTool.execute(
      "live-coder-debug-evaluate",
      {
        action: "evaluate",
        processId: debugProcessId,
        frameId: Number(debugFrameId),
        expression: "input",
      },
    );
    expect(debugEvaluation.content[0]?.text).toContain("ok: 4 (number)");
    const debugStep = await debuggerTool.execute("live-coder-debug-next", {
      action: "next",
      processId: debugProcessId,
    });
    expect(debugStep.content[0]?.text).toContain(`${debugPath}:3:`);
    const debugComplete = await debuggerTool.execute(
      "live-coder-debug-continue",
      {
        action: "continue",
        processId: debugProcessId,
      },
    );
    expect(debugComplete.content[0]?.text).toContain("Target exit code: 0");
    const candidateCommand = await command.execute("live-coder-command", {
      runtime: "node",
      args: [
        "-e",
        [
          "const fs = require('node:fs');",
          "const ts = require('typescript');",
          "const api = fs.readFileSync(process.argv[1], 'utf8');",
          "const consumer = fs.readFileSync(process.argv[2], 'utf8');",
          "if (typeof ts.version !== 'string' || !api.includes('canonicalName') || !consumer.includes('canonicalName')) process.exit(9);",
          "console.log('candidate-command-ok');",
        ].join(""),
        apiPath,
        consumerPath,
      ],
      timeoutMs: 30_000,
    });
    expect(candidateCommand.content[0]?.text).toContain("candidate-command-ok");
    expect(candidateCommand.details).toEqual(
      expect.objectContaining({
        runtime: "node",
        status: "succeeded",
        workspaceAccess: "read_only",
        networkAccess: "denied",
      }),
    );
    const candidateDiagnostics = await lsp.execute("live-coder-lsp", {
      path: apiPath,
      timeoutMs: 30_000,
    });
    expect(candidateDiagnostics.details).toEqual(
      expect.objectContaining({ status: "clean", errorCount: 0 }),
    );
    const candidateTests = await verify.execute("live-coder-test", {
      kind: "test",
      target: testPath,
      timeoutMs: 60_000,
    });
    expect(candidateTests.details).toEqual(
      expect.objectContaining({
        status: "passed",
        toolchainExternal: true,
      }),
    );
    const preview = await manager.storePreview(worktree, "f".repeat(64));
    expect(preview).toEqual(
      expect.objectContaining({
        changedFileCount: 3,
        addedFileCount: 0,
        modifiedFileCount: 3,
        deletedFileCount: 0,
        renamedFileCount: 0,
        candidateCommands: expect.objectContaining({
          attemptCount: 1,
          freshCount: 1,
          succeededCount: 1,
          failedCount: 0,
          staleCount: 0,
        }),
      }),
    );
    expect(preview.candidateVerification).toEqual(
      expect.objectContaining({
        attemptCount: 2,
        freshCount: 2,
        passedCount: 2,
        failedCount: 0,
        staleCount: 0,
      }),
    );

    await expect(
      readFile(path.join(workspaceRoot, apiPath), "utf8"),
    ).resolves.toContain("currentName");
    const applied = await manager.apply(preview.id);

    expect(applied.details).toEqual(
      expect.objectContaining({
        status: "applied",
        postcondition: "verified",
        fileCount: 3,
        candidateAddedFileCount: 0,
        candidateModifiedFileCount: 3,
        candidateDeletedFileCount: 0,
        candidateRenamedFileCount: 0,
        diagnostics: expect.objectContaining({
          status: "clean",
          fileCount: 3,
        }),
        tests: expect.objectContaining({
          status: "passed",
          changedFileCount: 3,
          selectedTestCount: 1,
        }),
        candidateVerificationAttemptCount: 2,
        candidateVerificationFreshCount: 2,
        candidateVerificationPassedCount: 2,
        candidateVerificationFailedCount: 0,
        candidateVerificationStaleCount: 0,
        candidateCommandAttemptCount: 1,
        candidateCommandFreshCount: 1,
        candidateCommandSucceededCount: 1,
        candidateCommandFailedCount: 0,
        candidateCommandStaleCount: 0,
      }),
    );
    expect(applied.summary).toContain(testPath);
    await expect(
      readFile(path.join(workspaceRoot, apiPath), "utf8"),
    ).resolves.toContain("canonicalName");
    await expect(
      readFile(path.join(workspaceRoot, consumerPath), "utf8"),
    ).resolves.toContain("canonicalName");
    await expect(
      readFile(path.join(workspaceRoot, debugPath), "utf8"),
    ).resolves.toContain("debugValue(4)");
    expect(JSON.stringify(applied.details)).not.toContain(apiPath);
    expect(JSON.stringify(applied.details)).not.toContain(debugPath);
    expect(JSON.stringify(applied.details)).not.toContain(preview.id);
    expect(
      (await processes.list(thread.id)).filter(
        (session) => session.status === "running",
      ),
    ).toEqual([]);
  }, 120_000);
});

function directProcessAdapter(): OsSandboxAdapter {
  return {
    id: "direct-coder-subagent-smoke",
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
          if (
            child.exitCode === null &&
            child.signalCode === null &&
            child.pid !== undefined
          ) {
            try {
              process.kill(-child.pid, "SIGTERM");
            } catch {
              child.kill("SIGTERM");
            }
          }
          await exit;
        },
      };
    },
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
