import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { applyWorkspacePatch } from "../src/tools.js";
import { createWorkspacePatchTool } from "../src/workspace-patch-tool.js";
import { reconcileSettledWorkspacePatches } from "../src/workspace-patch-reconciliation.js";
import type { SettledPatchRecoveryEvidence } from "../src/run-patch-recovery-evidence.js";
import { sha256 } from "../src/ed25519.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it("checks the newest postcondition across a complete chain of patches and normalized aliases", async () => {
  const fixture = await createFixture();
  const first = await fixture.patch("first");
  const second = await fixture.patch("second", "first");
  await expect(fixture.reconcile([second, first])).resolves.toBeUndefined();
  await writeFile(fixture.file, "first");
  await expect(fixture.reconcile([first, second])).rejects.toThrow(
    "postcondition changed",
  );
});

it("rejects an external edit between settled operations even when the newest file matches", async () => {
  const fixture = await createFixture();
  const first = await fixture.patch("first");
  await writeFile(fixture.file, "external edit");
  const second = await fixture.patch("second", "external edit");
  await expect(fixture.reconcile([first, second])).rejects.toThrow(
    "version chain changed",
  );
  expect(await readFile(fixture.file, "utf8")).toBe("second");
});

it("binds private evidence to the exact call, input and workspace and rejects tampering", async () => {
  const fixture = await createFixture();
  const patch = await fixture.patch("first");
  for (const changed of [
    { ...patch, callId: "another-call" },
    { ...patch, inputSha256: "0".repeat(64) },
  ]) {
    await expect(fixture.reconcile([changed])).rejects.toThrow(
      "binding changed",
    );
  }
  const other = await createFixture();
  await expect(
    reconcileSettledWorkspacePatches(other.workspaceRoot, fixture.dataRoot, [
      patch,
    ]),
  ).rejects.toThrow("binding changed");
  const capsule = path.join(
    fixture.dataRoot,
    "workspace-patch-recovery",
    `${patch.capsuleSha256}.json`,
  );
  const value = JSON.parse(await readFile(capsule, "utf8"));
  value.path = "forged.txt";
  await writeFile(capsule, JSON.stringify(value));
  await expect(fixture.reconcile([patch])).rejects.toThrow(
    "missing or invalid",
  );
});

it("rejects a parent directory replaced by a symlink even when its content matches", async () => {
  const fixture = await createFixture();
  const patch = await fixture.patch("first");
  const otherDirectory = path.join(fixture.workspaceRoot, "elsewhere");
  await mkdir(otherDirectory);
  await writeFile(path.join(otherDirectory, "target.txt"), "first");
  await rm(path.dirname(fixture.file), { recursive: true });
  await symlink(otherDirectory, path.dirname(fixture.file));
  await expect(fixture.reconcile([patch])).rejects.toThrow(
    "postcondition changed",
  );
});

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-patch-chain-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await mkdir(path.join(workspaceRoot, "sub"), { recursive: true });
  const tool = createWorkspacePatchTool({
    workspaceRoot,
    dataRoot,
    applyPatch: applyWorkspacePatch,
  });
  let sequence = 0;
  return {
    workspaceRoot,
    dataRoot,
    file: path.join(workspaceRoot, "sub/target.txt"),
    reconcile: (patches: SettledPatchRecoveryEvidence[]) =>
      reconcileSettledWorkspacePatches(workspaceRoot, dataRoot, patches),
    async patch(
      content: string,
      before?: string,
    ): Promise<SettledPatchRecoveryEvidence> {
      sequence += 1;
      const args =
        before === undefined
          ? {
              operation: "create" as const,
              path: "sub/target.txt",
              content,
              expectedSha256: null,
            }
          : {
              operation: "replace" as const,
              path: "./sub/target.txt",
              expectedSha256: sha256(before),
              edits: [{ oldText: before, newText: content }],
            };
      const callId = `patch-${sequence}`;
      const result = await tool.execute(callId, args);
      const details = result.details;
      const capsulePath = path.join(
        dataRoot,
        "workspace-patch-recovery",
        `${details.recoveryCapsuleSha256}.json`,
      );
      const capsule = JSON.parse(await readFile(capsulePath, "utf8"));
      return {
        callId,
        startedSeq: sequence * 2,
        completedSeq: sequence * 2 + 1,
        operationId: `op-${sequence}`,
        inputSha256: capsule.inputSha256,
        capsuleSha256: details.recoveryCapsuleSha256!,
        pathSha256: details.pathSha256,
        beforeSha256: details.beforeSha256,
        afterSha256: details.afterSha256,
      };
    },
  };
}
