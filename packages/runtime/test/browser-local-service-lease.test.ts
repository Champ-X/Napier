import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { RunLocalServiceLeaseRegistry } from "../src/run-local-service-leases.js";
import { LocalStore } from "../src/store.js";
import {
  cleanupBrowserSessionHarnesses,
  createBrowserSessionHarness,
} from "./browser-session-harness.js";
import { localServiceSession } from "./local-service-session-fixture.js";

const roots: string[] = [];

afterEach(async () => {
  await cleanupBrowserSessionHarnesses();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Browser local-service lease", () => {
  it("allows only the owning Run's exact active origin", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-browser-lease-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const store = new LocalStore({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
    });
    await store.initialize();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Browser local-service lease",
      agentId: agent.id,
    });
    const run = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
      model: { provider: "faux", id: "faux-1" },
    });
    const owner = {
      threadId: thread.id,
      runId: run.id,
    };
    const leases = new RunLocalServiceLeaseRegistry(store);
    const session = localServiceSession(owner);
    await leases.grant(session);
    const harness = await createBrowserSessionHarness({
      localServiceLeases: leases,
    });

    const started = await harness.manager.execute(owner, {
      action: "start",
      url: "http://127.0.0.1:45678/page",
    });
    expect(started.output).toContain("127.0.0.1:45678");
    await harness.manager.cancelRun(owner);

    await expect(
      harness.manager.execute(
        { threadId: owner.threadId, runId: "run_other" },
        { action: "start", url: "http://127.0.0.1:45678/" },
      ),
    ).rejects.toThrow("private or reserved");
    await expect(
      harness.manager.execute(owner, {
        action: "start",
        url: "http://127.0.0.1:45679/",
      }),
    ).rejects.toThrow("private or reserved");

    await leases.revokeProcess(session, "process_settled");
    await expect(
      harness.manager.execute(owner, {
        action: "start",
        url: "http://127.0.0.1:45678/",
      }),
    ).rejects.toThrow("private or reserved");
    store.close();
  });
});
