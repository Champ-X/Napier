import {
  mkdir,
  mkdtemp,
  rename,
  unlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { sha256 } from "../src/ed25519.js";
import type { SelectedTestExecutionResult } from "../src/verification.js";
import type { WriteLinkedLifecycleFile } from "../src/write-linked-test-lifecycle.js";
import { WriteLinkedTestVerificationRunner } from "../src/write-linked-test-verification.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("write-linked lifecycle test verification", () => {
  it("executes the stable union selected from old and new graphs", async () => {
    const workspaceRoot = await createWorkspace();
    const oldSource = "export const oldValue = 1;\n";
    const newSource = "export const newValue = 2;\n";
    await Promise.all([
      writeFile(path.join(workspaceRoot, "src/old.ts"), oldSource),
      writeFile(
        path.join(workspaceRoot, "test/old.test.ts"),
        'import { oldValue } from "../src/old.js"; export const observed = oldValue;\n',
      ),
      writeFile(
        path.join(workspaceRoot, "test/new.test.ts"),
        'import { newValue } from "../src/new.js"; export const observed = newValue;\n',
      ),
    ]);
    const files = [
      lifecycleFile("src/new.ts", null, newSource),
      lifecycleFile("src/old.ts", oldSource, null),
    ];
    const runSelectedTests = vi
      .fn()
      .mockResolvedValue(executionResult("passed"));
    const runner = createRunner(workspaceRoot, runSelectedTests);
    const before = await runner.captureLifecycleBefore(files);

    await Promise.all([
      writeFile(path.join(workspaceRoot, "src/new.ts"), newSource),
      unlink(path.join(workspaceRoot, "src/old.ts")),
    ]);
    const result = await runner.runLifecycle(files, before);

    expect(runSelectedTests).toHaveBeenCalledWith(
      ["test/new.test.ts", "test/old.test.ts"],
      60_000,
      undefined,
    );
    expect(result.details).toEqual(
      expect.objectContaining({
        schemaVersion: 2,
        status: "passed",
        changedFileCount: 2,
        changedSymbolCount: 2,
        candidateTestCount: 2,
        selectedTestCount: 2,
        graphTruncated: false,
        observedSnapshotSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(result.summary).toContain("test/new.test.ts");
    expect(result.summary).toContain("test/old.test.ts");
    expect(JSON.stringify(result.details)).not.toContain("PRIVATE");
  });

  it("does not execute an incomplete or over-cap old graph", async () => {
    const workspaceRoot = await createWorkspace();
    const source = "export const shared = 1;\n";
    await writeFile(path.join(workspaceRoot, "src/shared.ts"), source);
    for (let index = 0; index < 9; index += 1) {
      await writeFile(
        path.join(workspaceRoot, `test/shared-${String(index)}.test.ts`),
        'import { shared } from "../src/shared.js"; export const observed = shared;\n',
      );
    }
    const files = [lifecycleFile("src/shared.ts", source, null)];
    const runSelectedTests = vi.fn();
    const runner = createRunner(workspaceRoot, runSelectedTests);
    const before = await runner.captureLifecycleBefore(files);
    await unlink(path.join(workspaceRoot, "src/shared.ts"));

    const result = await runner.runLifecycle(files, before);

    expect(result.details).toEqual(
      expect.objectContaining({
        status: "selection_incomplete",
        selectedTestCount: 8,
        omittedTestCount: 1,
        graphTruncated: true,
      }),
    );
    expect(runSelectedTests).not.toHaveBeenCalled();
  });

  it("replaces an intentionally removed test path with its new path", async () => {
    const workspaceRoot = await createWorkspace();
    const source = "export const value = 1;\n";
    const test =
      'import { value } from "../src/value.js"; export const observed = value;\n';
    await Promise.all([
      writeFile(path.join(workspaceRoot, "src/value.ts"), source),
      writeFile(path.join(workspaceRoot, "test/old.test.ts"), test),
    ]);
    const files = [
      lifecycleFile("test/new.test.ts", null, test),
      lifecycleFile("test/old.test.ts", test, null),
    ];
    const runSelectedTests = vi
      .fn()
      .mockResolvedValue(executionResult("passed"));
    const runner = createRunner(workspaceRoot, runSelectedTests);
    const before = await runner.captureLifecycleBefore(files);
    await rename(
      path.join(workspaceRoot, "test/old.test.ts"),
      path.join(workspaceRoot, "test/new.test.ts"),
    );

    const result = await runner.runLifecycle(files, before);

    expect(runSelectedTests).toHaveBeenCalledWith(
      ["test/new.test.ts"],
      60_000,
      undefined,
    );
    expect(result.details).toEqual(
      expect.objectContaining({
        status: "passed",
        changedFileCount: 2,
        selectedTestCount: 1,
      }),
    );
    expect(result.summary).not.toContain("test/old.test.ts");
  });

  it("keeps a failing selected-test outcome explicit and hash-only", async () => {
    const workspaceRoot = await createWorkspace();
    const source = "export const added = 1;\n";
    await writeFile(
      path.join(workspaceRoot, "test/added.test.ts"),
      'import { added } from "../src/added.js"; export const observed = added;\n',
    );
    const files = [lifecycleFile("src/added.ts", null, source)];
    const runner = createRunner(
      workspaceRoot,
      vi.fn().mockResolvedValue(executionResult("failed")),
    );
    const before = await runner.captureLifecycleBefore(files);
    await writeFile(path.join(workspaceRoot, "src/added.ts"), source);

    const result = await runner.runLifecycle(files, before);

    expect(result.details).toEqual(
      expect.objectContaining({
        status: "failed",
        selectedTestCount: 1,
        stdoutSha256: "3".repeat(64),
      }),
    );
    expect(JSON.stringify(result.details)).not.toContain(
      "PRIVATE_LIFECYCLE_TEST_OUTPUT",
    );
  });

  it("rejects a passing union when post-merge bytes drift during execution", async () => {
    const workspaceRoot = await createWorkspace();
    const source = "export const added = 1;\n";
    await writeFile(
      path.join(workspaceRoot, "test/added.test.ts"),
      'import { added } from "../src/added.js"; export const observed = added;\n',
    );
    const files = [lifecycleFile("src/added.ts", null, source)];
    const runner = createRunner(workspaceRoot, async () => {
      await writeFile(
        path.join(workspaceRoot, "test/added.test.ts"),
        'import { added } from "../src/added.js"; export const observed = added + 1;\n',
      );
      return executionResult("passed");
    });
    const before = await runner.captureLifecycleBefore(files);
    await writeFile(path.join(workspaceRoot, "src/added.ts"), source);

    const result = await runner.runLifecycle(files, before);

    expect(result.details).toEqual(
      expect.objectContaining({
        status: "drifted",
        observedSnapshotSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(result.details.observedSnapshotSha256).not.toBe(
      result.details.selectionSnapshotSha256,
    );
  });

  it("keeps pre-commit cancellation mutation-free", async () => {
    const workspaceRoot = await createWorkspace();
    const source = "export const value = 1;\n";
    await writeFile(path.join(workspaceRoot, "src/value.ts"), source);
    const files = [lifecycleFile("src/value.ts", source, `${source}// new\n`)];
    const runSelectedTests = vi.fn();
    const runner = createRunner(workspaceRoot, runSelectedTests);
    const before = await runner.captureLifecycleBefore(files);
    const controller = new AbortController();
    controller.abort();

    const result = await runner.runLifecycle(files, before, controller.signal);

    expect(result.details.status).toBe("cancelled");
    expect(runSelectedTests).not.toHaveBeenCalled();
  });
});

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-linked-lifecycle-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await Promise.all([
    mkdir(path.join(workspaceRoot, "src"), { recursive: true }),
    mkdir(path.join(workspaceRoot, "test"), { recursive: true }),
  ]);
  return workspaceRoot;
}

function createRunner(
  workspaceRoot: string,
  runSelectedTests: (
    targets: string[],
    timeoutMs?: number,
    signal?: AbortSignal,
  ) => Promise<SelectedTestExecutionResult>,
): WriteLinkedTestVerificationRunner {
  return new WriteLinkedTestVerificationRunner({
    workspaceRoot,
    sandbox: { id: "unused", launch: vi.fn() },
    verificationRunner: { runSelectedTests },
  });
}

function lifecycleFile(
  relativePath: string,
  before: string | null,
  after: string | null,
): WriteLinkedLifecycleFile {
  return {
    path: relativePath,
    pathSha256: sha256(relativePath),
    beforeSha256: before === null ? null : sha256(before),
    afterSha256: after === null ? null : sha256(after),
  };
}

function executionResult(
  status: SelectedTestExecutionResult["status"],
): SelectedTestExecutionResult {
  return {
    status,
    sandbox: "fake-lifecycle-sandbox",
    verifierSha256: "1".repeat(64),
    toolchainSha256: "2".repeat(64),
    durationMs: 5,
    exitCode: status === "passed" ? 0 : 1,
    signal: null,
    stdout: "PRIVATE_LIFECYCLE_TEST_OUTPUT",
    stderr: "",
    stdoutSha256: "3".repeat(64),
    stderrSha256: "4".repeat(64),
    stdoutTruncated: status === "output_capped",
    stderrTruncated: false,
  };
}
