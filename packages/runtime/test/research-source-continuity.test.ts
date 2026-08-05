import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { canonicalJson, sha256 } from "../src/ed25519.js";
import { ResearchSourceCapsuleStore } from "../src/research-source-capsule-store.js";
import {
  createResearchSourceCapsule,
  createResearchSourceCapsuleReceipt,
} from "../src/research-source-capsule.js";
import { browserResearchCapture } from "../src/research-source-capture.js";
import { RunResearchSourceManager } from "../src/research-sources.js";
import { buildRunRecoveryPrompt } from "../src/run-recovery-prompt.js";
import { LocalStore } from "../src/store.js";
import { createThreadReplayBundle } from "../src/thread-bundles.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Research Source continuity", () => {
  it("restores private Source state only into an interrupted recovery child", async () => {
    const fixture = await continuityFixture();
    const firstCapsules = new ResearchSourceCapsuleStore(fixture.dataRoot);
    const first = new RunResearchSourceManager(
      { capturePage: vi.fn(async () => sourceCapture()) },
      fixture.workspaceRoot,
      undefined,
      firstCapsules,
      fixture.store,
    );
    const parentOwner = {
      threadId: fixture.threadId,
      runId: fixture.parentRunId,
    };
    const captured = await first.execute(parentOwner, { action: "capture" });
    const cited = await first.execute(parentOwner, {
      action: "cite",
      sourceId: captured.details.sourceId!,
      sourceContentSha256: captured.details.sourceContentSha256!,
      startLine: 1,
      endLine: 1,
      claim: "Private continuity preserves exact evidence.",
    });
    await appendResearchCompletion(fixture.store, parentOwner, cited.details);
    await fixture.store.finishRun(fixture.parentRunId, "interrupted");
    await first.cancelRun(parentOwner);
    fixture.store.close();

    const reopenedStore = new LocalStore({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
    });
    await reopenedStore.initialize();
    const child = await reopenedStore.createRun({
      threadId: fixture.threadId,
      agentId: fixture.agentId,
      source: "recovery",
      parentRunId: fixture.parentRunId,
    });
    const reopenedCapsules = new ResearchSourceCapsuleStore(fixture.dataRoot);
    const reopened = new RunResearchSourceManager(
      { capturePage: vi.fn() },
      fixture.workspaceRoot,
      undefined,
      reopenedCapsules,
      reopenedStore,
    );
    const childOwner = { threadId: fixture.threadId, runId: child.id };
    const listed = await reopened.execute(childOwner, { action: "list" });
    const recited = await reopened.execute(childOwner, {
      action: "cite",
      sourceId: captured.details.sourceId!,
      sourceContentSha256: captured.details.sourceContentSha256!,
      startLine: 1,
      endLine: 1,
      claim: "Recovered evidence can be cited again.",
    });
    const report = `Recovered evidence can be cited again. [citation:${recited.details.citationId!}]\n`;
    await writeFile(path.join(fixture.workspaceRoot, "recovered.md"), report);
    const verified = await reopened.execute(childOwner, {
      action: "verify_report",
      path: "recovered.md",
      expectedSha256: sha256(report),
    });

    expect(listed.output).toContain(captured.details.sourceId);
    expect(listed.output).toContain(cited.details.citationId);
    expect(listed.details).toEqual(
      expect.objectContaining({
        sourceCount: 1,
        citationCount: 1,
        stateCapsule: expect.objectContaining({
          sourceRunId: child.id,
          sourceCount: 1,
          citationCount: 1,
          storage: "local_only",
        }),
      }),
    );
    expect(recited.details).toEqual(
      expect.objectContaining({
        sourceCount: 1,
        citationCount: 2,
        stateCapsule: expect.objectContaining({
          sourceRunId: child.id,
          citationCount: 2,
        }),
      }),
    );
    expect(verified.details).toEqual(
      expect.objectContaining({
        action: "verify_report",
        reportFileSha256: sha256(report),
        reportCitationCount: 1,
        sourceCount: 1,
        citationCount: 2,
        stateCapsule: expect.objectContaining({
          sourceRunId: child.id,
        }),
      }),
    );
    const capsuleEntries = await readdir(reopenedCapsules.rootPath);
    expect((await stat(reopenedCapsules.rootPath)).mode & 0o777).toBe(0o700);
    for (const entry of capsuleEntries) {
      expect(
        (await stat(path.join(reopenedCapsules.rootPath, entry))).mode & 0o777,
      ).toBe(0o600);
    }
    const events = JSON.stringify(
      await reopenedStore.listEvents(fixture.threadId),
    );
    expect(events).not.toContain("SOURCE_PRIVATE_RESTART_TEXT");
    expect(events).not.toContain(
      "Private continuity preserves exact evidence.",
    );
    reopenedStore.close();
  });

  it("does not inherit Sources into an ordinary child Run", async () => {
    const fixture = await continuityFixture();
    const capsules = new ResearchSourceCapsuleStore(fixture.dataRoot);
    const manager = new RunResearchSourceManager(
      { capturePage: vi.fn(async () => sourceCapture()) },
      fixture.workspaceRoot,
      undefined,
      capsules,
      fixture.store,
    );
    const owner = {
      threadId: fixture.threadId,
      runId: fixture.parentRunId,
    };
    const captured = await manager.execute(owner, { action: "capture" });
    await appendResearchCompletion(fixture.store, owner, captured.details);
    await fixture.store.finishRun(fixture.parentRunId, "interrupted");
    const child = await fixture.store.createRun({
      threadId: fixture.threadId,
      agentId: fixture.agentId,
      source: "user",
      parentRunId: fixture.parentRunId,
    });
    const reopened = new RunResearchSourceManager(
      { capturePage: vi.fn() },
      fixture.workspaceRoot,
      undefined,
      capsules,
      fixture.store,
    );

    await expect(
      reopened.execute(
        { threadId: fixture.threadId, runId: child.id },
        { action: "list" },
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        output: "No Research Sources captured in this Run.",
      }),
    );
    fixture.store.close();
  });

  it("fails closed when a private Source capsule is tampered", async () => {
    const fixture = await continuityFixture();
    const capsules = new ResearchSourceCapsuleStore(fixture.dataRoot);
    const manager = new RunResearchSourceManager(
      { capturePage: vi.fn(async () => sourceCapture()) },
      fixture.workspaceRoot,
      undefined,
      capsules,
      fixture.store,
    );
    const owner = {
      threadId: fixture.threadId,
      runId: fixture.parentRunId,
    };
    const captured = await manager.execute(owner, { action: "capture" });
    await appendResearchCompletion(fixture.store, owner, captured.details);
    await fixture.store.finishRun(fixture.parentRunId, "interrupted");
    const child = await fixture.store.createRun({
      threadId: fixture.threadId,
      agentId: fixture.agentId,
      source: "recovery",
      parentRunId: fixture.parentRunId,
    });
    const capsulePath = path.join(
      capsules.rootPath,
      `${captured.details.stateCapsule!.capsuleSha256}.json`,
    );
    const serialized = await readFile(capsulePath, "utf8");
    await writeFile(
      capsulePath,
      serialized.replace(
        "SOURCE_PRIVATE_RESTART_TEXT",
        "SOURCE_PRIVATE_RESTART_DRIFT",
      ),
    );
    await chmod(capsulePath, 0o600);
    const reopened = new RunResearchSourceManager(
      { capturePage: vi.fn() },
      fixture.workspaceRoot,
      undefined,
      capsules,
      fixture.store,
    );

    await expect(
      reopened.execute(
        { threadId: fixture.threadId, runId: child.id },
        { action: "list" },
      ),
    ).rejects.toThrow(/(?:capture|capsule).*(?:binding|invalid)/iu);
    await expect(
      reopened.execute(
        { threadId: fixture.threadId, runId: child.id },
        { action: "list" },
      ),
    ).rejects.toThrow(/(?:capture|capsule).*(?:binding|invalid)/iu);
    fixture.store.close();
  });

  it("does not publish a Source when private capsule storage is full", async () => {
    const fixture = await continuityFixture();
    const capsules = {
      put: vi.fn(async () => {
        throw new Error("Research Source capsule storage byte limit reached");
      }),
      read: vi.fn(),
    };
    const manager = new RunResearchSourceManager(
      { capturePage: vi.fn(async () => sourceCapture()) },
      fixture.workspaceRoot,
      undefined,
      capsules,
      fixture.store,
    );
    const owner = {
      threadId: fixture.threadId,
      runId: fixture.parentRunId,
    };

    await expect(manager.execute(owner, { action: "capture" })).rejects.toThrow(
      "capsule storage byte limit reached",
    );
    await expect(manager.execute(owner, { action: "list" })).resolves.toEqual(
      expect.objectContaining({
        output: "No Research Sources captured in this Run.",
      }),
    );
    fixture.store.close();
  });

  it("rejects a self-rehashed receipt that does not match its capsule", async () => {
    const fixture = await continuityFixture();
    const capsules = new ResearchSourceCapsuleStore(fixture.dataRoot);
    const source = {
      id: "source_receiptfixture",
      capture: browserResearchCapture(sourceCapture()),
      origin: "https://example.com",
      textSha256: sha256("SOURCE_PRIVATE_RESTART_TEXT"),
    };
    const capsule = createResearchSourceCapsule({
      sourceThreadId: fixture.threadId,
      sourceRunId: fixture.parentRunId,
      sources: [source],
      citations: [],
    });
    const receipt = await capsules.put({
      sourceThreadId: fixture.threadId,
      sourceRunId: fixture.parentRunId,
      sources: [source],
      citations: [],
    });
    const forged = createResearchSourceCapsuleReceipt(
      capsule,
      receipt.capsuleBytes,
    );
    forged.sourceCount = 2;
    const { contentSha256: _contentSha256, ...content } = forged;
    forged.contentSha256 = sha256(canonicalJson(content));
    await appendResearchCompletion(
      fixture.store,
      {
        threadId: fixture.threadId,
        runId: fixture.parentRunId,
      },
      {
        kind: "napier.research-source",
        schemaVersion: 1,
        action: "list",
        sourceCount: 1,
        citationCount: 0,
        sourceSetSha256: receipt.sourceSetSha256,
        stateCapsule: forged,
      },
    );
    await fixture.store.finishRun(fixture.parentRunId, "interrupted");
    const child = await fixture.store.createRun({
      threadId: fixture.threadId,
      agentId: fixture.agentId,
      source: "recovery",
      parentRunId: fixture.parentRunId,
    });
    const reopened = new RunResearchSourceManager(
      { capturePage: vi.fn() },
      fixture.workspaceRoot,
      undefined,
      capsules,
      fixture.store,
    );

    await expect(
      reopened.execute(
        { threadId: fixture.threadId, runId: child.id },
        { action: "list" },
      ),
    ).rejects.toThrow(/Research Source recovery (?:receipt|capsule)/u);
    fixture.store.close();
  });

  it("continues across a recovery crash before the first Source tool call", async () => {
    const fixture = await continuityFixture();
    const capsules = new ResearchSourceCapsuleStore(fixture.dataRoot);
    const parentManager = new RunResearchSourceManager(
      { capturePage: vi.fn(async () => sourceCapture()) },
      fixture.workspaceRoot,
      undefined,
      capsules,
      fixture.store,
    );
    const parentOwner = {
      threadId: fixture.threadId,
      runId: fixture.parentRunId,
    };
    const captured = await parentManager.execute(parentOwner, {
      action: "capture",
    });
    await appendResearchCompletion(
      fixture.store,
      parentOwner,
      captured.details,
    );
    await fixture.store.finishRun(fixture.parentRunId, "interrupted");
    const firstRecovery = await fixture.store.createRun({
      threadId: fixture.threadId,
      agentId: fixture.agentId,
      source: "recovery",
      parentRunId: fixture.parentRunId,
    });
    const firstRecoveryManager = new RunResearchSourceManager(
      { capturePage: vi.fn() },
      fixture.workspaceRoot,
      undefined,
      capsules,
      fixture.store,
    );
    const checkpoint = await firstRecoveryManager.prepareRecovery({
      threadId: fixture.threadId,
      runId: firstRecovery.id,
    });
    expect(checkpoint).toEqual(
      expect.objectContaining({
        sourceRunId: firstRecovery.id,
        sourceCount: 1,
      }),
    );
    await fixture.store.appendEvent({
      threadId: fixture.threadId,
      runId: firstRecovery.id,
      type: "context.research_sources",
      category: "tool",
      visibility: "debug",
      payload: checkpoint!,
    });
    await fixture.store.finishRun(firstRecovery.id, "interrupted");
    const secondRecovery = await fixture.store.createRun({
      threadId: fixture.threadId,
      agentId: fixture.agentId,
      source: "recovery",
      parentRunId: firstRecovery.id,
    });
    const secondRecoveryManager = new RunResearchSourceManager(
      { capturePage: vi.fn() },
      fixture.workspaceRoot,
      undefined,
      capsules,
      fixture.store,
    );
    const secondRecoveryEvents = (
      await fixture.store.listEvents(fixture.threadId)
    ).filter((event) => event.runId === firstRecovery.id);
    expect(
      buildRunRecoveryPrompt(
        fixture.store
          .listRuns(fixture.threadId)
          .find((run) => run.id === firstRecovery.id)!,
        undefined,
        secondRecoveryEvents,
      ),
    ).toContain("A private local Source capsule is available");

    await expect(
      secondRecoveryManager.execute(
        { threadId: fixture.threadId, runId: secondRecovery.id },
        { action: "list" },
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        output: expect.stringContaining(captured.details.sourceId!),
        details: expect.objectContaining({
          sourceCount: 1,
          stateCapsule: expect.objectContaining({
            sourceRunId: secondRecovery.id,
          }),
        }),
      }),
    );
    fixture.store.close();
  });

  it("does not advertise private Sources to automatic recovery", async () => {
    const fixture = await continuityFixture();
    const receipt = createResearchSourceCapsuleReceipt(
      createResearchSourceCapsule({
        sourceThreadId: fixture.threadId,
        sourceRunId: fixture.parentRunId,
        sources: [],
        citations: [],
      }),
    );
    const event = {
      id: "event_source_auto_recovery",
      threadId: fixture.threadId,
      runId: fixture.parentRunId,
      seq: 1,
      type: "tool.completed",
      category: "tool",
      visibility: "user",
      createdAt: "2026-08-05T00:00:00.000Z",
      payload: {
        callId: "source-auto-recovery",
        toolName: "research_source",
        status: "completed",
        details: {
          kind: "napier.research-source",
          schemaVersion: 1,
          action: "list",
          sourceCount: 0,
          citationCount: 0,
          sourceSetSha256: receipt.sourceSetSha256,
          stateCapsule: receipt,
        },
      },
    } as const;
    const run = fixture.store
      .listRuns(fixture.threadId)
      .find((candidate) => candidate.id === fixture.parentRunId)!;

    expect(buildRunRecoveryPrompt(run, undefined, [event], "manual")).toContain(
      "A private local Source capsule is available",
    );
    expect(
      buildRunRecoveryPrompt(run, undefined, [event], "automatic"),
    ).not.toContain("A private local Source capsule is available");
    fixture.store.close();
  });

  it("binds Source context receipts to recovery Runs in Replay", async () => {
    const fixture = await continuityFixture();
    await fixture.store.finishRun(fixture.parentRunId, "interrupted");
    const recovery = await fixture.store.createRun({
      threadId: fixture.threadId,
      agentId: fixture.agentId,
      source: "recovery",
      parentRunId: fixture.parentRunId,
    });
    const receipt = createResearchSourceCapsuleReceipt(
      createResearchSourceCapsule({
        sourceThreadId: fixture.threadId,
        sourceRunId: recovery.id,
        sources: [],
        citations: [],
      }),
    );
    await fixture.store.appendEvent({
      threadId: fixture.threadId,
      runId: recovery.id,
      type: "tool.completed",
      category: "tool",
      visibility: "user",
      payload: {
        callId: "research-import-receipt",
        toolName: "research_source",
        status: "completed",
        details: {
          kind: "napier.research-source",
          schemaVersion: 1,
          action: "list",
          sourceCount: 0,
          citationCount: 0,
          sourceSetSha256: receipt.sourceSetSha256,
          stateCapsule: receipt,
        },
      },
    });
    await fixture.store.appendEvent({
      threadId: fixture.threadId,
      runId: recovery.id,
      type: "context.research_sources",
      category: "tool",
      visibility: "debug",
      payload: receipt,
    });
    await fixture.store.finishRun(recovery.id, "completed");
    const detail = await fixture.store.getDetail(fixture.threadId);
    const bundle = createThreadReplayBundle(detail);
    expect(() => createThreadReplayBundle(detail)).not.toThrow();
    const imported = await fixture.store.importThreadReplayBundle(
      bundle,
      "Imported Research Source receipt",
    );
    expect(
      imported.events.some(
        (candidate) => candidate.type === "context.research_sources",
      ),
    ).toBe(false);
    const importedTool = imported.events.find(
      (candidate) =>
        candidate.type === "tool.completed" &&
        candidate.payload["toolName"] === "research_source",
    )!;
    expect(
      (importedTool.payload["details"] as Record<string, unknown>)[
        "stateCapsule"
      ],
    ).toBeUndefined();
    expect(
      (importedTool.payload["details"] as Record<string, unknown>)[
        "sourceSetSha256"
      ],
    ).toBe(receipt.sourceSetSha256);
    const event = detail.events.find(
      (candidate) => candidate.type === "context.research_sources",
    )!;
    const forged = {
      ...(event.payload as Record<string, unknown>),
      sourceRunId: fixture.parentRunId,
    };
    const { contentSha256: _contentSha256, ...content } = forged;
    forged.contentSha256 = sha256(canonicalJson(content));
    event.payload = forged;
    expect(() => createThreadReplayBundle(detail)).toThrow(
      "Research Source context is not bound to recovery Run",
    );
    fixture.store.close();
  });
});

