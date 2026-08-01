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
import { SubagentWorktreeMutationManager } from "../src/subagent-worktree-mutation.js";
import { WriteLinkedTestVerificationRunner } from "../src/write-linked-test-verification.js";

const describeLive =
  process.env["NAPIER_LIVE_CODER_SUBAGENT_SMOKE"] === "1"
    ? describe
    : describe.skip;
const cleanupTargets: string[] = [];

afterEach(async () => {
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
    const fixtureName = `.subagent-coder-live-${suffix}`;
    const fixtureRoot = path.join(workspaceRoot, fixtureName);
    const dataRoot = await mkdtemp(
      path.join(tmpdir(), "napier-coder-live-data-"),
    );
    cleanupTargets.push(fixtureRoot, dataRoot);
    await Promise.all([
      mkdir(path.join(fixtureRoot, "src"), { recursive: true }),
      mkdir(path.join(fixtureRoot, "test"), { recursive: true }),
    ]);
    const sourcePath = `${fixtureName}/src/value.ts`;
    const addedPath = `${fixtureName}/src/added.ts`;
    const deletedPath = `${fixtureName}/src/deleted.ts`;
    const movedPath = `${fixtureName}/src/move.ts`;
    const renamedPath = `${fixtureName}/src/renamed.ts`;
    const testPath = `${fixtureName}/test/value.test.ts`;
    const source = "export const liveCoderValue = 1;\n";
    const deleted = "export const deletedValue = 99;\n";
    const moved = "export const movedValue = 3;\n";
    const added = "export const addedValue = 2;\n";
    await Promise.all([
      writeFile(path.join(workspaceRoot, sourcePath), source),
      writeFile(path.join(workspaceRoot, deletedPath), deleted),
      writeFile(path.join(workspaceRoot, movedPath), moved),
      writeFile(
        path.join(workspaceRoot, testPath),
        [
          'import { expect, test } from "vitest";',
          'import { liveCoderValue } from "../src/value.js";',
          'import { addedValue } from "../src/added.js";',
          'import { movedValue } from "../src/renamed.js";',
          'test("coder value", () => expect(liveCoderValue + addedValue + movedValue).toBe(7));',
          "",
        ].join("\n"),
      ),
    ]);
    const sandbox = directSandbox();
    const manager = new SubagentWorktreeMutationManager({
      workspaceRoot,
      dataRoot,
      ownerId: `worker_live_${suffix}`,
      sandbox,
      enableCandidateVerification: true,
      tests: new WriteLinkedTestVerificationRunner({
        workspaceRoot,
        sandbox,
      }),
    });
    const worktree = await manager.createWorktree("task_livecoder1", [
      addedPath,
      deletedPath,
      movedPath,
      renamedPath,
      sourcePath,
    ]);
    const tools = manager.createCoderTools(worktree);
    const patch = tools.find((tool) => tool.name === "apply_patch")!;
    const lsp = tools.find((tool) => tool.name === "lsp_diagnostics")!;
    const verify = tools.find((tool) => tool.name === "verify_workspace")!;
    const candidateFile = tools.find((tool) => tool.name === "candidate_file")!;
    await patch.execute("live-coder-patch", {
      operation: "replace",
      path: sourcePath,
      expectedSha256: sha256(source),
      edits: [{ oldText: "= 1", newText: "= 2" }],
    });
    await patch.execute("live-coder-add", {
      operation: "create",
      path: addedPath,
      expectedSha256: null,
      content: added,
    });
    await candidateFile.execute("live-coder-delete", {
      operation: "delete",
      path: deletedPath,
      expectedSha256: sha256(deleted),
    });
    await candidateFile.execute("live-coder-move", {
      operation: "move",
      sourcePath: movedPath,
      destinationPath: renamedPath,
      expectedSourceSha256: sha256(moved),
      expectedDestinationSha256: null,
    });
    const candidateDiagnostics = await lsp.execute("live-coder-lsp", {
      path: sourcePath,
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
        changedFileCount: 5,
        addedFileCount: 2,
        modifiedFileCount: 1,
        deletedFileCount: 2,
        renamedFileCount: 1,
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

    expect(await readFile(path.join(workspaceRoot, sourcePath), "utf8")).toBe(
      source,
    );
    await expect(
      readFile(path.join(workspaceRoot, addedPath)),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const applied = await manager.apply(preview.id);

    expect(applied.details).toEqual(
      expect.objectContaining({
        status: "applied",
        postcondition: "verified",
        fileCount: 5,
        candidateAddedFileCount: 2,
        candidateModifiedFileCount: 1,
        candidateDeletedFileCount: 2,
        candidateRenamedFileCount: 1,
        diagnostics: expect.objectContaining({ status: "clean" }),
        tests: expect.objectContaining({
          status: "passed",
          selectedTestCount: 1,
        }),
        candidateVerificationAttemptCount: 2,
        candidateVerificationFreshCount: 2,
        candidateVerificationPassedCount: 2,
        candidateVerificationFailedCount: 0,
        candidateVerificationStaleCount: 0,
      }),
    );
    expect(applied.summary).toContain(testPath);
    expect(await readFile(path.join(workspaceRoot, sourcePath), "utf8")).toBe(
      "export const liveCoderValue = 2;\n",
    );
    await expect(
      readFile(path.join(workspaceRoot, addedPath), "utf8"),
    ).resolves.toBe(added);
    await expect(
      readFile(path.join(workspaceRoot, renamedPath), "utf8"),
    ).resolves.toBe(moved);
    await expect(
      readFile(path.join(workspaceRoot, deletedPath)),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(path.join(workspaceRoot, movedPath)),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(JSON.stringify(applied.details)).not.toContain(sourcePath);
    expect(JSON.stringify(applied.details)).not.toContain(preview.id);
  }, 120_000);
});

function directSandbox(): OsSandboxAdapter {
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
