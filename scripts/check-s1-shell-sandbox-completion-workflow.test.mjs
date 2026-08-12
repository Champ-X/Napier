import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { auditS1ShellSandboxCompletionWorkflow } from "./check-s1-shell-sandbox-completion-workflow.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("S1 Shell/Sandbox completion workflow", () => {
  it("accepts the current manual exact-receipt aggregator", async () => {
    await expect(auditS1ShellSandboxCompletionWorkflow()).resolves.toEqual({
      valid: true,
      errors: [],
      path: ".github/workflows/s1-shell-sandbox-completion.yml",
    });
  });

  it("rejects automatic triggers, write permissions, and unpinned actions", async () => {
    for (const mutate of [
      (source) =>
        source.replace(
          "on:\n  workflow_dispatch:",
          "on:\n  push:\n    branches: [main]\n  workflow_dispatch:",
        ),
      (source) =>
        source.replace(
          "permissions:\n  actions: read\n  contents: read",
          "permissions:\n  actions: write\n  contents: write",
        ),
      (source) =>
        source.replace(
          "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093",
          "actions/download-artifact@v4",
        ),
    ]) {
      const root = await fixtureRoot(mutate);
      const result = await auditS1ShellSandboxCompletionWorkflow({
        repoRoot: root,
      });

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it("rejects artifact-name, run-id, SHA, and completion assertion weakening", async () => {
    for (const mutate of [
      (source) =>
        source.replace(
          "sandbox-external-publication-${{ inputs.source_sha }}",
          "sandbox-external-publication-latest",
        ),
      (source) =>
        source.replace(
          "run-id: ${{ inputs.windows_host_run_id }}",
          "run-id: ${{ github.run_id }}",
        ),
      (source) =>
        source.replace(
          'test "$(git rev-parse origin/main)" = "${SOURCE_SHA}"',
          'git merge-base --is-ancestor "${SOURCE_SHA}" origin/main',
        ),
      (source) =>
        source.replace('.status == "complete"', '.status == "blocked"'),
      (source) =>
        source.replace(
          "      - name: Remove downloaded and generated evidence\n        if: always()",
          "      - name: Remove downloaded and generated evidence",
        ),
    ]) {
      const root = await fixtureRoot(mutate);
      const result = await auditS1ShellSandboxCompletionWorkflow({
        repoRoot: root,
      });

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });
});

async function fixtureRoot(mutate) {
  const root = await mkdtemp(path.join(tmpdir(), "napier-s1-workflow-"));
  roots.push(root);
  const relative = ".github/workflows/s1-shell-sandbox-completion.yml";
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(path.resolve(relative), target);
  const source = await readFile(target, "utf8");
  await writeFile(target, mutate(source));
  return root;
}
