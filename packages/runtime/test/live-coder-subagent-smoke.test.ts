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
    const testPath = `${fixtureName}/test/value.test.ts`;
    const source = "export const liveCoderValue = 1;\n";
    await Promise.all([
      writeFile(path.join(workspaceRoot, sourcePath), source),
      writeFile(
        path.join(workspaceRoot, testPath),
        [
          'import { expect, test } from "vitest";',
          'import { liveCoderValue } from "../src/value.js";',
          'test("coder value", () => expect(liveCoderValue).toBe(2));',
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
      tests: new WriteLinkedTestVerificationRunner({
        workspaceRoot,
        sandbox,
      }),
    });
    const worktree = await manager.createWorktree("task_livecoder1", [
      sourcePath,
    ]);
    const patch = manager
      .createCoderTools(worktree)
      .find((tool) => tool.name === "apply_patch")!;
    await patch.execute("live-coder-patch", {
      operation: "replace",
      path: sourcePath,
      expectedSha256: sha256(source),
      edits: [{ oldText: "= 1", newText: "= 2" }],
    });
    const preview = await manager.storePreview(worktree, "f".repeat(64));

    expect(await readFile(path.join(workspaceRoot, sourcePath), "utf8")).toBe(
      source,
    );
    const applied = await manager.apply(preview.id);

    expect(applied.details).toEqual(
      expect.objectContaining({
        status: "applied",
        postcondition: "verified",
        fileCount: 1,
        diagnostics: expect.objectContaining({ status: "clean" }),
        tests: expect.objectContaining({
          status: "passed",
          selectedTestCount: 1,
        }),
      }),
    );
    expect(applied.summary).toContain(testPath);
    expect(await readFile(path.join(workspaceRoot, sourcePath), "utf8")).toBe(
      "export const liveCoderValue = 2;\n",
    );
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
