import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { NAPIER_RELEASE_IDENTITY_SHA256 } from "../src/release-product-identity.js";
import { LocalStore } from "../src/store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Release Product Run identity", () => {
  it("stamps every new Run and preserves the identity across restart", async () => {
    const fixture = await createStore();
    const agent = fixture.store.listAgents()[0]!;
    const thread = await fixture.store.createThread({
      title: "Release identity",
      agentId: agent.id,
    });
    const run = await fixture.store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    expect(run.releaseIdentitySha256).toBe(NAPIER_RELEASE_IDENTITY_SHA256);
    await fixture.store.shutdown();

    const reopened = new LocalStore(fixture.options);
    await reopened.initialize();
    expect(reopened.listRuns(thread.id)[0]?.releaseIdentitySha256).toBe(
      NAPIER_RELEASE_IDENTITY_SHA256,
    );
    await reopened.shutdown();
  });

  it("fails closed when persisted Run identity is malformed", async () => {
    const fixture = await createStore();
    const statePath = path.join(fixture.options.dataRoot, "workspace.json");
    await fixture.store.flushCompatibilityProjections();
    await fixture.store.shutdown();
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.runs[0].releaseIdentitySha256 = "invalid";
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rm(path.join(fixture.options.dataRoot, "ledger.sqlite"), {
      force: true,
    });

    const reopened = new LocalStore(fixture.options);
    await expect(reopened.initialize()).rejects.toThrow(
      "Run release identity is invalid",
    );
  });
});

async function createStore() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-release-run-"));
  roots.push(root);
  const options = {
    dataRoot: path.join(root, "data"),
    workspaceRoot: path.join(root, "workspace"),
  };
  const store = new LocalStore(options);
  await store.initialize();
  return { store, options };
}
