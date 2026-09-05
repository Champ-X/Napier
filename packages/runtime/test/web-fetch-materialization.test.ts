import { describe, expect, it, vi } from "vitest";

import { canonicalJson, sha256 } from "../src/ed25519.js";
import { createOwnedToolRecordV2 } from "../src/owned-tool-protocol.js";
import type { PublicHttpResponse } from "../src/public-http-client.js";
import {
  createWebFetchMaterializationIdentity,
  findWebFetchMaterialization,
  materializeWebFetchSource,
  snapshotWebFetchMaterializationIdentity,
} from "../src/web-fetch-materialization.js";
import { webFetchFailureReceipt } from "../src/web-fetch-failure.js";
import type { WebFetchSource } from "../src/web-fetch-model.js";
import { RunWebFetchSourceManager } from "../src/web-fetch-sources.js";
import { createWebFetchTool } from "../src/web-fetch-tool.js";

const OWNER = { threadId: "thread_materialized", runId: "run_materialized" };

describe("web fetch materialization", () => {
  it("reuses the exact Source for one durable call without refetching", async () => {
    const http = { request: vi.fn(async () => response("stable evidence")) };
    const manager = new RunWebFetchSourceManager({
      http,
      now: () => new Date("2026-09-04T01:02:03.000Z"),
    });
    const tool = createWebFetchTool(manager, OWNER);
    const request = {
      action: "fetch" as const,
      url: "https://example.com/evidence",
    };

    const first = await tool.execute("call_materialized", request);
    const second = await tool.execute("call_materialized", request);
    const listed = await manager.execute(OWNER, { action: "list" });

    expect(http.request).toHaveBeenCalledTimes(1);
    expect(first.details.sourceId).toBe(second.details.sourceId);
    expect(first.details.sourceId).toMatch(/^websource_[a-f0-9]{64}$/u);
    expect(listed.details.sourceCount).toBe(1);
  });

  it("keeps distinct durable calls distinct even when content is equal", async () => {
    const http = { request: vi.fn(async () => response("same evidence")) };
    const manager = new RunWebFetchSourceManager({ http });
    const tool = createWebFetchTool(manager, OWNER);
    const request = {
      action: "fetch" as const,
      url: "https://example.com/evidence",
    };

    const first = await tool.execute("call_one", request);
    const second = await tool.execute("call_two", request);

    expect(http.request).toHaveBeenCalledTimes(2);
    expect(first.details.sourceId).not.toBe(second.details.sourceId);
    await expect(manager.execute(OWNER, { action: "list" })).resolves.toEqual(
      expect.objectContaining({
        details: expect.objectContaining({ sourceCount: 2 }),
      }),
    );
  });

  it("binds the Source namespace to both call identity and content", () => {
    const identity = createWebFetchMaterializationIdentity(
      OWNER,
      "call_bound",
      "https://example.com/evidence",
    );
    const first = materializeWebFetchSource(source("a"), identity);
    const second = materializeWebFetchSource(source("b"), identity);

    expect(first.id.slice(0, 42)).toBe(second.id.slice(0, 42));
    expect(first.id).not.toBe(second.id);
    expect(() =>
      findWebFetchMaterialization(
        new Map([
          [first.id, first],
          [second.id, second],
        ]),
        identity,
      ),
    ).toThrow("conflicting Sources");
  });

  it("snapshots caller-owned identity data before asynchronous execution", () => {
    const identity = {
      ...createWebFetchMaterializationIdentity(
        OWNER,
        "call_snapshot",
        "https://example.com/evidence",
      ),
    };
    const expected = identity.materializationSha256;
    const snapshot = snapshotWebFetchMaterializationIdentity(identity)!;

    identity.materializationSha256 = "f".repeat(64);

    expect(snapshot.materializationSha256).toBe(expected);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it("preserves typed cancellation semantics at the executor boundary", async () => {
    const manager = new RunWebFetchSourceManager();
    const request = {
      action: "fetch" as const,
      url: "https://example.com/evidence",
    };
    const controller = new AbortController();
    controller.abort();

    const failure = await manager
      .execute(OWNER, request, controller.signal)
      .catch((error: unknown) => error);

    expect(webFetchFailureReceipt(request, failure)).toEqual(
      expect.objectContaining({
        coverage: "trusted_declared",
        modeId: "cancelled",
        class: "cancelled",
        scope: "invocation",
      }),
    );
  });

  it("declares no retry after execution starts and retains prior ABI replay", () => {
    const manager = new RunWebFetchSourceManager();
    const owned = createOwnedToolRecordV2(createWebFetchTool(manager, OWNER));

    expect(owned.definition.concurrency).toBe("serialized");
    expect(owned.definition.retry).toEqual({
      strategy: "not_started",
      maxAttempts: 2,
    });
    expect(
      owned.invocation({
        action: "fetch",
        url: "https://example.com/evidence",
      }).progress,
    ).toEqual(
      expect.objectContaining({
        operation: "acquire",
        scope: "run_source",
        failureBindings: expect.objectContaining({
          origin: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      }),
    );
    expect(
      owned.matchesReplayIdentitySha256(
        "a6fcdcbc4375bbd96512625112cfa4954b0d146a3f662f55fad86b4142d3a46b",
      ),
    ).toBe(true);
    expect(
      owned.matchesDefinitionSha256(
        "a6fcdcbc4375bbd96512625112cfa4954b0d146a3f662f55fad86b4142d3a46b",
      ),
    ).toBe(false);
  });
});

function response(body: string): PublicHttpResponse {
  return {
    status: 200,
    headers: { "content-type": "text/plain" },
    body: Buffer.from(body),
    finalUrl: "https://example.com/evidence",
    redirectCount: 0,
  };
}

function source(value: string): WebFetchSource {
  const contentSha256 = sha256Lines([value]);
  return {
    id: "websource_original0",
    finalUrl: "https://example.com/evidence",
    title: "Evidence",
    retrievedAt: "2026-09-04T01:02:03.000Z",
    contentType: "text/plain",
    format: "text",
    bodySha256: "1".repeat(64),
    contentSha256,
    bodyBytes: value.length,
    lineCount: 1,
    textChars: value.length,
    truncated: false,
    redirectCount: 0,
    renderMode: "static",
    browserFallbackStatus: "not_needed",
    lines: [value],
  };
}

function sha256Lines(lines: string[]): string {
  return sha256(canonicalJson(lines));
}
