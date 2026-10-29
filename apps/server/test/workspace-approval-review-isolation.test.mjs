import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { serve } from "@hono/node-server";
import { expect, it } from "vitest";

import { createWorkspaceRuntimeHost } from "../src/workspace-runtime-host.ts";
import { processReadySandbox } from "./process-run-readiness-test-fixture.ts";
import { seedWorkspaceApprovalReview } from "./workspace-approval-review-fixture.ts";
import {
  approveAndContinue, assertCompletedOnce, assertWaiting, rejectAbsentIds,
} from "../../../scripts/workspace-approval-review-checks.mjs";

it("isolates copied approval and extension trust IDs over HTTP, persists custom roots, and continues once after restart", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "napier-workspace-approval-"));
  let host, server;
  const fixture = await seedWorkspaceApprovalReview(root);
  const start = async () => {
    host = await createWorkspaceRuntimeHost({
      workspaceRoot: fixture.a.root, stateHome: fixture.a.dataRoot,
      services: { env: {}, sandbox: processReadySandbox("workspace-approval-review") },
    });
    const ready = Promise.withResolvers();
    server = serve({ fetch: host.fetch, hostname: "127.0.0.1", port: 0 }, ready.resolve);
    const address = await ready.promise;
    return `http://127.0.0.1:${address.port}`;
  };
  const close = async () => {
    await host?.shutdown(); host = undefined;
    if (server) await new Promise((resolve) => server.close(resolve));
    server = undefined;
  };
  try {
    let origin = await start();
    await assertWaiting(origin, fixture.a, fixture);
    await assertWaiting(origin, fixture.b, fixture);
    await rejectAbsentIds(origin, fixture);
    const bCheckpoint = await approveAndContinue(origin, fixture.b, fixture);
    const b = await assertCompletedOnce(origin, fixture.b, fixture, bCheckpoint);
    await assertWaiting(origin, fixture.a, fixture);
    await close();
    origin = await start();
    await assertWaiting(origin, fixture.a, fixture);
    expect(await assertCompletedOnce(origin, fixture.b, fixture, bCheckpoint)).toEqual(b);
    const aCheckpoint = await approveAndContinue(origin, fixture.a, fixture);
    await assertCompletedOnce(origin, fixture.a, fixture, aCheckpoint);
    expect(await assertCompletedOnce(origin, fixture.b, fixture, bCheckpoint)).toEqual(b);
    await close();
    origin = await start();
    await assertCompletedOnce(origin, fixture.a, fixture, aCheckpoint);
    expect(await assertCompletedOnce(origin, fixture.b, fixture, bCheckpoint)).toEqual(b);
  } finally {
    await close();
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
