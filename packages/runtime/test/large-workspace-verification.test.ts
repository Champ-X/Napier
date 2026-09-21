import { mkdtemp, open, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { RunEvent } from "@napier/contracts";
import { afterEach, expect, it } from "vitest";
import { HostDirectSandboxAdapter } from "../src/sandbox-host-direct.js";
import { OciContainerSandboxAdapter } from "../src/sandbox-oci.js";
import { createVerificationTool } from "../src/verification.js";
import { withToolchainProviders } from "../src/toolchain-provider.js";
import {
  prepareAgentWorkingStateContext,
  taskWorkingStateForContext,
} from "../src/agent-working-state-context.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture(runtime: "node" | "python") {
  const workspaceRoot = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "napier-large-verification-")),
  );
  roots.push(workspaceRoot);
  const source = runtime === "node" ? "price.mjs" : "price.py";
  const target = runtime === "node" ? "price.test.mjs" : "test_price.py";
  await writeFile(
    path.join(workspaceRoot, "large.bin"),
    Buffer.alloc(17 * 1024 * 1024),
  );
  await writeFile(path.join(workspaceRoot, "package.json"), "{}");
  await writeFile(
    path.join(workspaceRoot, source),
    runtime === "node" ? "export const price=2;\n" : "price=2\n",
  );
  await writeFile(
    path.join(workspaceRoot, target),
    runtime === "node"
      ? "import {test} from 'node:test';import assert from 'node:assert/strict';import {price} from './price.mjs';test('price',()=>assert.equal(price,2));\n"
      : "import unittest\nfrom price import price\nclass PriceTest(unittest.TestCase):\n def test_price(self): self.assertEqual(price,2)\n",
  );
  const sandbox =
    process.env.NAPIER_LIVE_LARGE_WORKSPACE_OCI === "1"
      ? new OciContainerSandboxAdapter(
          process.env.NAPIER_CONTAINER_SANDBOX_IMAGE,
        )
      : new HostDirectSandboxAdapter();
  const options = { workspaceRoot, sandbox };
  const verify = withToolchainProviders(
    [createVerificationTool(options)],
    options,
  )[0]!;
  return {
    workspaceRoot,
    verify,
    source,
    target,
    runner: runtime === "node" ? { testRunner: "node-test" as const } : {},
  };
}

it.each(["node", "python"] as const)(
  "accepts actual %s verification beyond the context byte budget",
  async (runtime) => {
    const f = await fixture(runtime);
    const result = await f.verify.execute("large-direct", {
      kind: "test",
      runtime,
      target: f.target,
      ...f.runner,
    });
    expect(result.details, JSON.stringify(result.content)).toMatchObject({
      status: "passed",
      snapshotStatus: "unchanged",
      workspaceSnapshotTruncated: false,
    });
    expect(result.details.workspaceSnapshotBytes).toBeGreaterThan(
      16 * 1024 * 1024,
    );
  },
);

it.each(["node", "python"] as const)(
  "preserves %s selection and full-suite fallback on a large workspace",
  async (runtime) => {
    const f = await fixture(runtime);
    await writeFile(
      path.join(
        f.workspaceRoot,
        runtime === "node" ? "other.test.mjs" : "test_other.py",
      ),
      runtime === "node"
        ? "import {test} from 'node:test';import assert from 'node:assert/strict';test('unrelated failing case',()=>assert.fail('retained full-suite failure'));\n"
        : "import unittest\nclass OtherTest(unittest.TestCase):\n def test_other(self): self.fail('retained full-suite failure')\n",
    );
    const selected = await f.verify.execute("large-selected", {
      kind: "test",
      runtime,
      affectedBy: [f.source],
      ...f.runner,
    });
    expect(selected.details, JSON.stringify(selected.content)).toMatchObject({
      status: "passed",
      selectionMode: "selected",
      selectedTestCount: 1,
      completedVerificationCount: 1,
      snapshotStatus: "unchanged",
      workspaceSnapshotTruncated: false,
    });
    const fallback = await f.verify.execute("large-fallback", {
      kind: "test",
      runtime,
      affectedBy: ["package.json"],
      ...f.runner,
    });
    expect(fallback.details, JSON.stringify(fallback.content)).toMatchObject({
      status: "failed",
      selectionMode: "full_suite_fallback",
      completedVerificationCount: 1,
      snapshotStatus: "unchanged",
      workspaceSnapshotTruncated: false,
    });
    expect(JSON.stringify(fallback.content)).toContain(
      "retained full-suite failure",
    );
  },
);

it("carries actual large-workspace verification freshness into context and detects a later change", async () => {
  const f = await fixture("node");
  const result = await f.verify.execute("large-context", {
    kind: "test",
    runtime: "node",
    target: f.target,
    ...f.runner,
  });
  expect(result.details.status).toBe("passed");
  const receipt = {
    id: "event_verify",
    seq: 1,
    runId: "run_large",
    threadId: "thread_large",
    type: "tool.completed",
    payload: { toolName: "verify_workspace", details: result.details },
  } as RunEvent;
  const projection = async () => {
    const context = await prepareAgentWorkingStateContext({
      context: { messages: [] },
      runId: "run_large",
      workspaceRoot: f.workspaceRoot,
      enabled: true,
      listEvents: async () => [receipt],
    });
    return JSON.parse(taskWorkingStateForContext(context).split("\n").at(-1)!);
  };
  const fresh = await projection();
  expect(fresh.verifications[0].freshness).toBe("current");
  expect(fresh.pendingActions).toEqual([]);
  expect(fresh.completion).toBe("not_determined");
  const file = await open(path.join(f.workspaceRoot, "large.bin"), "r+");
  try {
    await file.write(Buffer.from([1]), 0, 1, 17 * 1024 * 1024 - 1);
  } finally {
    await file.close();
  }
  const stale = await projection();
  expect(stale.verifications[0].freshness).toBe("stale");
  expect(stale.pendingActions).toEqual([
    { action: "reverify", eventId: receipt.id, reason: "stale" },
  ]);
});
