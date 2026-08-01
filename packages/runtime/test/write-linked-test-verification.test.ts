import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { SelectedTestExecutionResult } from "../src/verification.js";
import { WriteLinkedTestVerificationRunner } from "../src/write-linked-test-verification.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("write-linked test verification", () => {
  it("runs only selected tests and returns a hash-only passing receipt", async () => {
    const workspaceRoot = await createWorkspace();
    const source = "export const value = 1;\n";
    await writeFile(path.join(workspaceRoot, "src/value.ts"), source);
    await writeFile(
      path.join(workspaceRoot, "test/value.test.ts"),
      'import { value } from "../src/value.js"; export const observed = value;\n',
    );
    const runSelectedTests = vi
      .fn()
      .mockResolvedValue(executionResult("passed"));
    const runner = new WriteLinkedTestVerificationRunner({
      workspaceRoot,
      sandbox: { id: "unused", launch: vi.fn() },
      verificationRunner: { runSelectedTests },
    });

    const result = await runner.run([
      { path: "src/value.ts", expectedSha256: sha256(source) },
    ]);

    expect(runSelectedTests).toHaveBeenCalledWith(
      ["test/value.test.ts"],
      60_000,
      undefined,
    );
    expect(result.details).toEqual(
      expect.objectContaining({
        kind: "napier.write-linked-test-verification",
        schemaVersion: 2,
        status: "passed",
        changedFileCount: 1,
        configurationFileCount: 0,
        workspacePackageCount: 0,
        pathAliasCount: 0,
        workspacePackageEdgeCount: 0,
        pathAliasEdgeCount: 0,
        selectedTestCount: 1,
        graphTruncated: false,
        verifierSha256: "1".repeat(64),
        stdoutSha256: "2".repeat(64),
        stderrSha256: "3".repeat(64),
        resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(JSON.stringify(result.details)).not.toContain("value.test.ts");
    expect(result.summary).toContain("test/value.test.ts");
  });

  it("preserves failed, timed-out, output-capped, and drifted outcomes", async () => {
    for (const status of ["failed", "timed_out", "output_capped"] as const) {
      const workspaceRoot = await createWorkspace();
      const source = `export const value = ${JSON.stringify(status)};\n`;
      await writeFile(path.join(workspaceRoot, "src/value.ts"), source);
      await writeFile(
        path.join(workspaceRoot, "test/value.test.ts"),
        'import "../src/value.js";\n',
      );
      const runner = new WriteLinkedTestVerificationRunner({
        workspaceRoot,
        sandbox: { id: "unused", launch: vi.fn() },
        verificationRunner: {
          runSelectedTests: vi.fn().mockResolvedValue(executionResult(status)),
        },
      });
      const result = await runner.run([
        { path: "src/value.ts", expectedSha256: sha256(source) },
      ]);
      expect(result.details.status).toBe(status);
    }

    const workspaceRoot = await createWorkspace();
    const source = "export const value = 'before';\n";
    await writeFile(path.join(workspaceRoot, "src/value.ts"), source);
    await writeFile(
      path.join(workspaceRoot, "test/value.test.ts"),
      'import "../src/value.js";\n',
    );
    const runner = new WriteLinkedTestVerificationRunner({
      workspaceRoot,
      sandbox: { id: "unused", launch: vi.fn() },
      verificationRunner: {
        async runSelectedTests() {
          await writeFile(
            path.join(workspaceRoot, "src/value.ts"),
            "export const value = 'external drift';\n",
          );
          return executionResult("passed");
        },
      },
    });
    const drifted = await runner.run([
      { path: "src/value.ts", expectedSha256: sha256(source) },
    ]);
    expect(drifted.details).toEqual(
      expect.objectContaining({
        status: "drifted",
        observedSnapshotSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(drifted.details.observedSnapshotSha256).not.toBe(
      drifted.details.selectionSnapshotSha256,
    );

    const missingRoot = await createWorkspace();
    await Promise.all([
      writeFile(path.join(missingRoot, "src/value.ts"), source),
      writeFile(
        path.join(missingRoot, "test/value.test.ts"),
        'import "../src/value.js";\n',
      ),
    ]);
    const appeared = await new WriteLinkedTestVerificationRunner({
      workspaceRoot: missingRoot,
      sandbox: { id: "unused", launch: vi.fn() },
      verificationRunner: {
        async runSelectedTests() {
          await writeFile(
            path.join(missingRoot, "tsconfig.json"),
            JSON.stringify({ compilerOptions: { baseUrl: "." } }),
          );
          return executionResult("passed");
        },
      },
    }).run([{ path: "src/value.ts", expectedSha256: sha256(source) }]);
    expect(appeared.details).toEqual(
      expect.objectContaining({
        status: "drifted",
        configurationFileCount: 0,
      }),
    );
  });

  it("rejects a passing test when module-resolution config drifts", async () => {
    const workspaceRoot = await createWorkspace();
    const source = "export const value = 1;\n";
    await Promise.all([
      writeFile(path.join(workspaceRoot, "src/value.ts"), source),
      writeFile(
        path.join(workspaceRoot, "test/value.test.ts"),
        'import "../src/value.js";\n',
      ),
      writeFile(
        path.join(workspaceRoot, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { baseUrl: "." } }),
      ),
    ]);
    const runner = new WriteLinkedTestVerificationRunner({
      workspaceRoot,
      sandbox: { id: "unused", launch: vi.fn() },
      verificationRunner: {
        async runSelectedTests() {
          await writeFile(
            path.join(workspaceRoot, "tsconfig.json"),
            JSON.stringify({ compilerOptions: { baseUrl: "./src" } }),
          );
          return executionResult("passed");
        },
      },
    });

    const drifted = await runner.run([
      { path: "src/value.ts", expectedSha256: sha256(source) },
    ]);

    expect(drifted.details).toEqual(
      expect.objectContaining({
        schemaVersion: 2,
        status: "drifted",
        configurationFileCount: 1,
        observedSnapshotSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(drifted.details.observedSnapshotSha256).not.toBe(
      drifted.details.selectionSnapshotSha256,
    );
  });

  it("does not execute when no test matches or selection is incomplete", async () => {
    const workspaceRoot = await createWorkspace();
    const source = "export const value = 1;\n";
    await writeFile(path.join(workspaceRoot, "src/value.ts"), source);
    const runSelectedTests = vi.fn();
    const runner = new WriteLinkedTestVerificationRunner({
      workspaceRoot,
      sandbox: { id: "unused", launch: vi.fn() },
      verificationRunner: { runSelectedTests },
    });

    const noMatch = await runner.run([
      { path: "src/value.ts", expectedSha256: sha256(source) },
    ]);
    expect(noMatch.details.status).toBe("no_match");

    const incomplete =
      'import { missing } from "./missing.js"; export const value = missing;\n';
    await writeFile(path.join(workspaceRoot, "src/value.ts"), incomplete);
    const unavailable = await runner.run([
      { path: "src/value.ts", expectedSha256: sha256(incomplete) },
    ]);
    expect(unavailable.details.status).toBe("selection_incomplete");
    expect(runSelectedTests).not.toHaveBeenCalled();
  });

  it("classifies cancellation and verifier failure without hiding the write", async () => {
    const workspaceRoot = await createWorkspace();
    const source = "export const value = 1;\n";
    await writeFile(path.join(workspaceRoot, "src/value.ts"), source);
    await writeFile(
      path.join(workspaceRoot, "test/value.test.ts"),
      'import "../src/value.js";\n',
    );
    const controller = new AbortController();
    controller.abort();
    const cancelled = await new WriteLinkedTestVerificationRunner({
      workspaceRoot,
      sandbox: { id: "unused", launch: vi.fn() },
      verificationRunner: { runSelectedTests: vi.fn() },
    }).run(
      [{ path: "src/value.ts", expectedSha256: sha256(source) }],
      undefined,
      controller.signal,
    );
    expect(cancelled.details.status).toBe("cancelled");

    const unavailable = await new WriteLinkedTestVerificationRunner({
      workspaceRoot,
      sandbox: { id: "unused", launch: vi.fn() },
      verificationRunner: {
        runSelectedTests: vi
          .fn()
          .mockRejectedValue(new Error("PRIVATE_VERIFIER_FAILURE")),
      },
    }).run([{ path: "src/value.ts", expectedSha256: sha256(source) }]);
    expect(unavailable.details).toEqual(
      expect.objectContaining({
        status: "unavailable",
        errorSha256: sha256("PRIVATE_VERIFIER_FAILURE"),
      }),
    );
    expect(JSON.stringify(unavailable.details)).not.toContain("PRIVATE");

    const sandboxBlocked = await new WriteLinkedTestVerificationRunner({
      workspaceRoot,
      sandbox: { id: "unused", launch: vi.fn() },
      verificationRunner: {
        runSelectedTests: vi.fn().mockResolvedValue({
          ...executionResult("failed"),
          exitCode: 71,
          stderr:
            "sandbox-exec: sandbox_apply: Operation not permitted\nPRIVATE_HOST_DETAIL",
          stderrSha256: "4".repeat(64),
        }),
      },
    }).run([{ path: "src/value.ts", expectedSha256: sha256(source) }]);
    expect(sandboxBlocked.details).toEqual(
      expect.objectContaining({
        status: "unavailable",
        exitCode: 71,
        errorSha256: sha256(
          "sandbox-exec: sandbox_apply: Operation not permitted\nPRIVATE_HOST_DETAIL",
        ),
      }),
    );
    expect(JSON.stringify(sandboxBlocked.details)).not.toContain("PRIVATE");
  });
});

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-linked-verify-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await Promise.all([
    mkdir(path.join(workspaceRoot, "src"), { recursive: true }),
    mkdir(path.join(workspaceRoot, "test"), { recursive: true }),
  ]);
  return workspaceRoot;
}

function executionResult(
  status: SelectedTestExecutionResult["status"],
): SelectedTestExecutionResult {
  return {
    status,
    sandbox: "fake-test-sandbox",
    verifierSha256: "1".repeat(64),
    durationMs: 5,
    exitCode: status === "passed" ? 0 : 1,
    signal: null,
    stdout: "PRIVATE_TEST_OUTPUT",
    stderr: "",
    stdoutSha256: "2".repeat(64),
    stderrSha256: "3".repeat(64),
    stdoutTruncated: status === "output_capped",
    stderrTruncated: false,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
