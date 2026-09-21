import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, it } from "vitest";
import type { RunEvent } from "@napier/contracts";
import { VerificationRunner } from "../src/verification.js";
import { HostDirectSandboxAdapter } from "../src/sandbox-host-direct.js";
import { createWorkspacePathSnapshot } from "../src/workspace-snapshot.js";
import { projectTaskWorkingState } from "../src/task-working-state.js";
import { verificationDetailsProjection } from "../src/verification-ledger.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "napier-verifier-freshness-")),
  );
  roots.push(root);
  await mkdir(path.join(root, "frontend"));
  await writeFile(path.join(root, "shared.mjs"), "export const value = 7;\n");
  await writeFile(
    path.join(root, "frontend/unit.test.mjs"),
    "import {test} from 'node:test';import assert from 'node:assert/strict';import {value} from '../shared.mjs';test('shared import',()=>assert.equal(value,7));\n",
  );
  const runner = new VerificationRunner({
    workspaceRoot: root,
    sandbox: new HostDirectSandboxAdapter(),
  });
  return { root, runner };
}
it("keeps a subdirectory verification current and invalidates it when an outside-cwd dependency changes", async () => {
  const { root, runner } = await fixture();
  const result = await runner.run({
    kind: "test",
    cwd: "frontend",
    target: "unit.test.mjs",
  });
  expect(result.details.status, result.stderr).toBe("passed");
  expect(result.details).toMatchObject({
    workspaceSnapshotScope: "workspace",
    snapshotStatus: "unchanged",
  });
  const event = {
    id: "event_check",
    seq: 1,
    runId: "run_check",
    type: "tool.completed",
    payload: {
      toolName: "verify_workspace",
      details: verificationDetailsProjection({ ...result.details }),
    },
  } as RunEvent;
  const state = async () =>
    projectTaskWorkingState({
      runId: "run_check",
      events: [event],
      workspace: await createWorkspacePathSnapshot(root, root, {
        includeDirectories: true,
      }),
    });
  expect((await state()).verifications[0]?.freshness).toBe("current");
  await writeFile(path.join(root, "shared.mjs"), "export const value = 8;\n");
  expect((await state()).verifications[0]?.freshness).toBe("stale");
});
it("does not attest stable success when a real verifier changes a file outside cwd", async () => {
  const { root, runner } = await fixture();
  await writeFile(
    path.join(root, "frontend/unit.test.mjs"),
    "import {test} from 'node:test';import {writeFileSync} from 'node:fs';test('external writer simulation',()=>writeFileSync(new URL('../shared.mjs',import.meta.url),'export const value = 8;\\n'));\n",
  );
  const result = await runner.run({
    kind: "test",
    cwd: "frontend",
    target: "unit.test.mjs",
  });
  expect(result.details.exitCode).toBe(0);
  expect(result.details.status).toBe("failed");
  expect(result.details.snapshotStatus).toBe("changed");
  expect(result.details.observedWorkspaceSnapshotSha256).not.toBe(
    result.details.workspaceSnapshotSha256,
  );
});
it("attests stable success when a workspace exceeds context snapshot byte limits", async () => {
  const { root, runner } = await fixture();
  await writeFile(path.join(root, "large.bin"), Buffer.alloc(17 * 1024 * 1024));
  const result = await runner.run({
    kind: "test",
    cwd: "frontend",
    target: "unit.test.mjs",
  });
  expect(result.details.exitCode).toBe(0);
  expect(result.details).toMatchObject({
    status: "passed",
    snapshotStatus: "unchanged",
    workspaceSnapshotTruncated: false,
  });
  expect(result.details.workspaceSnapshotBytes).toBeGreaterThan(
    16 * 1024 * 1024,
  );
});
