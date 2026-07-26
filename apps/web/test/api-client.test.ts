import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { requestJson, requestJsonWithResponse } from "../src/api-client";
import {
  formatApiErrorMessage,
  NapierApiError,
  NapierContentHashError,
  NapierContentHashModeError,
  NapierContentHashMissingError,
  NapierJsonParseError,
} from "../src/api-error";

describe("Web API client errors", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends JSON requests through the shared request helper", async () => {
    const fetchMock = vi.fn(async (_path: string, init?: RequestInit) => {
      const body = { accepted: true };
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe(JSON.stringify({ ok: true }));
      expect(init?.headers).toEqual({
        "Content-Type": "application/json",
        "X-Test-Header": "1",
      });
      return jsonResponse(body, {
        headers: {
          "X-Napier-Content-SHA256": sha256Text(JSON.stringify(body)),
          "X-Napier-Content-SHA256-Mode": "body",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestJson("/api/test", {
        method: "POST",
        headers: { "X-Test-Header": "1" },
        body: JSON.stringify({ ok: true }),
      }),
    ).resolves.toEqual({ accepted: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/test", expect.any(Object));
  });

  it("verifies successful JSON response content hashes when present", async () => {
    const body = { accepted: true, count: 2 };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(body, {
          headers: {
            "X-Napier-Content-SHA256": sha256Text(JSON.stringify(body)),
            "X-Napier-Content-SHA256-Mode": "body",
          },
        }),
      ),
    );

    await expect(requestJson("/api/hash-bound")).resolves.toEqual(body);
  });

  it("returns response headers after successful hash verification", async () => {
    const body = { accepted: true, eventId: "event_12345678" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(body, {
          headers: {
            "X-Napier-Content-SHA256": sha256Text(JSON.stringify(body)),
            "X-Napier-Content-SHA256-Mode": "body",
            "X-Napier-Blueprint-Replay-Event-Id": "event_12345678",
          },
        }),
      ),
    );

    const response =
      await requestJsonWithResponse<typeof body>("/api/hash-bound");
    expect(response.body).toEqual(body);
    expect(response.headers.get("x-napier-blueprint-replay-event-id")).toBe(
      "event_12345678",
    );
  });

  it("rejects successful JSON responses that omit content hash evidence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ accepted: true })),
    );

    try {
      await requestJson("/api/hash-bound");
      throw new Error("Expected requestJson to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(NapierContentHashMissingError);
      expect(error).toMatchObject({
        name: "NapierContentHashMissingError",
        message: "Missing content hash for /api/hash-bound",
        status: 200,
      });
      expect(formatApiErrorMessage(error)).toBe(
        "Missing content hash for /api/hash-bound (HTTP 200)",
      );
    }
  });

  it("accepts stable artifact content hashes recomputed from canonical JSON", async () => {
    const artifactContent = {
      kind: "napier.usage-price-table-catalog",
      schemaVersion: 1,
      apiVersion: "test",
      tables: [],
    };
    const artifact = {
      ...artifactContent,
      generatedAt: "2026-07-26T00:00:00.000Z",
      contentSha256: stableSha256(artifactContent),
    };
    expect(sha256Text(JSON.stringify(artifact))).not.toBe(
      artifact.contentSha256,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(artifact, {
          headers: {
            "X-Napier-Content-SHA256": artifact.contentSha256,
            "X-Napier-Content-SHA256-Mode": "stable",
          },
        }),
      ),
    );

    await expect(requestJson("/api/stable-artifact")).resolves.toEqual(
      artifact,
    );
  });

  it("accepts review artifacts recomputed from canonical JSON", async () => {
    const reviewContent = {
      kind: "napier.skill-content-review",
      schemaVersion: 1,
      apiVersion: "test",
      skillName: "demo",
      verdict: "apply" as const,
      contentSha256: "1".repeat(64),
    };
    const review = {
      ...reviewContent,
      reviewSha256: stableSha256(reviewContent),
      generatedAt: "2026-07-26T00:00:00.000Z",
    };
    expect(sha256Text(JSON.stringify(review))).not.toBe(review.reviewSha256);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(review, {
          headers: {
            "X-Napier-Content-SHA256": review.reviewSha256,
            "X-Napier-Content-SHA256-Mode": "stable",
          },
        }),
      ),
    );

    await expect(requestJson("/api/review-artifact")).resolves.toEqual(review);
  });

  it("rejects stable digest fallbacks when the server declares body hash mode", async () => {
    const artifactContent = {
      kind: "napier.usage-price-table-catalog",
      schemaVersion: 1,
      apiVersion: "test",
      tables: [],
    };
    const artifact = {
      ...artifactContent,
      generatedAt: "2026-07-26T00:00:00.000Z",
      contentSha256: stableSha256(artifactContent),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(artifact, {
          headers: {
            "X-Napier-Content-SHA256": artifact.contentSha256,
            "X-Napier-Content-SHA256-Mode": "body",
          },
        }),
      ),
    );

    await expect(requestJson("/api/stable-artifact")).rejects.toMatchObject({
      name: "NapierContentHashError",
      message: "Response hash mismatch for /api/stable-artifact",
      status: 200,
      expectedSha256: artifact.contentSha256,
    });
  });

  it("rejects body hashes when the server declares stable hash mode", async () => {
    const body = { accepted: true, count: 2 };
    const expectedSha256 = sha256Text(JSON.stringify(body));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(body, {
          headers: {
            "X-Napier-Content-SHA256": expectedSha256,
            "X-Napier-Content-SHA256-Mode": "stable",
          },
        }),
      ),
    );

    await expect(requestJson("/api/hash-bound")).rejects.toMatchObject({
      name: "NapierContentHashError",
      message: "Response hash mismatch for /api/hash-bound",
      status: 200,
      expectedSha256,
    });
  });

  it("rejects successful JSON responses with unsupported content hash modes", async () => {
    const body = { accepted: true, count: 2 };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(body, {
          headers: {
            "X-Napier-Content-SHA256": sha256Text(JSON.stringify(body)),
            "X-Napier-Content-SHA256-Mode": "legacy",
          },
        }),
      ),
    );

    try {
      await requestJson("/api/hash-bound");
      throw new Error("Expected requestJson to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(NapierContentHashModeError);
      expect(error).toMatchObject({
        name: "NapierContentHashModeError",
        message: "Unsupported content hash mode for /api/hash-bound: legacy",
        status: 200,
        mode: "legacy",
      });
      expect(formatApiErrorMessage(error)).toBe(
        "Unsupported content hash mode for /api/hash-bound: legacy (HTTP 200)",
      );
    }
  });

  it("verifies body-mode response hashes before parsing successful JSON", async () => {
    const expectedSha256 = "0".repeat(64);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("not json", {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "X-Napier-Content-SHA256": expectedSha256,
              "X-Napier-Content-SHA256-Mode": "body",
            },
          }),
      ),
    );

    await expect(requestJson("/api/hash-bound")).rejects.toMatchObject({
      name: "NapierContentHashError",
      message: "Response hash mismatch for /api/hash-bound",
      status: 200,
      expectedSha256,
    });
  });

  it("reports malformed JSON after a body-mode response hash verifies", async () => {
    const text = "not json";
    const contentSha256 = sha256Text(text);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(text, {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "X-Napier-Content-SHA256": contentSha256,
              "X-Napier-Content-SHA256-Mode": "body",
            },
          }),
      ),
    );

    try {
      await requestJson("/api/hash-bound");
      throw new Error("Expected requestJson to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(NapierJsonParseError);
      expect(error).toMatchObject({
        name: "NapierJsonParseError",
        message: "Invalid JSON response for /api/hash-bound",
        status: 200,
        contentSha256,
      });
      expect(formatApiErrorMessage(error)).toBe(
        `Invalid JSON response for /api/hash-bound (HTTP 200 · body ${contentSha256.slice(0, 12)})`,
      );
    }
  });

  it("rejects stable digest handles that cannot be recomputed from the JSON body", async () => {
    const artifact = {
      kind: "napier.usage-price-table-catalog",
      schemaVersion: 1,
      apiVersion: "test",
      tables: [],
      generatedAt: "2026-07-26T00:00:00.000Z",
      contentSha256: "a".repeat(64),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(artifact, {
          headers: {
            "X-Napier-Content-SHA256": artifact.contentSha256,
          },
        }),
      ),
    );

    await expect(requestJson("/api/stable-artifact")).rejects.toMatchObject({
      name: "NapierContentHashError",
      message: "Response hash mismatch for /api/stable-artifact",
      status: 200,
      expectedSha256: artifact.contentSha256,
    });
  });

  it("rejects review digest handles when the stable review content drifts", async () => {
    const reviewContent = {
      kind: "napier.skill-content-review",
      schemaVersion: 1,
      apiVersion: "test",
      skillName: "demo",
      action: "install",
      contentSha256: "1".repeat(64),
    };
    const review = {
      ...reviewContent,
      action: "replace",
      generatedAt: "2026-07-26T00:00:00.000Z",
      reviewSha256: stableSha256(reviewContent),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(review, {
          headers: {
            "X-Napier-Content-SHA256": review.reviewSha256,
          },
        }),
      ),
    );

    await expect(requestJson("/api/review-artifact")).rejects.toMatchObject({
      name: "NapierContentHashError",
      message: "Response hash mismatch for /api/review-artifact",
      status: 200,
      expectedSha256: review.reviewSha256,
    });
  });

  it("accepts execution content hashes that exclude ids and wall-clock timestamps", async () => {
    const executionContent = {
      suiteId: "suite_12345678",
      suiteRevision: 1,
      threadId: "thread_12345678",
      name: "Regression",
      baselineRunId: "run_baseline",
      candidateRunIds: ["run_candidate"],
      results: [],
      passedCount: 0,
      failedCount: 0,
      inconclusiveCount: 0,
      passRate: 0,
      status: "inconclusive",
    };
    const execution = {
      id: "suiteexec_12345678",
      ...executionContent,
      contentSha256: stableSha256(executionContent),
      startedAt: "2026-07-26T00:00:00.000Z",
      finishedAt: "2026-07-26T00:00:01.000Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(execution, {
          headers: {
            "X-Napier-Content-SHA256": execution.contentSha256,
          },
        }),
      ),
    );

    await expect(
      requestJson("/api/evaluation-suite-execution"),
    ).resolves.toEqual(execution);
  });

  it("accepts extension deployment previews that project nested update previews by digest", async () => {
    const updatePreview = {
      kind: "napier.extension-package-update-preview",
      contentSha256: "2".repeat(64),
      generatedAt: "2026-07-26T00:00:00.000Z",
    };
    const deploymentContent = {
      kind: "napier.extension-package-deployment-preview",
      schemaVersion: 1,
      apiVersion: "test",
      candidateCount: 1,
      installCount: 0,
      updateCount: 1,
      items: [
        {
          action: "update",
          normalizedName: "demo",
          next: { name: "demo", version: "1.0.1" },
          publisherChanged: false,
          requiresPublisherConfirmation: false,
          requiresVersionOverride: false,
          dependencies: [],
          changes: [],
          noChanges: false,
          versionDirection: "upgrade",
          updatePreviewSha256: updatePreview.contentSha256,
        },
      ],
      applyOrder: ["demo"],
      resolutions: [],
      requiresPublisherConfirmation: false,
      requiresVersionOverride: false,
      noChanges: false,
      resetsLocalReview: true,
    };
    const deployment = {
      ...deploymentContent,
      items: [
        {
          ...deploymentContent.items[0]!,
          updatePreviewSha256: undefined,
          updatePreview,
        },
      ],
      generatedAt: "2026-07-26T00:00:00.000Z",
      contentSha256: stableSha256(deploymentContent),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(deployment, {
          headers: {
            "X-Napier-Content-SHA256": deployment.contentSha256,
          },
        }),
      ),
    );

    await expect(
      requestJson("/api/extensions/packages/deploy/preview"),
    ).resolves.toEqual(JSON.parse(JSON.stringify(deployment)));
  });

  it("accepts extension rollout previews that project nested deployment previews by digest", async () => {
    const deploymentPreview = {
      kind: "napier.extension-package-deployment-preview",
      contentSha256: "3".repeat(64),
      generatedAt: "2026-07-26T00:00:00.000Z",
      items: [{ normalizedName: "demo", manifest: { large: "omitted" } }],
    };
    const rolloutContent = {
      kind: "napier.extension-package-rollout-preview",
      schemaVersion: 1,
      apiVersion: "test",
      channelId: "rollout_12345678",
      channelName: "stable",
      channelRevision: 3,
      policy: {
        kind: "napier.extension-package-rollout-policy",
        schemaVersion: 1,
        maxPackages: 8,
        requireTrustedPublishers: true,
        requireDependencyClosure: true,
        allowedPublisherKeyIds: ["4".repeat(64)],
        allowedPackageNames: ["demo"],
      },
      lockfileSha256: "5".repeat(64),
      verification: {
        status: "trusted",
        packageCount: 1,
        lockfileSha256: "5".repeat(64),
        packageEnvelopeSha256es: ["6".repeat(64)],
      },
      deploymentPreviewSha256: deploymentPreview.contentSha256,
      deploymentPreview: undefined,
    };
    const rollout = {
      ...rolloutContent,
      verification: {
        ...rolloutContent.verification,
        verifiedAt: "2026-07-26T00:00:00.000Z",
        reason: "Trusted after dependency closure replay.",
      },
      deploymentPreview,
      generatedAt: "2026-07-26T00:00:01.000Z",
      contentSha256: stableSha256(rolloutContent),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(rollout, {
          headers: {
            "X-Napier-Content-SHA256": rollout.contentSha256,
            "X-Napier-Content-SHA256-Mode": "stable",
          },
        }),
      ),
    );

    await expect(
      requestJson("/api/extensions/packages/rollouts/preview"),
    ).resolves.toEqual(JSON.parse(JSON.stringify(rollout)));
  });

  it("accepts evaluation casebook artifacts that exclude nested calibration generation time", async () => {
    const calibrationContent = {
      kind: "napier.evaluation-casebook-calibration",
      schemaVersion: 1,
      apiVersion: "test",
      casebookId: "casebook_12345678",
      casebookRevision: 2,
      samples: [],
      groups: [],
      sampleCount: 0,
      agreementCount: 0,
      agreementRate: 0,
    };
    const calibration = {
      ...calibrationContent,
      generatedAt: "2026-07-26T00:00:00.000Z",
      contentSha256: stableSha256(calibrationContent),
    };
    const casebookArtifactContent = {
      kind: "napier.evaluation-casebook",
      schemaVersion: 1,
      apiVersion: "test",
      casebook: {
        id: "casebook_12345678",
        name: "Regression Casebook",
        currentRevision: 2,
        revisions: [],
        cases: [],
      },
      calibration: {
        ...calibration,
        generatedAt: undefined,
      },
    };
    const artifact = {
      ...casebookArtifactContent,
      calibration,
      generatedAt: "2026-07-26T00:00:01.000Z",
      contentSha256: stableSha256(casebookArtifactContent),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(artifact, {
          headers: {
            "X-Napier-Content-SHA256": artifact.contentSha256,
            "X-Napier-Content-SHA256-Mode": "stable",
          },
        }),
      ),
    );

    await expect(
      requestJson("/api/evaluation-casebooks/demo/export"),
    ).resolves.toEqual(JSON.parse(JSON.stringify(artifact)));
  });

  it("rejects successful JSON responses when the content hash drifts", async () => {
    const expectedSha256 = "0".repeat(64);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { accepted: true },
          {
            headers: {
              "X-Napier-Content-SHA256": expectedSha256,
            },
          },
        ),
      ),
    );

    try {
      await requestJson("/api/hash-bound");
      throw new Error("Expected requestJson to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(NapierContentHashError);
      expect(error).toMatchObject({
        name: "NapierContentHashError",
        message: "Response hash mismatch for /api/hash-bound",
        status: 200,
        expectedSha256,
      });
      expect(formatApiErrorMessage(error)).toContain(
        "Response hash mismatch for /api/hash-bound (HTTP 200 · expected 000000000000 · actual ",
      );
    }
  });

  it("preserves machine-verifiable error metadata from response headers", async () => {
    const body = { error: "Plan replan request is invalid" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(body, {
          status: 400,
          headers: {
            "X-Napier-Content-SHA256": sha256Text(JSON.stringify(body)),
            "X-Napier-Error-Code": "invalid_request",
            "X-Napier-Error-Message-SHA256": sha256Text(body.error),
          },
        }),
      ),
    );

    await expect(requestJson("/api/plans")).rejects.toMatchObject({
      name: "NapierApiError",
      message: "Plan replan request is invalid [invalid_request]",
      serverMessage: "Plan replan request is invalid",
      status: 400,
      code: "invalid_request",
      contentSha256: sha256Text(JSON.stringify(body)),
      messageSha256: sha256Text(body.error),
      payload: body,
    });

    try {
      await requestJson("/api/plans");
    } catch (error) {
      expect(error).toBeInstanceOf(NapierApiError);
      expect(formatApiErrorMessage(error)).toBe(
        `Plan replan request is invalid (HTTP 400 · invalid_request · body ${sha256Text(JSON.stringify(body)).slice(0, 12)} · message ${sha256Text(body.error).slice(0, 12)})`,
      );
    }
  });

  it("preserves hash-verified non-error payloads on API errors", async () => {
    const body = {
      status: "not_qualified",
      diagnostics: ["source_drift"],
      threadId: "thread_1",
      recordId: "blueprint_1",
      qualification: {
        status: "source_drift",
        diagnostics: ["source_drift"],
        recordId: "blueprint_1",
        stepCount: 2,
        artifactCount: 1,
        qualifiedAt: "2026-07-26T00:00:00.000Z",
      },
      hasOpenPlan: false,
      previewSha256: "a".repeat(64),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(body, {
          status: 409,
          headers: {
            "X-Napier-Content-SHA256": sha256Text(JSON.stringify(body)),
            "X-Napier-Content-SHA256-Mode": "body",
          },
        }),
      ),
    );

    await expect(requestJson("/api/preview")).rejects.toMatchObject({
      name: "NapierApiError",
      message: "Request failed with 409",
      serverMessage: "Request failed with 409",
      status: 409,
      contentSha256: sha256Text(JSON.stringify(body)),
      payload: body,
    });
  });

  it("rejects JSON error responses when the content hash drifts", async () => {
    const expectedSha256 = "f".repeat(64);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { error: "Plan replan request is invalid" },
          {
            status: 400,
            headers: {
              "X-Napier-Content-SHA256": expectedSha256,
              "X-Napier-Error-Code": "invalid_request",
            },
          },
        ),
      ),
    );

    await expect(requestJson("/api/plans")).rejects.toMatchObject({
      name: "NapierContentHashError",
      message: "Response hash mismatch for /api/plans",
      status: 400,
      expectedSha256,
      evidence: "response",
    });
  });

  it("rejects JSON error responses with unsupported content hash modes", async () => {
    const body = { error: "Plan replan request is invalid" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(body, {
          status: 400,
          headers: {
            "X-Napier-Content-SHA256": sha256Text(JSON.stringify(body)),
            "X-Napier-Content-SHA256-Mode": "legacy",
            "X-Napier-Error-Code": "invalid_request",
          },
        }),
      ),
    );

    await expect(requestJson("/api/plans")).rejects.toMatchObject({
      name: "NapierContentHashModeError",
      message: "Unsupported content hash mode for /api/plans: legacy",
      status: 400,
      mode: "legacy",
    });
  });

  it("verifies body-mode error hashes before parsing JSON errors", async () => {
    const expectedSha256 = "c".repeat(64);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("not json", {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              "X-Napier-Content-SHA256": expectedSha256,
              "X-Napier-Content-SHA256-Mode": "body",
              "X-Napier-Error-Code": "invalid_request",
            },
          }),
      ),
    );

    await expect(requestJson("/api/plans")).rejects.toMatchObject({
      name: "NapierContentHashError",
      message: "Response hash mismatch for /api/plans",
      status: 400,
      expectedSha256,
    });
  });

  it("reports malformed JSON errors after a body-mode error hash verifies", async () => {
    const text = "not json";
    const contentSha256 = sha256Text(text);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(text, {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              "X-Napier-Content-SHA256": contentSha256,
              "X-Napier-Content-SHA256-Mode": "body",
              "X-Napier-Error-Code": "invalid_request",
            },
          }),
      ),
    );

    await expect(requestJson("/api/plans")).rejects.toMatchObject({
      name: "NapierJsonParseError",
      message: "Invalid JSON response for /api/plans",
      status: 400,
      contentSha256,
    });
  });

  it("rejects JSON error responses when the message hash drifts", async () => {
    const body = { error: "Plan replan request is invalid" };
    const expectedSha256 = "e".repeat(64);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(body, {
          status: 400,
          headers: {
            "X-Napier-Content-SHA256": sha256Text(JSON.stringify(body)),
            "X-Napier-Error-Code": "invalid_request",
            "X-Napier-Error-Message-SHA256": expectedSha256,
          },
        }),
      ),
    );

    await expect(requestJson("/api/plans")).rejects.toMatchObject({
      name: "NapierContentHashError",
      message: "Error message hash mismatch for /api/plans",
      status: 400,
      expectedSha256,
      evidence: "error_message",
    });
  });

  it("falls back to status-based diagnostics when JSON error fields are absent", async () => {
    const body = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(body, {
          status: 502,
          headers: {
            "X-Napier-Content-SHA256": sha256Text(JSON.stringify(body)),
            "X-Napier-Content-SHA256-Mode": "body",
          },
        }),
      ),
    );

    try {
      await requestJson("/api/broken");
    } catch (error) {
      expect(error).toBeInstanceOf(NapierApiError);
      expect(formatApiErrorMessage(error)).toBe(
        `Request failed with 502 (HTTP 502 · body ${sha256Text(JSON.stringify(body)).slice(0, 12)})`,
      );
    }
  });
});

function jsonResponse(
  body: unknown,
  init?: { status?: number; headers?: HeadersInit },
): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableSha256(value: unknown): string {
  return sha256Text(canonicalJson(value));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}
