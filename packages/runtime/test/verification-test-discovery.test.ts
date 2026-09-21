import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { selectVerificationTestRunner } from "../src/verification-test-runner.js";
import { projectTaskWorkingState } from "../src/task-working-state.js";
import { createWorkspacePathSnapshot } from "../src/workspace-snapshot.js";
import { digestVerificationWorkspace } from "../src/verification-workspace-digest.js";
import { sha256 } from "../src/ed25519.js";
import type { RunEvent } from "@napier/contracts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "napier-test-discovery-")),
  );
  roots.push(root);
  await writeFile(
    path.join(root, "unit.test.mjs"),
    "import {test} from 'node:test';test('unit',()=>{});\n",
  );
  return root;
}

it("does not silently omit test links or oversized relevant test sources", async () => {
  const root = await fixture();
  await symlink("unit.test.mjs", path.join(root, "linked.test.mjs"));
  await expect(
    selectVerificationTestRunner(root, [root], "node-test"),
  ).rejects.toThrow("symbolic links");
  await rm(path.join(root, "linked.test.mjs"));
  await writeFile(
    path.join(root, "oversized.test.mjs"),
    Buffer.alloc(17 * 1024 * 1024, 32),
  );
  await expect(
    selectVerificationTestRunner(root, [root], "node-test"),
  ).rejects.toThrow("selection is incomplete");
  // Automatic fallback could silently omit native tests in a mixed workspace.
  await expect(selectVerificationTestRunner(root, [root])).rejects.toThrow(
    "selection is incomplete",
  );
  expect(
    (await selectVerificationTestRunner(root, [root], "vitest")).runner,
  ).toBe("vitest");
});

it("retains explicit wrapper targets regardless of target ordering and detects framework mixtures", async () => {
  const root = await fixture();
  const wrapper = path.join(root, "wrapper.mjs");
  await writeFile(
    wrapper,
    "import {test} from 'node:test';test('wrapper',()=>{});\n",
  );
  const a = await selectVerificationTestRunner(
    root,
    [root, wrapper],
    "node-test",
  );
  const b = await selectVerificationTestRunner(
    root,
    [wrapper, root],
    "node-test",
  );
  expect(a).toEqual(b);
  expect(a.targets).toEqual([path.join(root, "unit.test.mjs"), wrapper].sort());
  await writeFile(
    path.join(root, "mixed.test.mjs"),
    "import {test} from 'vitest';test('mixed',()=>{});\n",
  );
  await expect(selectVerificationTestRunner(root, [root])).rejects.toThrow(
    "Mixed or indirect",
  );
});

it("does not use a full modern digest to upgrade incomplete observations or legacy receipts", async () => {
  const root = await fixture();
  const workspace = await createWorkspacePathSnapshot(root, root, {
    includeDirectories: true,
  });
  const digest = await digestVerificationWorkspace(root);
  const event = {
    id: "event_check",
    seq: 1,
    runId: "run_check",
    type: "tool.completed",
    payload: {
      toolName: "verify_workspace",
      details: {
        status: "passed",
        cwdPathSha256: sha256("."),
        workspaceSnapshotScope: "workspace",
        workspaceSnapshotSha256: digest.sha256,
        workspaceSnapshotTruncated: false,
        snapshotStatus: "unchanged",
      },
    },
  } as RunEvent;
  const modern = projectTaskWorkingState({
    runId: "run_check",
    events: [event],
    workspace,
    verificationWorkspace: { ...digest, truncated: true },
  });
  expect(modern.verifications[0]?.freshness).toBe("unknown");
  const payload = event.payload as { details: Record<string, unknown> };
  delete payload.details.snapshotStatus;
  const legacy = projectTaskWorkingState({
    runId: "run_check",
    events: [event],
    workspace: { ...workspace, truncated: true },
    verificationWorkspace: digest,
  });
  expect(legacy.verifications[0]?.freshness).toBe("unknown");
});