async function continuityFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-source-continuity-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot);
  const store = new LocalStore({ workspaceRoot, dataRoot });
  await store.initialize();
  const agentId = store.listAgents()[0]!.id;
  const thread = await store.createThread({
    title: "Research Source continuity",
    agentId,
  });
  const parent = await store.createRun({
    threadId: thread.id,
    agentId,
  });
  return {
    store,
    workspaceRoot,
    dataRoot,
    agentId,
    threadId: thread.id,
    parentRunId: parent.id,
  };
}

async function appendResearchCompletion(
  store: LocalStore,
  owner: { threadId: string; runId: string },
  details: Record<string, unknown>,
) {
  await store.appendEvent({
    threadId: owner.threadId,
    runId: owner.runId,
    type: "tool.completed",
    category: "tool",
    visibility: "user",
    payload: {
      callId: "research-continuity",
      toolName: "research_source",
      status: "completed",
      details,
    },
  });
}

function sourceCapture() {
  const content = {
    url: "https://example.com/restart-source",
    title: "Restart Source",
    lines: ["SOURCE_PRIVATE_RESTART_TEXT"],
    truncated: false,
  };
  return {
    ...content,
    textChars: content.lines.join("\n").length,
    capturedContentSha256: sha256(canonicalJson(content)),
    sessionOperation: 1,
    sessionIdSha256: "1".repeat(64),
    activeTabId: "tab_1",
    tabCount: 1,
    tabSetSha256: sha256(canonicalJson(["tab_1"])),
    browserExecutableSha256: "2".repeat(64),
    browserVersionSha256: "3".repeat(64),
    limitsSha256: "4".repeat(64),
    network: {
      requestCount: 1,
      connectCount: 1,
      rejectedCount: 0,
      transferredBytes: 128,
      destinationCount: 1,
      destinationsSha256: "5".repeat(64),
    },
  };
}
