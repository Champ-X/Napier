import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { auditSandboxExternalReleaseWorkflow } from "./check-sandbox-external-release-workflow.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Sandbox external release workflow", () => {
  it("accepts the current manual, SHA-pinned public release gate", async () => {
    await expect(auditSandboxExternalReleaseWorkflow()).resolves.toEqual({
      valid: true,
      errors: [],
      path: ".github/workflows/publish-sandbox.yml",
    });
  });

  it("rejects automatic triggers and unpinned actions", async () => {
    for (const mutate of [
      (source) =>
        source.replace(
          "on:\n  workflow_dispatch:",
          "on:\n  push:\n    branches: [main]\n  workflow_dispatch:",
        ),
      (source) =>
        source.replace(
          "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803",
          "actions/checkout@v6",
        ),
      (source) =>
        source.replace(
          "expected_sha256=90956cd1bb92472d498370819c8f5fae4bbc7f851b989240ec416b173a44f7cb",
          "expected_sha256=unverified",
        ),
      (source) =>
        source.replace(
          "process.stdout.write(chromium.executablePath())",
          'process.stdout.write("/tmp/unbound-browser")',
        ),
      (source) =>
        source.replace(
          "      - name: Build the production Web distribution\n        run: npm run build -w @napier/web\n\n",
          "",
        ),
    ]) {
      const root = await fixtureRoot(mutate);
      const result = await auditSandboxExternalReleaseWorkflow({
        repoRoot: root,
      });

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it("rejects missing release conditions, anonymous pull, and evidence replay", async () => {
    for (const mutate of [
      (source) =>
        source.replace(
          "if: inputs.mode == 'release'\n        env:\n          DIGEST:",
          "if: inputs.mode == 'bootstrap'\n        env:\n          DIGEST:",
        ),
      (source) =>
        source.replace(
          'docker --config "${anonymous_config}" pull --platform',
          "docker pull --platform",
        ),
      (source) =>
        source.replace(
          'writeSandboxExternalPublicationReceipt("release-evidence")',
          'writeSandboxExternalPublicationReceipt("other-evidence")',
        ),
      (source) =>
        source.replace(
          'verifySandboxExternalPublicationEvidence("release-evidence")',
          'verifySandboxExternalPublicationEvidence("other-evidence")',
        ),
    ]) {
      const root = await fixtureRoot(mutate);
      const result = await auditSandboxExternalReleaseWorkflow({
        repoRoot: root,
      });

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });
});

async function fixtureRoot(mutate) {
  const root = await mkdtemp(path.join(tmpdir(), "napier-release-workflow-"));
  roots.push(root);
  const relative = ".github/workflows/publish-sandbox.yml";
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(path.resolve(relative), target);
  const source = await readFile(target, "utf8");
  await writeFile(target, mutate(source));
  return root;
}
