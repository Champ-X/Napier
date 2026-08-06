import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { WebFetchCapsuleStore } from "../src/web-fetch-capsule-store.js";
import {
  createWebFetchStateCapsuleReceipt,
  validateWebFetchStateCapsuleReceipt,
} from "../src/web-fetch-capsule.js";
import { buildRunRecoveryPrompt } from "../src/run-recovery-prompt.js";
import { RunWebFetchSourceManager } from "../src/web-fetch-sources.js";
import { RunWebFetchSaveManager } from "../src/web-fetch-save.js";
import { webFetchToolOutputLedgerProjection } from "../src/web-fetch-tool.js";
import type { PublicHttpResponse } from "../src/public-http-client.js";
import { LocalStore } from "../src/store.js";
import { createThreadReplayBundle } from "../src/thread-bundles.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Web Fetch continuity", () => {
  it("restores a Source retained by web_fetch_save without another request", async () => {
    const fixture = await continuityFixture();
    await mkdir(path.join(fixture.workspaceRoot, "artifacts"), {
      recursive: true,
    });
    let plan = await fixture.store.createPlan(fixture.threadId, {
      objective: "Save one Source and continue its evidence.",
      steps: [
        {
          id: "save",
          title: "Save source",
          description: "Save the declared public Source.",
          verification: "The file and Source evidence are retained.",
        },
      ],
      artifacts: [
        {
          id: "source-file",
          path: "artifacts/saved.txt",
          kind: "file",
          description: "Saved Source bytes.",
        },
      ],
    });
    plan = await fixture.store.transitionPlanStep(plan.id, "save", {
      action: "start",
      runId: fixture.parentRunId,
    });
    expect(plan.steps[0]?.status).toBe("running");
    const capsules = new WebFetchCapsuleStore(fixture.dataRoot);
    const http = {
      request: vi.fn(async () =>
        response(
          "SAVED_SOURCE_CONTINUITY",
          "text/plain",
          "https://example.com/saved.txt",
        ),
      ),
    };
    const sourceManager = manager(fixture, http, capsules);
    const saveManager = new RunWebFetchSaveManager({
      workspaceRoot: fixture.workspaceRoot,
      store: fixture.store,
      retainSource: sourceManager,
      http,
    });
    const owner = {
      threadId: fixture.threadId,
      runId: fixture.parentRunId,
    };
    const saved = await saveManager.execute(owner, {
      url: "https://example.com/saved.txt",
      path: "artifacts/saved.txt",
    });
    await appendSaveCompletion(fixture.store, owner, saved.details);
    await fixture.store.finishRun(fixture.parentRunId, "completed");
    const continuation = await fixture.store.createRun({
      threadId: fixture.threadId,
      agentId: fixture.agentId,
      source: "user",
    });
    const deniedHttp = { request: vi.fn() };
    const reopened = manager(fixture, deniedHttp, capsules);
    const continuationOwner = {
      threadId: fixture.threadId,
      runId: continuation.id,
    };

    const checkpoint = await reopened.prepareRecovery(continuationOwner);
    const read = await reopened.execute(continuationOwner, {
      action: "read",
      sourceId: saved.details.sourceId,
      sourceContentSha256: saved.details.sourceContentSha256,
      startLine: 1,
      endLine: saved.details.sourceLineCount,
    });

    expect(checkpoint).toEqual(
      expect.objectContaining({
        sourceRunId: continuation.id,
        sourceCount: 1,
      }),
    );
    expect(read.output).toContain("SAVED_SOURCE_CONTINUITY");
    expect(http.request).toHaveBeenCalledTimes(1);
    expect(deniedHttp.request).not.toHaveBeenCalled();
    const bundle = createThreadReplayBundle(
      await fixture.store.getDetail(fixture.threadId),
    );
    const saveEvent = bundle.events.find(
      (event) =>
        event.type === "tool.completed" &&
        event.payload !== null &&
        typeof event.payload === "object" &&
        !Array.isArray(event.payload) &&
        event.payload["toolName"] === "web_fetch_save",
    );
    const savePayload =
      saveEvent?.payload !== null &&
      typeof saveEvent?.payload === "object" &&
      !Array.isArray(saveEvent.payload)
        ? saveEvent.payload
        : undefined;
    const saveDetails =
      savePayload?.["details"] !== null &&
      typeof savePayload?.["details"] === "object" &&
      !Array.isArray(savePayload["details"])
        ? savePayload["details"]
        : undefined;
    expect(saveDetails?.["stateCapsule"]).toEqual(
      expect.objectContaining({ sourceCount: 1 }),
    );
    fixture.store.close();
  });

  it("adopts the immediately previous completed Run without another request", async () => {
    const fixture = await continuityFixture();
    const capsules = new WebFetchCapsuleStore(fixture.dataRoot);
    const http = {
      request: vi.fn(async () =>
        response(
          "COMPLETED_FETCH_CONTINUITY",
          "text/plain",
          "https://example.com/continued.txt",
        ),
      ),
    };
    const firstOwner = {
      threadId: fixture.threadId,
      runId: fixture.parentRunId,
    };
    const fetched = await manager(fixture, http, capsules).execute(firstOwner, {
      action: "fetch",
      url: "https://example.com/continued.txt",
    });
    await appendCompletion(fixture.store, firstOwner, fetched.details);
    await fixture.store.finishRun(fixture.parentRunId, "completed");
    const continuation = await fixture.store.createRun({
      threadId: fixture.threadId,
      agentId: fixture.agentId,
      source: "user",
    });
    const deniedHttp = { request: vi.fn() };
    const reopened = manager(fixture, deniedHttp, capsules);
    const owner = { threadId: fixture.threadId, runId: continuation.id };

    const checkpoint = await reopened.prepareRecovery(owner);
    const listed = await reopened.execute(owner, { action: "list" });
    const read = await reopened.execute(owner, {
      action: "read",
      sourceId: fetched.details.sourceId!,
      sourceContentSha256: fetched.details.sourceContentSha256!,
      startLine: 1,
      endLine: 1,
    });

    expect(checkpoint).toEqual(
      expect.objectContaining({
        sourceRunId: continuation.id,
        sourceCount: 1,
      }),
    );
    expect(listed.output).toContain(fetched.details.sourceId);
    expect(read.output).toContain("COMPLETED_FETCH_CONTINUITY");
    expect(deniedHttp.request).not.toHaveBeenCalled();
    fixture.store.close();
  });

  it("adopts an explicitly pinned non-adjacent completed Run", async () => {
    const fixture = await continuityFixture();
    const capsules = new WebFetchCapsuleStore(fixture.dataRoot);
    const firstOwner = {
      threadId: fixture.threadId,
      runId: fixture.parentRunId,
    };
    const fetched = await manager(
      fixture,
      {
        request: vi.fn(async () =>
          response(
            "PINNED_NON_ADJACENT_FETCH",
            "text/plain",
            "https://example.com/pinned.txt",
          ),
        ),
      },
      capsules,
    ).execute(firstOwner, {
      action: "fetch",
      url: "https://example.com/pinned.txt",
    });
    await appendCompletion(fixture.store, firstOwner, fetched.details);
    await fixture.store.finishRun(fixture.parentRunId, "completed");
    const intermediate = await fixture.store.createRun({
      threadId: fixture.threadId,
      agentId: fixture.agentId,
      source: "user",
    });
    await fixture.store.finishRun(intermediate.id, "completed");
    const continuation = await fixture.store.createRun({
      threadId: fixture.threadId,
      agentId: fixture.agentId,
      source: "user",
    });
    const deniedHttp = { request: vi.fn() };
    const reopened = manager(fixture, deniedHttp, capsules);
    const owner = { threadId: fixture.threadId, runId: continuation.id };

    const checkpoint = await reopened.prepareRecovery(
      owner,
      fixture.parentRunId,
    );
    const read = await reopened.execute(owner, {
      action: "read",
      sourceId: fetched.details.sourceId!,
      sourceContentSha256: fetched.details.sourceContentSha256!,
      startLine: 1,
      endLine: 1,
    });

    expect(checkpoint).toEqual(
      expect.objectContaining({
        sourceRunId: continuation.id,
        sourceCount: 1,
      }),
    );
    expect(read.output).toContain("PINNED_NON_ADJACENT_FETCH");
    expect(deniedHttp.request).not.toHaveBeenCalled();
    fixture.store.close();
  });

  it("restores HTML/PDF Sources for list, read, find, and Research capture", async () => {
    const fixture = await continuityFixture();
    const http = {
      request: vi
        .fn()
        .mockResolvedValueOnce(
          response(
            "<html><head><title>Restart HTML</title></head><body><main>HTML_PRIVATE_RESTART_TEXT</main></body></html>",
            "text/html",
            "https://example.com/restart.html",
          ),
        )
        .mockResolvedValueOnce(
          response(
            minimalPdf("PDF_PRIVATE_RESTART_TEXT"),
            "application/pdf",
            "https://example.com/restart.pdf",
          ),
        ),
    };
    const capsules = new WebFetchCapsuleStore(fixture.dataRoot);
    const first = manager(fixture, http, capsules);
    const owner = { threadId: fixture.threadId, runId: fixture.parentRunId };
    const html = await first.execute(owner, {
      action: "fetch",
      url: "https://example.com/restart.html",
    });
    const pdf = await first.execute(owner, {
      action: "fetch",
      url: "https://example.com/restart.pdf",
    });
    await appendCompletion(fixture.store, owner, pdf.details);
    await fixture.store.finishRun(fixture.parentRunId, "interrupted");
    await first.cancelRun(owner);
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
    const deniedHttp = {
      request: vi.fn(async () => response("", "text/plain")),
    };
    const reopened = new RunWebFetchSourceManager({
      http: deniedHttp,
      capsules: new WebFetchCapsuleStore(fixture.dataRoot),
      store: reopenedStore,
    });
    const childOwner = { threadId: fixture.threadId, runId: child.id };
    const checkpoint = await reopened.prepareRecovery(childOwner);
    const listed = await reopened.execute(childOwner, { action: "list" });
    const found = await reopened.execute(childOwner, {
      action: "find",
      sourceId: html.details.sourceId!,
      sourceContentSha256: html.details.sourceContentSha256!,
      query: "PRIVATE_RESTART",
    });
    const read = await reopened.execute(childOwner, {
      action: "read",
      sourceId: pdf.details.sourceId!,
      sourceContentSha256: pdf.details.sourceContentSha256!,
      startLine: 1,
      endLine: pdf.details.sourceLineCount!,
    });
    const research = await reopened.captureWebSource(childOwner, {
      webSourceId: pdf.details.sourceId!,
      webSourceContentSha256: pdf.details.sourceContentSha256!,
      maxChars: 12_000,
    });

    expect(checkpoint).toEqual(
      expect.objectContaining({
        sourceRunId: child.id,
        sourceCount: 2,
        storage: "local_only",
      }),
    );
    expect(listed.output).toContain(html.details.sourceId);
    expect(listed.output).toContain(pdf.details.sourceId);
    expect(found.output).toContain("HTML_PRIVATE_RESTART_TEXT");
    expect(read.output).toContain("PDF_PRIVATE_RESTART_TEXT");
    expect(research).toEqual(
      expect.objectContaining({
        webSourceFormat: "pdf",
        webSourceContentSha256: pdf.details.sourceContentSha256,
      }),
    );
    expect(research.lines.join("\n")).toContain("PDF_PRIVATE_RESTART_TEXT");
    expect(deniedHttp.request).not.toHaveBeenCalled();
    expect((await readdir(capsules.sourceRootPath)).length).toBe(2);
    expect((await stat(capsules.sourceRootPath)).mode & 0o777).toBe(0o700);
    for (const entry of await readdir(capsules.sourceRootPath)) {
      expect(
        (await stat(path.join(capsules.sourceRootPath, entry))).mode & 0o777,
      ).toBe(0o600);
    }
    reopenedStore.close();
  });

  it("fails closed for ordinary children, storage failure, and tampering", async () => {
    const fixture = await continuityFixture();
    const capsules = new WebFetchCapsuleStore(fixture.dataRoot);
    const first = manager(
      fixture,
      {
        request: vi.fn(async () =>
          response("FETCH_PRIVATE_TAMPER_TEXT", "text/plain"),
        ),
      },
      capsules,
    );
    const owner = { threadId: fixture.threadId, runId: fixture.parentRunId };
    const fetched = await first.execute(owner, {
      action: "fetch",
      url: "https://example.com/source.txt",
    });
    await appendCompletion(fixture.store, owner, fetched.details);
    await fixture.store.finishRun(fixture.parentRunId, "interrupted");
    const ordinary = await fixture.store.createRun({
      threadId: fixture.threadId,
      agentId: fixture.agentId,
      source: "user",
      parentRunId: fixture.parentRunId,
    });
    const ordinaryManager = manager(fixture, { request: vi.fn() }, capsules);
    await expect(
      ordinaryManager.execute(
        { threadId: fixture.threadId, runId: ordinary.id },
        { action: "list" },
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        output: "No Web Sources fetched in this Run.",
      }),
    );

    const failing = new RunWebFetchSourceManager({
      http: {
        request: vi.fn(async () => response("not persisted", "text/plain")),
      },
      capsules: {
        putState: vi.fn(async () => {
          throw new Error(
            "Web Fetch Source capsule storage byte limit reached",
          );
        }),
        readManifest: vi.fn(),
        readSource: vi.fn(),
      },
      store: fixture.store,
    });
    await expect(
      failing.execute(owner, {
        action: "fetch",
        url: "https://example.com/fail.txt",
      }),
    ).rejects.toThrow("capsule storage byte limit reached");
    await expect(failing.execute(owner, { action: "list" })).resolves.toEqual(
      expect.objectContaining({
        output: "No Web Sources fetched in this Run.",
      }),
    );

    const manifestPath = path.join(
      capsules.manifestRootPath,
      `${fetched.details.stateCapsule!.manifestCapsuleSha256}.json`,
    );
    await writeFile(
      manifestPath,
      (await readFile(manifestPath, "utf8")).replace(
        fetched.details.sourceContentSha256!,
        "0".repeat(64),
      ),
    );
    await chmod(manifestPath, 0o600);
    await fixture.store.finishRun(ordinary.id, "completed");
    const recovery = await fixture.store.createRun({
      threadId: fixture.threadId,
      agentId: fixture.agentId,
      source: "recovery",
      parentRunId: fixture.parentRunId,
    });
    const reopened = manager(fixture, { request: vi.fn() }, capsules);
    await expect(
      reopened.execute(
        { threadId: fixture.threadId, runId: recovery.id },
        { action: "list" },
      ),
    ).rejects.toThrow(/manifest|capsule|binding/iu);
    fixture.store.close();
  });

  it("checkpoints multi-restart state and strips local-only receipts on import", async () => {
    const fixture = await continuityFixture();
    const capsules = new WebFetchCapsuleStore(fixture.dataRoot);
    const first = manager(
      fixture,
      {
        request: vi.fn(async () =>
          response("FETCH_MULTI_RESTART", "text/plain"),
        ),
      },
      capsules,
    );
    const parentOwner = {
      threadId: fixture.threadId,
      runId: fixture.parentRunId,
    };
    const fetched = await first.execute(parentOwner, {
      action: "fetch",
      url: "https://example.com/multi.txt",
    });
    await appendCompletion(fixture.store, parentOwner, fetched.details);
    await fixture.store.finishRun(fixture.parentRunId, "interrupted");
    const firstRecovery = await fixture.store.createRun({
      threadId: fixture.threadId,
      agentId: fixture.agentId,
      source: "recovery",
      parentRunId: fixture.parentRunId,
    });
    const recoveryManager = manager(fixture, { request: vi.fn() }, capsules);
    const checkpoint = await recoveryManager.prepareRecovery({
      threadId: fixture.threadId,
      runId: firstRecovery.id,
    });
    await fixture.store.appendEvent({
      threadId: fixture.threadId,
      runId: firstRecovery.id,
      type: "context.web_fetch_sources",
      category: "tool",
      visibility: "debug",
      payload: checkpoint!,
    });
    const firstRecoveryEvents = (
      await fixture.store.listEvents(fixture.threadId)
    ).filter((event) => event.runId === firstRecovery.id);
    expect(
      buildRunRecoveryPrompt(
        fixture.store
          .listRuns(fixture.threadId)
          .find((run) => run.id === firstRecovery.id)!,
        undefined,
        firstRecoveryEvents,
      ),
    ).toContain("Private local Web Fetch Sources");
    expect(
      buildRunRecoveryPrompt(
        fixture.store
          .listRuns(fixture.threadId)
          .find((run) => run.id === firstRecovery.id)!,
        undefined,
        firstRecoveryEvents,
        "automatic",
      ),
    ).not.toContain("Private local Web Fetch Sources");
    await fixture.store.finishRun(firstRecovery.id, "interrupted");
    const second = await fixture.store.createRun({
      threadId: fixture.threadId,
      agentId: fixture.agentId,
      source: "recovery",
      parentRunId: firstRecovery.id,
    });
    const secondManager = manager(fixture, { request: vi.fn() }, capsules);
    await expect(
      secondManager.execute(
        { threadId: fixture.threadId, runId: second.id },
        { action: "list" },
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        output: expect.stringContaining(fetched.details.sourceId!),
      }),
    );
    await fixture.store.finishRun(second.id, "completed");
    const detail = await fixture.store.getDetail(fixture.threadId);
    const imported = await fixture.store.importThreadReplayBundle(
      createThreadReplayBundle(detail),
      "Imported Web Fetch continuity",
    );
    expect(
      imported.events.some(
        (event) => event.type === "context.web_fetch_sources",
      ),
    ).toBe(false);
    const importedFetch = imported.events.find(
      (event) =>
        event.type === "tool.completed" &&
        event.payload["toolName"] === "web_fetch",
    )!;
    expect(
      (importedFetch.payload["details"] as Record<string, unknown>)[
        "stateCapsule"
      ],
    ).toBeUndefined();
    fixture.store.close();
  });

  it("rejects malformed local-only receipts before Ledger projection", () => {
    expect(() =>
      webFetchToolOutputLedgerProjection("redacted", {
        details: {
          kind: "napier.web-fetch",
          schemaVersion: 1,
          action: "list",
          sourceCount: 1,
          sourceSetSha256: "a".repeat(64),
          stateCapsule: {
            kind: "napier.web-fetch-state-capsule-receipt",
            schemaVersion: 1,
            sourceRunId: "run_fixture12345678",
            sourceCount: 1,
            sourceSetSha256: "a".repeat(64),
            manifestCapsuleSha256: "b".repeat(64),
            manifestCapsuleBytes: 1_024,
            storage: "persisted",
            contentSha256: "c".repeat(64),
          },
        },
      }),
    ).toThrow("receipt is invalid");
  });

  it("binds the Ledger manifest byte count to the private capsule", async () => {
    const fixture = await continuityFixture();
    const capsules = new WebFetchCapsuleStore(fixture.dataRoot);
    const owner = { threadId: fixture.threadId, runId: fixture.parentRunId };
    const fetched = await manager(
      fixture,
      {
        request: vi.fn(async () =>
          response("FETCH_MANIFEST_BYTES", "text/plain"),
        ),
      },
      capsules,
    ).execute(owner, {
      action: "fetch",
      url: "https://example.com/bytes.txt",
    });
    const receipt = fetched.details.stateCapsule!;
    const manifest = await capsules.readManifest(receipt.manifestCapsuleSha256);
    await appendCompletion(fixture.store, owner, {
      ...fetched.details,
      stateCapsule: createWebFetchStateCapsuleReceipt(
        manifest,
        receipt.manifestCapsuleBytes + 1,
      ),
    });
    await fixture.store.finishRun(fixture.parentRunId, "interrupted");
    const recovery = await fixture.store.createRun({
      threadId: fixture.threadId,
      agentId: fixture.agentId,
      source: "recovery",
      parentRunId: fixture.parentRunId,
    });

    await expect(
      manager(fixture, { request: vi.fn() }, capsules).execute(
        { threadId: fixture.threadId, runId: recovery.id },
        { action: "list" },
      ),
    ).rejects.toThrow("manifest does not match Ledger");
    fixture.store.close();
  });

  it("round-trips live plain-text tabs through private Source capsules", async () => {
    const fixture = await continuityFixture();
    const capsules = new WebFetchCapsuleStore(fixture.dataRoot);
    const owner = { threadId: fixture.threadId, runId: fixture.parentRunId };
    const fetched = await manager(
      fixture,
      {
        request: vi.fn(async () =>
          response(
            "name\tvalue\nalpha\t1",
            "text/tab-separated-values",
            "https://example.com/table.tsv",
          ),
        ),
      },
      capsules,
    ).execute(owner, {
      action: "fetch",
      url: "https://example.com/table.tsv",
    });

    const manifest = await capsules.readManifest(
      fetched.details.stateCapsule!.manifestCapsuleSha256,
    );
    const source = await capsules.readSource(
      manifest.sources[0]!.capsuleSha256,
    );

    expect(source.source.lines).toEqual(["name\tvalue", "alpha\t1"]);
    fixture.store.close();
  });
});

