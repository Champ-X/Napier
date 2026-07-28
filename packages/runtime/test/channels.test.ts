import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fauxProvider } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentRuntime } from "../src/agent-runtime.js";
import { ChannelService } from "../src/channels.js";
import {
  createInboundDeadLetterRetryHistory,
  createInboundDeadLetterRetryPreview,
  verifyInboundDeadLetterExportArtifact,
  verifyInboundDeadLetterRetryHistory,
} from "../src/inbound-dead-letters.js";
import { ModelRegistry } from "../src/models.js";
import { LocalStore } from "../src/store.js";

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-channels-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot, { recursive: true });
  const store = new LocalStore({ dataRoot, workspaceRoot });
  await store.initialize();
  const runtime = new AgentRuntime(store, new ModelRegistry());
  return { root, dataRoot, workspaceRoot, store, runtime };
}

describe("inbound webhook channels", () => {
  it("deduplicates deliveries and runs accepted messages through the ledger", async () => {
    const { dataRoot, store, runtime } = await createFixture();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Inbound ledger",
      agentId: agent.id,
    });
    const created = await store.createInboundChannel({
      name: "Build notifications",
      threadId: thread.id,
      signaturePolicy: { required: true, toleranceSeconds: 300 },
    });
    expect(created.channel.policyTemplate).toBe("signed_standard");
    expect(created.channel.adapter).toBe("napier_json");
    expect(created.channel.signaturePolicy).toEqual({
      required: true,
      algorithm: "hmac-sha256",
      header: "X-Napier-Channel-Signature",
      timestampHeader: "X-Napier-Channel-Timestamp",
      toleranceSeconds: 300,
    });
    const channels = new ChannelService(store, runtime);
    const request = {
      idempotencyKey: "delivery-2026-07-25-0001",
      message: "Review this inbound build notification.",
      bodySha256: "a".repeat(64),
      adapterCatalogSha256: "b".repeat(64),
    };

    await expect(
      channels.accept(
        created.channel.id,
        "wrong-token-value-000000000000",
        request,
      ),
    ).rejects.toThrow("token is invalid");
    const rotated = await store.rotateInboundChannelToken(created.channel.id);
    expect(rotated.channel).toEqual(
      expect.objectContaining({
        id: created.channel.id,
        revision: created.channel.revision + 1,
      }),
    );
    expect(rotated.token).not.toBe(created.token);
    expect(rotated.channel.tokenFingerprint).not.toBe(
      created.channel.tokenFingerprint,
    );
    await expect(
      channels.accept(created.channel.id, created.token, request),
    ).rejects.toThrow("token is invalid");
    const accepted = await channels.accept(
      created.channel.id,
      rotated.token,
      request,
    );
    expect(accepted.duplicate).toBe(false);
    expect(accepted.delivery.triggerId).toBe(
      `channel:${created.channel.id}:${accepted.delivery.id}`,
    );
    expect(accepted.delivery).toEqual(
      expect.objectContaining({
        bodySha256: request.bodySha256,
        adapterCatalogSha256: request.adapterCatalogSha256,
      }),
    );
    const duplicate = await channels.accept(
      created.channel.id,
      rotated.token,
      request,
    );
    expect(duplicate).toEqual({
      delivery: expect.objectContaining({ id: accepted.delivery.id }),
      duplicate: true,
    });
    await channels.drain();

    expect(store.listInboundDeliveries(created.channel.id)).toEqual([
      expect.objectContaining({
        id: accepted.delivery.id,
        status: "completed",
        attemptCount: 1,
        maxAttempts: 3,
        bodySha256: request.bodySha256,
        adapterCatalogSha256: request.adapterCatalogSha256,
        runId: expect.any(String),
      }),
    ]);
    expect(store.listRuns(thread.id)).toEqual([
      expect.objectContaining({
        source: "channel",
        status: "completed",
        triggerId: accepted.delivery.triggerId,
      }),
    ]);
    const state = await readFile(path.join(dataRoot, "workspace.json"), "utf8");
    expect(state).not.toContain(created.token);
    expect(state).not.toContain(rotated.token);
    expect(state).not.toContain(request.idempotencyKey);
    const events = await store.listEvents(thread.id);
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "channel.delivery.accepted",
        "channel.delivery.started",
        "channel.delivery.completed",
      ]),
    );
    expect(
      events.find((event) => event.type === "channel.delivery.accepted"),
    ).toEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          channelId: created.channel.id,
          adapter: "napier_json",
          channelRevision: rotated.channel.revision,
          bodySha256: request.bodySha256,
          adapterCatalogSha256: request.adapterCatalogSha256,
          idempotencyFingerprint: expect.stringMatching(/^[a-f0-9]{12}$/),
        }),
      }),
    );
  });

  it("applies inbound channel policy templates and derives custom revisions", async () => {
    const { dataRoot, store } = await createFixture();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Template governed inbound channels",
      agentId: agent.id,
    });

    const legacy = await store.createInboundChannel({
      name: "Legacy hook",
      threadId: thread.id,
    });
    expect(legacy.channel).toEqual(
      expect.objectContaining({
        adapter: "napier_json",
        policyTemplate: "legacy_bearer",
        retryPolicy: { maxAttempts: 3, baseDelayMs: 5_000 },
        signaturePolicy: expect.objectContaining({
          required: false,
          toleranceSeconds: 300,
        }),
      }),
    );

    const strict = await store.createInboundChannel({
      name: "Strict hook",
      threadId: thread.id,
      policyTemplate: "signed_strict",
    });
    expect(strict.channel).toEqual(
      expect.objectContaining({
        adapter: "napier_json",
        policyTemplate: "signed_strict",
        retryPolicy: { maxAttempts: 2, baseDelayMs: 1_000 },
        signaturePolicy: expect.objectContaining({
          required: true,
          toleranceSeconds: 60,
        }),
      }),
    );
    await expect(
      store.createInboundChannel({
        name: "Confused hook",
        threadId: thread.id,
        policyTemplate: "signed_standard",
        retryPolicy: { maxAttempts: 4, baseDelayMs: 1_000 },
      }),
    ).rejects.toThrow("cannot be combined");

    const github = await store.createInboundChannel({
      name: "GitHub hook",
      threadId: thread.id,
      adapter: "github_webhook",
      policyTemplate: "signed_standard",
    });
    expect(github.channel).toEqual(
      expect.objectContaining({
        adapter: "github_webhook",
        policyTemplate: "signed_standard",
      }),
    );
    const slack = await store.createInboundChannel({
      name: "Slack hook",
      threadId: thread.id,
      adapter: "slack_event",
      policyTemplate: "signed_standard",
    });
    expect(slack.channel).toEqual(
      expect.objectContaining({
        adapter: "slack_event",
        policyTemplate: "signed_standard",
      }),
    );
    const linear = await store.createInboundChannel({
      name: "Linear hook",
      threadId: thread.id,
      adapter: "linear_webhook",
      policyTemplate: "signed_standard",
    });
    expect(linear.channel).toEqual(
      expect.objectContaining({
        adapter: "linear_webhook",
        policyTemplate: "signed_standard",
      }),
    );
    await expect(
      store.createInboundChannel({
        name: "Unknown adapter",
        threadId: thread.id,
        adapter: "slack_webhook" as never,
      }),
    ).rejects.toThrow("Inbound channel adapter is invalid");

    const custom = await store.updateInboundRetryPolicy(strict.channel.id, {
      maxAttempts: 4,
      baseDelayMs: 1_000,
    });
    expect(custom.policyTemplate).toBe("custom");
    const standard = await store.updateInboundRetryPolicy(strict.channel.id, {
      maxAttempts: 3,
      baseDelayMs: 5_000,
    });
    expect(standard.policyTemplate).toBe("custom");
    const signedStandard = await store.updateInboundSignaturePolicy(
      strict.channel.id,
      {
        required: true,
        toleranceSeconds: 300,
      },
    );
    expect(signedStandard.policyTemplate).toBe("signed_standard");

    const state = await readFile(path.join(dataRoot, "workspace.json"), "utf8");
    expect(state).toContain('"adapter": "github_webhook"');
    expect(state).toContain('"adapter": "slack_event"');
    expect(state).toContain('"adapter": "linear_webhook"');
    expect(state).toContain('"policyTemplate"');
    expect(state).not.toContain(strict.token);
    expect(state).not.toContain(github.token);
    expect(state).not.toContain(slack.token);
    expect(state).not.toContain(linear.token);
  });

  it("revises inbound signature policy without exposing signing material", async () => {
    const { dataRoot, store } = await createFixture();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Signature policy governance",
      agentId: agent.id,
    });
    const created = await store.createInboundChannel({
      name: "Governed signatures",
      threadId: thread.id,
    });
    expect(created.channel.policyTemplate).toBe("legacy_bearer");

    const updated = await store.updateInboundSignaturePolicy(
      created.channel.id,
      {
        required: true,
        toleranceSeconds: 30,
      },
    );
    expect(updated).toEqual(
      expect.objectContaining({
        signaturePolicy: {
          required: true,
          algorithm: "hmac-sha256",
          header: "X-Napier-Channel-Signature",
          timestampHeader: "X-Napier-Channel-Timestamp",
          toleranceSeconds: 30,
        },
        policyTemplate: "custom",
        revision: created.channel.revision + 1,
      }),
    );

    const unchanged = await store.updateInboundSignaturePolicy(
      created.channel.id,
      {
        required: true,
        toleranceSeconds: 30,
      },
    );
    expect(unchanged.revision).toBe(updated.revision);
    await expect(
      store.updateInboundSignaturePolicy(created.channel.id, {
        required: true,
        toleranceSeconds: 10,
      }),
    ).rejects.toThrow("Inbound signature toleranceSeconds");

    const state = await readFile(path.join(dataRoot, "workspace.json"), "utf8");
    expect(state).not.toContain(created.token);
    expect(state).toContain('"signaturePolicy"');
  });

  it("backs off pre-run failures and uses a distinct trigger for the next attempt", async () => {
    const { store, runtime } = await createFixture();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Retrying inbound delivery",
      agentId: agent.id,
    });
    const created = await store.createInboundChannel({
      name: "Retry hook",
      threadId: thread.id,
      retryPolicy: {
        maxAttempts: 3,
        baseDelayMs: 250,
      },
    });
    const receipt = await store.acceptInboundDelivery(
      created.channel.id,
      created.token,
      {
        idempotencyKey: "retry-2026-07-25-0001",
        message: "Complete this delivery after dispatch recovers.",
      },
    );
    vi.spyOn(runtime, "runPrompt").mockRejectedValueOnce(
      new Error("Dispatcher temporarily unavailable"),
    );
    const channels = new ChannelService(store, runtime);
    const firstAttemptAt = new Date("2026-07-25T00:00:00.000Z");

    await channels.drain(firstAttemptAt);
    const deferred = store.listInboundDeliveries(created.channel.id)[0]!;
    expect(deferred).toEqual(
      expect.objectContaining({
        id: receipt.delivery.id,
        status: "retrying",
        attemptCount: 1,
        maxAttempts: 3,
        retryBaseMs: 250,
        nextAttemptAt: "2026-07-25T00:00:00.250Z",
        error: "Dispatcher temporarily unavailable",
      }),
    );
    expect(store.listRuns(thread.id)).toHaveLength(0);

    await channels.drain(new Date("2026-07-25T00:00:00.249Z"));
    expect(
      store.listInboundDeliveries(created.channel.id)[0]?.attemptCount,
    ).toBe(1);

    await channels.drain(new Date("2026-07-25T00:00:00.250Z"));
    expect(store.listInboundDeliveries(created.channel.id)).toEqual([
      expect.objectContaining({
        status: "completed",
        attemptCount: 2,
        runId: expect.any(String),
      }),
    ]);
    expect(store.listRuns(thread.id)).toEqual([
      expect.objectContaining({
        status: "completed",
        source: "channel",
        triggerId: `${receipt.delivery.triggerId}:attempt:2`,
      }),
    ]);
    expect(
      (await store.listEvents(thread.id)).map((event) => event.type),
    ).toEqual(
      expect.arrayContaining([
        "channel.delivery.retry.scheduled",
        "channel.delivery.completed",
      ]),
    );
  });

  it("retries a delivery before creating a Run when its model is unavailable", async () => {
    const { store, runtime } = await createFixture();
    const unavailable = fauxProvider({ provider: "faux-channel-unavailable" });
    runtime.modelRegistry.registerProvider({
      ...unavailable.provider,
      auth: {
        apiKey: {
          name: "Unavailable",
          resolve: async () => undefined,
        },
      },
    });
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Unavailable inbound model",
      agentId: agent.id,
    });
    const created = await store.createInboundChannel({
      name: "Unavailable hook",
      threadId: thread.id,
      retryPolicy: {
        maxAttempts: 3,
        baseDelayMs: 250,
      },
    });
    const receipt = await store.acceptInboundDelivery(
      created.channel.id,
      created.token,
      {
        idempotencyKey: "unavailable-channel-model-0001",
        message: "This delivery should wait for credentials.",
        model: { provider: "faux-channel-unavailable", id: "faux-1" },
      },
    );
    const channels = new ChannelService(store, runtime);

    await channels.drain(new Date("2026-07-25T00:00:00.000Z"));

    expect(store.listRuns(thread.id)).toHaveLength(0);
    expect(store.listInboundDeliveries(created.channel.id)).toEqual([
      expect.objectContaining({
        id: receipt.delivery.id,
        status: "retrying",
        attemptCount: 1,
        error: "Model provider is not configured: faux-channel-unavailable",
        nextAttemptAt: "2026-07-25T00:00:00.250Z",
      }),
    ]);
    const events = await store.listEvents(thread.id);
    expect(events.map((event) => event.type)).toEqual([
      "channel.delivery.started",
      "channel.delivery.retry.scheduled",
    ]);
    expect(events[1]?.payload).toEqual(
      expect.objectContaining({
        error: "Model provider is not configured: faux-channel-unavailable",
        status: "retrying",
        attempt: 1,
      }),
    );
  });

  it("snapshots per-channel retry policy and exports redacted dead letters", async () => {
    const { store } = await createFixture();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Dead-letter evidence",
      agentId: agent.id,
    });
    const created = await store.createInboundChannel({
      name: "Governed hook",
      threadId: thread.id,
      retryPolicy: {
        maxAttempts: 2,
        baseDelayMs: 250,
      },
    });
    const message = "Inspect the private failed deployment payload.";
    const idempotencyKey = "dead-letter-2026-07-25-0001";
    const first = await store.acceptInboundDelivery(
      created.channel.id,
      created.token,
      {
        idempotencyKey,
        message,
        bodySha256: "e".repeat(64),
        adapterCatalogSha256: "f".repeat(64),
      },
    );
    expect(first.delivery).toEqual(
      expect.objectContaining({
        maxAttempts: 2,
        retryBaseMs: 250,
      }),
    );

    const updated = await store.updateInboundRetryPolicy(created.channel.id, {
      maxAttempts: 4,
      baseDelayMs: 1_000,
    });
    expect(updated).toEqual(
      expect.objectContaining({
        retryPolicy: {
          maxAttempts: 4,
          baseDelayMs: 1_000,
        },
        revision: created.channel.revision + 1,
      }),
    );
    const second = await store.acceptInboundDelivery(
      created.channel.id,
      created.token,
      {
        idempotencyKey: "dead-letter-2026-07-25-0002",
        message: "Use the revised delivery policy.",
      },
    );
    expect(second.delivery).toEqual(
      expect.objectContaining({
        maxAttempts: 4,
        retryBaseMs: 1_000,
      }),
    );
    expect(
      store
        .listInboundDeliveries(created.channel.id)
        .find((delivery) => delivery.id === first.delivery.id),
    ).toEqual(
      expect.objectContaining({
        maxAttempts: 2,
        retryBaseMs: 250,
      }),
    );

    await store.claimInboundDelivery(first.delivery.id);
    await store.finishInboundDelivery(first.delivery.id, {
      status: "failed",
      error: "Private delivery failed.",
    });
    const firstExport = store.exportInboundDeadLetters(
      created.channel.id,
      new Date("2026-07-25T01:00:00.000Z"),
      "f".repeat(64),
    );
    const repeatedExport = store.exportInboundDeadLetters(
      created.channel.id,
      new Date("2026-07-25T02:00:00.000Z"),
      "f".repeat(64),
    );
    expect(firstExport).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        currentAdapterCatalogSha256: "f".repeat(64),
        qualifiedCount: 1,
        evidenceMissingCount: 0,
        adapterCatalogDriftCount: 0,
        deliveryCount: 1,
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        deliveries: [
          expect.objectContaining({
            deliveryId: first.delivery.id,
            retryDisposition: "manual_retry_available",
            qualificationStatus: "qualified",
            messageSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            bodySha256: "e".repeat(64),
            adapterCatalogSha256: "f".repeat(64),
            maxAttempts: 2,
            retryBaseMs: 250,
          }),
        ],
      }),
    );
    expect(repeatedExport.exportedAt).not.toBe(firstExport.exportedAt);
    expect(repeatedExport.contentSha256).toBe(firstExport.contentSha256);
    const verification = verifyInboundDeadLetterExportArtifact(firstExport, {
      expectedChannelId: created.channel.id,
    });
    expect(verification).toEqual(
      expect.objectContaining({
        status: "valid",
        channelId: created.channel.id,
        declaredContentSha256: firstExport.contentSha256,
        recomputedContentSha256: firstExport.contentSha256,
        deliveryCount: 1,
        observedDeliveryCount: 1,
        qualifiedCount: 1,
        observedQualifiedCount: 1,
        evidenceMissingCount: 0,
        observedEvidenceMissingCount: 0,
        adapterCatalogDriftCount: 0,
        observedAdapterCatalogDriftCount: 0,
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(
      verifyInboundDeadLetterExportArtifact({
        ...firstExport,
        qualifiedCount: 0,
      }),
    ).toEqual(
      expect.objectContaining({
        status: "invalid",
        qualifiedCount: 0,
        observedQualifiedCount: 1,
      }),
    );
    const retryPreview = createInboundDeadLetterRetryPreview(
      firstExport,
      store.listInboundDeliveries(created.channel.id),
      { expectedChannelId: created.channel.id },
    );
    expect(retryPreview).toEqual(
      expect.objectContaining({
        verificationStatus: "valid",
        artifactSha256: firstExport.contentSha256,
        retryableCount: 1,
        blockedCount: 0,
        candidateSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        retryableDeliveryIdsSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        blockedDeliveryIdsSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        candidates: [
          expect.objectContaining({
            deliveryId: first.delivery.id,
            status: "retryable",
            attemptCount: 1,
            maxAttempts: 2,
            bodySha256: "e".repeat(64),
            adapterCatalogSha256: "f".repeat(64),
          }),
        ],
      }),
    );
    const retryAuditEvent = await store.appendEvent({
      threadId: thread.id,
      runId: "runctl_dead_letter_history",
      type: "channel.dead_letters.retry_applied",
      category: "channel",
      visibility: "user",
      payload: {
        channelId: created.channel.id,
        applyResultSha256: "a".repeat(64),
        previewSha256: retryPreview.contentSha256,
        artifactSha256: firstExport.contentSha256,
        previewCandidateSetSha256: retryPreview.candidateSetSha256,
        previewRetryableDeliveryIdsSha256:
          retryPreview.retryableDeliveryIdsSha256,
        previewBlockedDeliveryIdsSha256: retryPreview.blockedDeliveryIdsSha256,
        retriedCount: 1,
        skippedCount: 0,
        retriedDeliveryIdsSha256: retryPreview.retryableDeliveryIdsSha256,
        skippedDeliveryIdsSha256: retryPreview.blockedDeliveryIdsSha256,
      },
    });
    const retryHistory = createInboundDeadLetterRetryHistory(
      created.channel.id,
      await store.listEvents(thread.id),
    );
    const retryHistoryVerification = verifyInboundDeadLetterRetryHistory(
      retryHistory,
      {
        expectedChannelId: created.channel.id,
        events: await store.listEvents(thread.id),
      },
    );
    expect(retryHistoryVerification).toEqual(
      expect.objectContaining({
        status: "valid",
        channelId: created.channel.id,
        expectedChannelId: created.channel.id,
        declaredContentSha256: retryHistory.contentSha256,
        recomputedContentSha256: retryHistory.contentSha256,
        observedContentSha256: retryHistory.contentSha256,
        declaredEventSetSha256: retryHistory.eventSetSha256,
        observedEventSetSha256: retryHistory.eventSetSha256,
        eventCount: 1,
        observedEventCount: 1,
        fromSeq: retryAuditEvent.seq,
        observedFromSeq: retryAuditEvent.seq,
        toSeq: retryAuditEvent.seq,
        observedToSeq: retryAuditEvent.seq,
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(
      verifyInboundDeadLetterRetryHistory(
        { ...retryHistory, eventCount: 0 },
        {
          expectedChannelId: created.channel.id,
          events: await store.listEvents(thread.id),
        },
      ),
    ).toEqual(
      expect.objectContaining({
        status: "invalid",
        eventCount: 0,
        observedEventCount: 1,
      }),
    );
    expect(retryHistory).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        channelId: created.channel.id,
        eventCount: 1,
        fromSeq: retryAuditEvent.seq,
        toSeq: retryAuditEvent.seq,
        eventSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        records: [
          expect.objectContaining({
            eventId: retryAuditEvent.id,
            seq: retryAuditEvent.seq,
            applyResultSha256: "a".repeat(64),
            previewSha256: retryPreview.contentSha256,
            artifactSha256: firstExport.contentSha256,
            previewCandidateSetSha256: retryPreview.candidateSetSha256,
            retriedCount: 1,
            skippedCount: 0,
          }),
        ],
      }),
    );
    const serialized = JSON.stringify(firstExport);
    expect(serialized).not.toContain(created.token);
    expect(serialized).not.toContain(idempotencyKey);
    expect(serialized).not.toContain(message);
    expect(JSON.stringify(retryHistory)).not.toContain(idempotencyKey);
    expect(JSON.stringify(retryHistory)).not.toContain(message);

    await store.retryInboundDelivery(created.channel.id, first.delivery.id);
    expect(
      createInboundDeadLetterRetryPreview(
        firstExport,
        store.listInboundDeliveries(created.channel.id),
        { expectedChannelId: created.channel.id },
      ),
    ).toEqual(
      expect.objectContaining({
        retryableCount: 0,
        blockedCount: 1,
        candidateSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        retryableDeliveryIdsSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        blockedDeliveryIdsSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        candidates: [
          expect.objectContaining({
            deliveryId: first.delivery.id,
            status: "not_failed",
          }),
        ],
      }),
    );
    await store.claimInboundDelivery(first.delivery.id);
    await store.finishInboundDelivery(first.delivery.id, {
      status: "failed",
      error: "Second failure exhausted the snapshot policy.",
    });
    expect(
      store.exportInboundDeadLetters(created.channel.id).deliveries[0],
    ).toEqual(
      expect.objectContaining({
        attemptCount: 2,
        retryDisposition: "retry_exhausted",
      }),
    );
  });

  it("rejects disabled channels and fails running deliveries on restart", async () => {
    const { dataRoot, workspaceRoot, store } = await createFixture();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Restarted inbound delivery",
      agentId: agent.id,
    });
    const created = await store.createInboundChannel({
      name: "Deploy hook",
      threadId: thread.id,
    });
    const receipt = await store.acceptInboundDelivery(
      created.channel.id,
      created.token,
      {
        idempotencyKey: "deploy-2026-07-25-0001",
        message: "Inspect the deployment.",
      },
    );
    expect(await store.claimInboundDelivery(receipt.delivery.id)).toBeDefined();

    const reopened = new LocalStore({ dataRoot, workspaceRoot });
    await reopened.initialize();
    expect(reopened.listInboundDeliveries(created.channel.id)).toEqual([
      expect.objectContaining({
        id: receipt.delivery.id,
        status: "failed",
        attemptCount: 1,
        error: expect.stringContaining("Runtime restarted"),
      }),
    ]);
    const retry = await reopened.retryInboundDelivery(
      created.channel.id,
      receipt.delivery.id,
    );
    expect(retry).toEqual(
      expect.objectContaining({
        status: "retrying",
        attemptCount: 1,
        nextAttemptAt: expect.any(String),
      }),
    );
    expect(
      await reopened.claimInboundDelivery(
        receipt.delivery.id,
        new Date(retry.nextAttemptAt!),
      ),
    ).toEqual(
      expect.objectContaining({
        delivery: expect.objectContaining({
          status: "running",
          attemptCount: 2,
        }),
      }),
    );
    await reopened.finishInboundDelivery(receipt.delivery.id, {
      status: "failed",
      error: "Second attempt failed.",
    });
    await reopened.retryInboundDelivery(
      created.channel.id,
      receipt.delivery.id,
    );
    await reopened.claimInboundDelivery(receipt.delivery.id);
    await reopened.finishInboundDelivery(receipt.delivery.id, {
      status: "failed",
      error: "Third attempt failed.",
    });
    await expect(
      reopened.retryInboundDelivery(created.channel.id, receipt.delivery.id),
    ).rejects.toThrow("retry limit is exhausted");
    await reopened.setInboundChannelStatus(created.channel.id, "disabled");
    await expect(
      reopened.acceptInboundDelivery(created.channel.id, created.token, {
        idempotencyKey: "deploy-2026-07-25-0002",
        message: "Must be rejected.",
      }),
    ).rejects.toThrow("channel is disabled");
  });
});
