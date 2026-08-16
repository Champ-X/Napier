import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { RunLocalServiceLeaseRegistry } from "../src/run-local-service-leases.js";
import { LocalStore } from "../src/store.js";
import { localServiceSession } from "./local-service-session-fixture.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Run local-service leases", () => {
  it("binds exact Run, origin, identity, expiry, and revocation", async () => {
    const fixture = await createFixture();
    const registry = new RunLocalServiceLeaseRegistry(fixture.store);
    const session = localServiceSession({
      threadId: fixture.threadId,
      runId: fixture.runId,
    });
    const lease = await registry.grant(session);

    expect(
      registry.authorize(
        { threadId: fixture.threadId, runId: fixture.runId },
        "http://127.0.0.1:45678/page",
      ),
    ).toEqual(lease);
    expect(
      registry.authorize(
        { threadId: fixture.threadId, runId: "run_other" },
        "http://127.0.0.1:45678/",
      ),
    ).toBeUndefined();
    expect(
      registry.authorize(
        { threadId: fixture.threadId, runId: fixture.runId },
        "http://127.0.0.1:45679/",
      ),
    ).toBeUndefined();
    expect(
      registry.authorize(
        { threadId: fixture.threadId, runId: fixture.runId },
        "http://localhost:45678/",
      ),
    ).toBeUndefined();
    expect(
      registry.authorize(
        { threadId: fixture.threadId, runId: fixture.runId },
        "http://127.0.0.1:45678/",
        Date.parse(lease.expiresAt),
      ),
    ).toBeUndefined();

    await registry.revokeProcess(session, "process_settled");
    expect(
      registry.authorize(
        { threadId: fixture.threadId, runId: fixture.runId },
        "http://127.0.0.1:45678/",
      ),
    ).toBeUndefined();
    const events = await fixture.store.listEvents(fixture.threadId);
    expect(
      events
        .filter((event) =>
          event.type.startsWith("workspace.process.local_service_lease."),
        )
        .map((event) => event.type),
    ).toEqual([
      "workspace.process.local_service_lease.granted",
      "workspace.process.local_service_lease.revoked",
    ]);
    expect(JSON.stringify(events)).not.toContain("http://127.0.0.1:45678");
    fixture.store.close();
  });
});

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-local-lease-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  await store.initialize();
  const threadId = store.listThreads()[0]!.id;
  const runId = store.listRuns(threadId)[0]!.id;
  return { store, threadId, runId };
}