async function continuityFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-fetch-continuity-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  const store = new LocalStore({ workspaceRoot, dataRoot });
  await store.initialize();
  const agentId = store.listAgents()[0]!.id;
  const thread = await store.createThread({
    title: "Web Fetch continuity",
    agentId,
  });
  const parent = await store.createRun({ threadId: thread.id, agentId });
  return {
    store,
    workspaceRoot,
    dataRoot,
    agentId,
    threadId: thread.id,
    parentRunId: parent.id,
  };
}

function manager(
  fixture: Awaited<ReturnType<typeof continuityFixture>>,
  http: {
    request: (
      request: unknown,
      signal?: AbortSignal,
    ) => Promise<PublicHttpResponse>;
  },
  capsules: WebFetchCapsuleStore,
) {
  return new RunWebFetchSourceManager({
    http,
    capsules,
    store: fixture.store,
    now: () => new Date("2026-08-05T00:00:00.000Z"),
  });
}

async function appendCompletion(
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
      callId: "web-fetch-continuity",
      toolName: "web_fetch",
      status: "completed",
      details,
    },
  });
}

async function appendSaveCompletion(
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
      callId: "save_source",
      toolName: "web_fetch_save",
      status: "completed",
      details: JSON.parse(JSON.stringify(details)),
    },
  });
}

function response(
  body: string,
  contentType: string,
  finalUrl = "https://example.com/source",
): PublicHttpResponse {
  return {
    status: 200,
    headers: { "content-type": contentType },
    body: Buffer.from(body),
    finalUrl,
    redirectCount: 0,
  };
}

function minimalPdf(text: string): string {
  const escaped = text.replace(/[\\()]/gu, "\\$&");
  const stream = `BT /F1 18 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    output += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  return `${output}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}
