import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { BrowserInteractionConfirmationManager } from "../src/browser-interaction-confirmations.js";
import { LocalStore } from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Browser interaction confirmations", () => {
  it("binds one approval to one exact Run call and rejects mismatch and replay", async () => {
    const fixture = await createFixture();
    const manager = new BrowserInteractionConfirmationManager(fixture.store, {
      available: true,
      timeoutMs: 5_000,
    });
    const owner = { threadId: fixture.threadId, runId: fixture.runId };
    const waiting = manager.request({
      ...owner,
      callId: "call_click_once",
      action: "click",
      argumentsSha256: "a".repeat(64),
      preview: {
        targetKind: "ref",
        targetSha256: "f".repeat(64),
        crossOriginAuthorized: false,
      },
    });
    const [pending] = manager.list(owner);
    expect(pending).toEqual(
      expect.objectContaining({
        action: "click",
        status: "pending",
        argumentsSha256: "a".repeat(64),
      }),
    );
    await expect(
      manager.decide(owner, pending!.id, {
        decision: "approve",
        expectedRequestSha256: "b".repeat(64),
      }),
    ).rejects.toThrow("request changed");
    await expect(
      manager.decide(
        { threadId: fixture.threadId, runId: "run_wrong_scope" },
        pending!.id,
        {
          decision: "approve",
          expectedRequestSha256: pending!.requestSha256,
        },
      ),
    ).rejects.toThrow("not found");
    expect(manager.list(owner)).toHaveLength(1);

    const approved = await manager.decide(owner, pending!.id, {
      decision: "approve",
      expectedRequestSha256: pending!.requestSha256,
    });
    await expect(waiting).resolves.toEqual(
      expect.objectContaining({
        decision: "approve",
        confirmation: expect.objectContaining({
          status: "approved",
          decisionSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      }),
    );
    expect(approved.status).toBe("approved");
    expect(approved.contentSha256).not.toBe(pending!.contentSha256);
    expect(manager.list(owner)).toEqual([]);
    await expect(
      manager.decide(owner, pending!.id, {
        decision: "approve",
        expectedRequestSha256: pending!.requestSha256,
      }),
    ).rejects.toThrow("not found");

    const events = await fixture.store.listEvents(fixture.threadId);
    expect(
      events
        .filter((event) =>
          event.type.startsWith("browser.interaction_confirmation."),
        )
        .map((event) => ({
          type: event.type,
          payload: event.payload,
        })),
    ).toEqual([
      expect.objectContaining({
        type: "browser.interaction_confirmation.pending",
        payload: expect.objectContaining({
          action: "click",
          status: "pending",
          argumentsSha256: "a".repeat(64),
        }),
      }),
      expect.objectContaining({
        type: "browser.interaction_confirmation.approved",
        payload: expect.objectContaining({
          action: "click",
          status: "approved",
        }),
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain("selector");
    await fixture.store.close();
  });

  it("settles Run cancellation and bounded expiry without granting authority", async () => {
    const fixture = await createFixture();
    const owner = { threadId: fixture.threadId, runId: fixture.runId };
    const cancellationManager = new BrowserInteractionConfirmationManager(
      fixture.store,
      { available: true, timeoutMs: 5_000 },
    );
    const cancelled = cancellationManager.request({
      ...owner,
      callId: "call_cancelled",
      action: "select",
      argumentsSha256: "d".repeat(64),
      preview: {
        valueCount: 2,
        valueSetSha256: "f".repeat(64),
        crossOriginAuthorized: false,
      },
    });
    await cancellationManager.cancelRun(owner);
    await expect(cancelled).resolves.toEqual(
      expect.objectContaining({
        decision: "reject",
        confirmation: expect.objectContaining({ status: "cancelled" }),
      }),
    );
    expect(cancellationManager.list(owner)).toEqual([]);

    const expiryManager = new BrowserInteractionConfirmationManager(
      fixture.store,
      { available: true, timeoutMs: 10 },
    );
    const expired = expiryManager.request({
      ...owner,
      callId: "call_expired",
      action: "download",
      argumentsSha256: "e".repeat(64),
      preview: {
        pathSha256: "f".repeat(64),
        crossOriginAuthorized: true,
      },
    });
    await expect(expired).resolves.toEqual(
      expect.objectContaining({
        decision: "reject",
        confirmation: expect.objectContaining({ status: "expired" }),
      }),
    );
    expect(
      (await fixture.store.listEvents(fixture.threadId))
        .filter((event) =>
          event.type.startsWith("browser.interaction_confirmation."),
        )
        .map((event) => event.type),
    ).toEqual([
      "browser.interaction_confirmation.pending",
      "browser.interaction_confirmation.cancelled",
      "browser.interaction_confirmation.pending",
      "browser.interaction_confirmation.expired",
    ]);
    await fixture.store.close();
  });

  it("fails immediately when the entry point has no confirmation channel", async () => {
    const fixture = await createFixture();
    const manager = new BrowserInteractionConfirmationManager(fixture.store);
    await expect(
      manager.request({
        threadId: fixture.threadId,
        runId: fixture.runId,
        callId: "call_unavailable",
        action: "type",
        argumentsSha256: "c".repeat(64),
        preview: {
          textSha256: "f".repeat(64),
          textBytes: 12,
          crossOriginAuthorized: false,
        },
      }),
    ).rejects.toThrow("unavailable in this entry point");
    expect(
      manager.list({ threadId: fixture.threadId, runId: fixture.runId }),
    ).toEqual([]);
    await fixture.store.close();
  });
});

async function createFixture(): Promise<{
  store: LocalStore;
  threadId: string;
  runId: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-browser-confirm-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "state"),
  });
  await store.initialize();
  const thread = await store.createThread({
    title: "Browser confirmation",
    agentId: store.listAgents()[0]!.id,
  });
  const run = await store.createRun({
    threadId: thread.id,
    agentId: thread.agentId,
    model: { provider: "faux-browser-confirm", id: "faux-1" },
  });
  return { store, threadId: thread.id, runId: run.id };
}
