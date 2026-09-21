import { test, expect } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  stat,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import {
  createObservedWorkspaceReceipt,
  copyObservedWorkspace,
} from "./harness-observed-workspace.mjs";
import { buildFailureCase } from "./harness-campaign-evidence.mjs";
const hash = (b) => createHash("sha256").update(b).digest("hex");
async function fixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "napier-observed-"));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("settled bytes bind to a Run and omit the grader introduced afterward", () =>
  fixture(async (root) => {
    const source = path.join(root, "source");
    await mkdir(source);
    await writeFile(path.join(source, "a.mjs"), "final");
    await writeFile(
      path.join(source, "__napier_external_grader__.mjs"),
      "grader",
    );
    const receipt = createObservedWorkspaceReceipt("run_a", {
      "a.mjs": hash("final"),
    });
    const out = path.join(root, "out");
    const result = await copyObservedWorkspace({
      root: source,
      output: out,
      receipt,
      runId: "run_a",
    });
    expect(result.fileCount).toBe(1);
    expect(result.bytes).toBe(5);
    expect(await readFile(path.join(out, "a.mjs"), "utf8")).toBe("final");
    expect((await stat(out)).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(out, "a.mjs"))).mode & 0o777).toBe(0o600);
    await expect(
      readFile(path.join(out, "__napier_external_grader__.mjs")),
    ).rejects.toThrow();
    await expect(
      copyObservedWorkspace({
        root: source,
        output: path.join(root, "foreign"),
        receipt,
        runId: "run_b",
      }),
    ).rejects.toThrow(/foreign/);
    receipt.files["a.mjs"] = hash("other");
    await expect(
      copyObservedWorkspace({
        root: source,
        output: path.join(root, "tampered"),
        receipt,
        runId: "run_a",
      }),
    ).rejects.toThrow(/changed/);
  }));
test("drift, additional files, links and private paths cannot be exported as settled state", () =>
  fixture(async (root) => {
    const source = path.join(root, "source");
    await mkdir(source);
    await writeFile(path.join(source, "a"), "before");
    const receipt = createObservedWorkspaceReceipt("run_a", {
      a: hash("before"),
    });
    await writeFile(path.join(source, "a"), "after");
    await expect(
      copyObservedWorkspace({
        root: source,
        output: path.join(root, "drift"),
        receipt,
        runId: "run_a",
      }),
    ).rejects.toThrow(/bytes changed/);
    await writeFile(path.join(source, "a"), "before");
    await writeFile(path.join(source, "extra"), "x");
    await expect(
      copyObservedWorkspace({
        root: source,
        output: path.join(root, "extra"),
        receipt,
        runId: "run_a",
      }),
    ).rejects.toThrow(/file set changed/);
    await rm(path.join(source, "extra"));
    await rm(path.join(source, "a"));
    await symlink(path.join(root, "elsewhere"), path.join(source, "a"));
    await expect(
      copyObservedWorkspace({
        root: source,
        output: path.join(root, "link"),
        receipt,
        runId: "run_a",
      }),
    ).rejects.toThrow(/links/);
    const privateReceipt = createObservedWorkspaceReceipt("run_a", {
      ".env": hash("secret"),
    });
    await expect(
      copyObservedWorkspace({
        root: source,
        output: path.join(root, "private"),
        receipt: privateReceipt,
        runId: "run_a",
      }),
    ).rejects.toThrow(/private/);
    expect(() =>
      createObservedWorkspaceReceipt("run_a", { "../escape": hash("x") }),
    ).toThrow(/entry/);
  }));
test("byte limits reject oversized evidence before copying it", () =>
  fixture(async (root) => {
    const source = path.join(root, "source");
    await mkdir(source);
    const bytes = Buffer.alloc(16 * 1024 * 1024 + 1);
    await writeFile(path.join(source, "large"), bytes);
    const receipt = createObservedWorkspaceReceipt("run_a", {
      large: hash(bytes),
    });
    await expect(
      copyObservedWorkspace({
        root: source,
        output: path.join(root, "out"),
        receipt,
        runId: "run_a",
      }),
    ).rejects.toThrow(/byte limit/);
  }));
test("failure bundle keeps original and observed states separate and rolls back failed export", () =>
  fixture(async (root) => {
    const original = path.join(root, "case"),
      workspace = path.join(root, "workspace");
    await mkdir(path.join(original, "fixture"), { recursive: true });
    await mkdir(workspace);
    await writeFile(path.join(original, "fixture/a"), "before");
    await writeFile(path.join(original, "prompt.md"), "repair");
    await writeFile(path.join(original, "outcome.mjs"), "grade");
    await writeFile(
      path.join(original, "manifest.json"),
      JSON.stringify({
        id: "case_a",
        fixturePath: "fixture",
        promptPath: "prompt.md",
        outcomeTestPath: "outcome.mjs",
      }),
    );
    await writeFile(path.join(workspace, "a"), "after");
    const report = {
      qualifyingEvidence: true,
      runtimeArtifactStable: true,
      sourceStable: true,
      servingIdentityMatched: true,
      runtimeArtifactSha256: hash("runtime"),
      taskSuccess: false,
      allowedChanges: true,
      caseId: "case_a",
      runId: "run_a",
      toolFailures: 0,
      fixtureSha256: hash(JSON.stringify({ a: hash("before") })),
      promptSha256: hash("repair"),
      outcomeSha256: hash("grade"),
      observedWorkspace: createObservedWorkspaceReceipt("run_a", {
        a: hash("after"),
      }),
    };
    const output = path.join(root, "bundle");
    const result = await buildFailureCase({
      report,
      caseRoot: original,
      output,
      observedWorkspaceRoot: workspace,
    });
    expect(await readFile(path.join(output, "fixture/a"), "utf8")).toBe(
      "before",
    );
    expect(await readFile(path.join(output, "observed/a"), "utf8")).toBe(
      "after",
    );
    expect(result.observedWorkspace.receipt.runId).toBe("run_a");
    expect(await readFile(path.join(workspace, "a"), "utf8")).toBe("after");
    await writeFile(path.join(workspace, "a"), "drift");
    const bad = path.join(root, "bad");
    await expect(
      buildFailureCase({
        report,
        caseRoot: original,
        output: bad,
        observedWorkspaceRoot: workspace,
      }),
    ).rejects.toThrow(/bytes changed/);
    await expect(stat(bad)).rejects.toThrow();
    const old = { ...report };
    delete old.observedWorkspace;
    await expect(
      buildFailureCase({
        report: old,
        caseRoot: original,
        output: path.join(root, "legacy-with-output"),
        observedWorkspaceRoot: workspace,
      }),
    ).rejects.toThrow(/missing/);
    await expect(
      buildFailureCase({
        report: old,
        caseRoot: original,
        output: path.join(root, "legacy"),
      }),
    ).resolves.toBeDefined();
  }));
