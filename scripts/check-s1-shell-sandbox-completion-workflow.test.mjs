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

  it.each([
    [
      "external artifact name substitution",
      (source) =>
        source.replace(
          "sandbox-external-publication-${{ inputs.source_sha }}",
          "sandbox-external-publication-latest",
        ),
    ],
    [
      "download run substitution",
      (source) =>
        source.replace(
          "run-id: ${{ inputs.windows_host_run_id }}",
          "run-id: ${{ github.run_id }}",
        ),
    ],
    [
      "authority step removal",
      (source) =>
        source.replace(
          "      - name: Verify exact upstream workflow run authorities",
          "      - name: Trust successful workflow statuses",
        ),
    ],
    [
      "token in argv",
      (source) =>
        source.replace(
          "--config -",
          '--header "Authorization: Bearer ${GITHUB_TOKEN}"',
        ),
    ],
    [
      "authority failure cleanup removal",
      (source) =>
        source.replace("          trap cleanup_raw_authority EXIT\n", ""),
    ],
    [
      "authority cross-wiring",
      (source) =>
        source.replace(
          "--external-publication-authority upstream/authority/external_publication.json",
          "--external-publication-authority upstream/authority/windows_host_product_acceptance.json",
        ),
    ],
    [
      "authority output omission",
      (source) =>
        source.replace(
          "          cp \\\n            upstream/authority/windows_host_product_acceptance.json \\\n            completion-output/windows-host-run-authority.json\n",
          "",
        ),
    ],
    [
      "completion-only upload",
      (source) =>
        source.replace(
          "          path: completion-output/",
          "          path: completion-output/s1-shell-sandbox-completion.json",
        ),
    ],
    [
      "main-tip weakening",
      (source) =>
        source.replace(
          'test "$(git rev-parse origin/main)" = "${SOURCE_SHA}"',
          'git merge-base --is-ancestor "${SOURCE_SHA}" origin/main',
        ),
    ],
    [
      "completion assertion weakening",
      (source) =>
        source.replace('.status == "complete"', '.status == "blocked"'),
    ],
    [
      "cleanup condition removal",
      (source) =>
        source.replace(
          "      - name: Remove downloaded and generated evidence\n        if: always()",
          "      - name: Remove downloaded and generated evidence",
        ),
    ],
  ])("rejects %s", async (_name, mutate) => {
    const root = await fixtureRoot(mutate);
    const result = await auditS1ShellSandboxCompletionWorkflow({
      repoRoot: root,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
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
  const mutated = mutate(source);
  expect(mutated).not.toBe(source);
  await writeFile(target, mutated);
  return root;
}
