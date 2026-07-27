import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  ReceiptTrustAnchorDirectory,
  ReceiptTrustAnchorDirectorySubscription,
  ReceiptTrustAnchorDirectorySubscriptionRefreshResult,
} from "@napier/contracts";
import {
  createReceiptTrustAnchor,
  createReceiptTrustAnchorDirectory,
} from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import {
  createApp,
  createServices as createNapierServices,
} from "../src/app.js";

const temporaryRoots: string[] = [];
const openServices: Awaited<ReturnType<typeof createNapierServices>>[] = [];

afterEach(async () => {
  for (const services of openServices.splice(0)) {
    await services.receiptTrustDirectorySubscriptions.stop();
    await services.recovery.stop();
    await services.automation.stop();
    await services.channels.stop();
    await services.extensions.shutdown();
    services.store.close();
  }
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("receipt trust anchor directory subscription HTTP surface", () => {
  it("promotes only valid CAS-bound refreshes and retains last-good trust", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-trust-sub-http-"));
    temporaryRoots.push(root);
    const sourceUrl = "https://trust.example.test/napier/anchors.json";
    let hostedDirectory: ReceiptTrustAnchorDirectory | undefined;
    let responseMode: "valid" | "invalid" | "failure" = "valid";
    let fetchCount = 0;
    const services = await createNapierServices({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
      receiptTrustDirectoryDiscovery: {
        allowedOrigins: ["https://trust.example.test"],
        validateEndpoint: async () => undefined,
        fetcher: async () => {
          fetchCount += 1;
          if (responseMode === "failure") {
            throw new Error("private upstream detail");
          }
          if (!hostedDirectory) throw new Error("Directory is unavailable");
          const value =
            responseMode === "invalid"
              ? {
                  ...hostedDirectory,
                  anchors: [
                    {
                      ...hostedDirectory.anchors[0]!,
                      label: "Tampered hosted verifier",
                    },
                  ],
                }
              : hostedDirectory;
          return Response.json(value);
        },
      },
      receiptTrustDirectorySubscriptions: {
        workerId: "subscription-test-worker",
      },
    });
    openServices.push(services);
    const app = createApp(services);
    const thread = services.store.listThreads()[0]!;
    hostedDirectory = createDirectory(thread.id, "Hosted verifier A");
    const policy = {
      maxAgeMs: 24 * 60 * 60 * 1_000,
      minimumTrustedCount: 1,
    };

    const createResponse = await app.request(
      "/api/receipt-trust/anchors/directory/subscriptions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          label: "Release trust feed",
          sourceUrl,
          refreshIntervalMs: 5 * 60 * 1_000,
          policy,
        }),
      },
    );
    expect(createResponse.status).toBe(201);
    const created =
      (await createResponse.json()) as ReceiptTrustAnchorDirectorySubscription;
    expect(created).toEqual(
      expect.objectContaining({
        auditThreadId: thread.id,
        label: "Release trust feed",
        status: "active",
        revision: 1,
        lastRefreshStatus: "promoted",
      }),
    );
    expect(JSON.stringify(created)).not.toContain(sourceUrl);
    expect(
      createResponse.headers.get(
        "x-napier-receipt-trust-directory-subscription-sha256",
      ),
    ).toBe(created.contentSha256);
    expect(createResponse.headers.get("x-napier-content-sha256-mode")).toBe(
      "stable",
    );

    const listResponse = await app.request(
      "/api/receipt-trust/anchors/directory/subscriptions",
    );
    expect(listResponse.status).toBe(200);
    expect(
      (await listResponse.json()) as ReceiptTrustAnchorDirectorySubscription[],
    ).toEqual([created]);
    expect(listResponse.headers.get("x-napier-content-sha256-mode")).toBe(
      "body",
    );

    const firstDirectory = hostedDirectory;
    const secondDirectory = createDirectory(thread.id, "Hosted verifier B");
    hostedDirectory = secondDirectory;
    const refreshResponse = await refreshSubscription(
      app,
      created.id,
      thread.id,
      created.revision,
    );
    expect(refreshResponse.status).toBe(200);
    const promoted =
      (await refreshResponse.json()) as ReceiptTrustAnchorDirectorySubscriptionRefreshResult;
    expect(promoted).toEqual(
      expect.objectContaining({
        status: "promoted",
        subscription: expect.objectContaining({
          revision: 2,
          lastRefreshStatus: "promoted",
        }),
      }),
    );
    expect(
      promoted.subscription.lastGoodDiscovery?.directory?.anchorSetSha256,
    ).toBe(secondDirectory.anchorSetSha256);
    expect(
      refreshResponse.headers.get(
        "x-napier-receipt-trust-directory-subscription-refresh-status",
      ),
    ).toBe("promoted");

    const staleResponse = await refreshSubscription(
      app,
      created.id,
      thread.id,
      created.revision,
    );
    expect(staleResponse.status).toBe(409);
    expect(fetchCount).toBe(2);

    hostedDirectory = firstDirectory;
    const rollbackResponse = await refreshSubscription(
      app,
      created.id,
      thread.id,
      promoted.subscription.revision,
    );
    expect(rollbackResponse.status).toBe(200);
    const rollback =
      (await rollbackResponse.json()) as ReceiptTrustAnchorDirectorySubscriptionRefreshResult;
    expect(rollback).toEqual(
      expect.objectContaining({
        status: "rollback_rejected",
        subscription: expect.objectContaining({
          lastRefreshStatus: "rollback_rejected",
          lastDiscoverySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          transparencyTailSha256: promoted.subscription.transparencyTailSha256,
        }),
      }),
    );
    expect(
      rollback.subscription.lastGoodDiscovery?.directory?.anchorSetSha256,
    ).toBe(secondDirectory.anchorSetSha256);
    expect(
      rollbackResponse.headers.get(
        "x-napier-receipt-trust-directory-subscription-refresh-status",
      ),
    ).toBe("rollback_rejected");

    responseMode = "invalid";
    const rejectedResponse = await refreshSubscription(
      app,
      created.id,
      thread.id,
      rollback.subscription.revision,
    );
    expect(rejectedResponse.status).toBe(200);
    const rejected =
      (await rejectedResponse.json()) as ReceiptTrustAnchorDirectorySubscriptionRefreshResult;
    expect(rejected.status).toBe("rejected");
    expect(
      rejected.subscription.lastGoodDiscovery?.directory?.anchorSetSha256,
    ).toBe(secondDirectory.anchorSetSha256);

    responseMode = "failure";
    const failedResponse = await refreshSubscription(
      app,
      created.id,
      thread.id,
      rejected.subscription.revision,
    );
    expect(failedResponse.status).toBe(200);
    const failed =
      (await failedResponse.json()) as ReceiptTrustAnchorDirectorySubscriptionRefreshResult;
    expect(failed).toEqual(
      expect.objectContaining({
        status: "failed",
        failureSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        subscription: expect.objectContaining({
          lastRefreshStatus: "failed",
          lastGoodDiscovery: rejected.subscription.lastGoodDiscovery,
        }),
      }),
    );
    expect(JSON.stringify(failed)).not.toContain("private upstream detail");

    const pauseResponse = await app.request(
      `/api/receipt-trust/anchors/directory/subscriptions/${created.id}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          expectedRevision: failed.subscription.revision,
          status: "paused",
        }),
      },
    );
    expect(pauseResponse.status).toBe(200);
    const paused =
      (await pauseResponse.json()) as ReceiptTrustAnchorDirectorySubscription;
    expect(paused.status).toBe("paused");
    expect(
      await services.receiptTrustDirectorySubscriptions.refreshDue(
        new Date("2030-01-01T00:00:00.000Z"),
      ),
    ).toBe(0);

    const events = await services.store.listEvents(thread.id);
    expect(
      events.filter((event) =>
        event.type.startsWith("receipt.trust_directory_subscription."),
      ),
    ).toHaveLength(6);
    expect(JSON.stringify(events)).not.toContain(sourceUrl);
    expect(JSON.stringify(events)).not.toContain("private upstream detail");
  });
});

function createDirectory(
  threadId: string,
  label: string,
): ReceiptTrustAnchorDirectory {
  const { publicKey } = generateKeyPairSync("ed25519");
  const publicKeySpki = publicKey
    .export({ format: "der", type: "spki" })
    .toString("base64");
  const anchor = createReceiptTrustAnchor({
    threadId,
    label,
    source: { type: "public_key", publicKeySpki },
  });
  return createReceiptTrustAnchorDirectory([anchor]);
}

function refreshSubscription(
  app: ReturnType<typeof createApp>,
  subscriptionId: string,
  threadId: string,
  expectedRevision: number,
): Promise<Response> {
  return app.request(
    `/api/receipt-trust/anchors/directory/subscriptions/${subscriptionId}/refresh`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId, expectedRevision }),
    },
  );
}
