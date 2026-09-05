import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { RunEventAdmissionError } from "../src/run-event-admission.js";
import { RunLocalServiceLeaseRegistry } from "../src/run-local-service-leases.js";
import { LocalStore } from "../src/store.js";
import { localServiceSession } from "./local-service-session-fixture.js";

const roots: string[] = [];
const stores: LocalStore[] = [];

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
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

    await fixture.store.finishRun(fixture.runId, "completed");
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
  });

  it("publishes no in-memory authority when Run finish wins the durable grant race", async () => {
    const fixture = await createFixture();
    const appendEntered = deferred<void>();
    const releaseAppend = deferred<void>();
    const registry = new RunLocalServiceLeaseRegistry({
      appendEvent: async (input) => {
        appendEntered.resolve(undefined);
        await releaseAppend.promise;
        return fixture.store.appendEvent(input);
      },
    });
    const session = localServiceSession({
      threadId: fixture.threadId,
      runId: fixture.runId,
    });

    const grant = registry.grant(session);
    const rejectedGrant = expect(grant).rejects.toEqual(
      expect.objectContaining<Partial<RunEventAdmissionError>>({
        name: "RunEventAdmissionError",
        status: "completed",
      }),
    );
    await appendEntered.promise;
    expect(
      registry.authorize(
        { threadId: fixture.threadId, runId: fixture.runId },
        "http://127.0.0.1:45678/",
      ),
    ).toBeUndefined();

    await fixture.store.finishRun(fixture.runId, "completed");
    releaseAppend.resolve(undefined);
    await rejectedGrant;

    expect(
      registry.authorize(
        { threadId: fixture.threadId, runId: fixture.runId },
        "http://127.0.0.1:45678/",
      ),
    ).toBeUndefined();
    expect(
      (await fixture.store.listRunEvents(fixture.runId)).some(
        (event) =>
          event.type === "workspace.process.local_service_lease.granted",
      ),
    ).toBe(false);
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
  stores.push(store);
  await store.initialize();
  const agent = store.listAgents()[0]!;
  const thread = await store.createThread({
    title: "Run local-service lease",
    agentId: agent.id,
  });
  const run = await store.createRun({
    threadId: thread.id,
    agentId: agent.id,
    model: { provider: "faux", id: "faux-1" },
  });
  return { store, threadId: thread.id, runId: run.id };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
