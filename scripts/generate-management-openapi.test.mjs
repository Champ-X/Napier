import { execFile as execFileWithCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import {
  extractManagementRoutes,
  generateManagementOpenApi,
} from "./generate-management-openapi.mjs";

const execFile = promisify(execFileWithCallback);
const temporaryRoots = [];
const scriptPath = path.resolve("scripts/generate-management-openapi.mjs");

describe("management OpenAPI generator", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryRoots
        .splice(0)
        .map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("extracts normalized API routes from Hono declarations", () => {
    const routes = extractManagementRoutes(`
      app.get("/api/health", () => undefined);
      app.post(
        "/api/threads/:threadId/runs",
        () => undefined,
      );
      app.get("/assets/index.js", () => undefined);
    `);

    expect(routes).toEqual([
      expect.objectContaining({
        method: "get",
        rawPath: "/api/health",
        openapiPath: "/api/health",
        operationId: "get-health",
        pathParams: [],
      }),
      expect.objectContaining({
        method: "post",
        rawPath: "/api/threads/:threadId/runs",
        openapiPath: "/api/threads/{threadId}/runs",
        operationId: "post-threads-by-threadId-runs",
        pathParams: ["threadId"],
      }),
    ]);
  });

  it("generates a route-level OpenAPI artifact with hash evidence", async () => {
    const root = await createFixture();

    const generated = await generateManagementOpenApi({ repoRoot: root });

    expect(generated.routeCount).toBe(18);
    expect(generated.routeSetSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(generated.artifact).toEqual(
      expect.objectContaining({
        openapi: "3.1.0",
        info: expect.objectContaining({
          title: "Napier Management API",
          version: "9.9.9",
        }),
        "x-napier-source-path": "apps/server/src/app.ts",
        "x-napier-route-count": 18,
      }),
    );
    expect(generated.artifact.components.schemas.HealthResponse).toEqual(
      expect.objectContaining({
        type: "object",
        required: ["status", "service", "time", "runtime", "ledger"],
      }),
    );
    expect(generated.artifact.paths["/api/health"].get).toEqual(
      expect.objectContaining({
        operationId: "get-health",
        responses: expect.objectContaining({
          200: expect.objectContaining({
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/HealthResponse" },
              },
            },
          }),
        }),
        "x-napier-promoted-response-schema-refs": {
          200: "#/components/schemas/HealthResponse",
        },
      }),
    );
    expect(
      generated.artifact.paths["/api/threads/{threadId}/runs"].post,
    ).toEqual(
      expect.objectContaining({
        operationId: "post-threads-by-threadId-runs",
        parameters: [
          expect.objectContaining({
            name: "threadId",
            in: "path",
            required: true,
          }),
        ],
        requestBody: expect.objectContaining({
          content: expect.objectContaining({
            "application/json": { schema: true },
          }),
        }),
      }),
    );
    expect(
      generated.artifact.paths[
        "/api/threads/{threadId}/subagents/{taskId}/outcome/verify"
      ].post,
    ).toEqual(
      expect.objectContaining({
        operationId:
          "post-threads-by-threadId-subagents-by-taskId-outcome-verify",
        parameters: [
          expect.objectContaining({
            name: "threadId",
            in: "path",
            required: true,
          }),
          expect.objectContaining({
            name: "taskId",
            in: "path",
            required: true,
          }),
        ],
        responses: expect.objectContaining({
          200: expect.objectContaining({
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/SubagentOutcomeEvidenceVerification",
                },
              },
            },
          }),
        }),
        "x-napier-promoted-response-schema-refs": {
          200: "#/components/schemas/SubagentOutcomeEvidenceVerification",
        },
      }),
    );
    expect(
      generated.artifact.paths[
        "/api/threads/{threadId}/subagents/{taskId}/outcome/verify"
      ].post,
    ).not.toHaveProperty("requestBody");
    expect(
      generated.artifact.components.schemas.SubagentOutcomeEvidenceVerification,
    ).toEqual(
      expect.objectContaining({
        type: "object",
        required: expect.arrayContaining([
          "status",
          "taskId",
          "outcomeSha256",
          "items",
          "contentSha256",
        ]),
        additionalProperties: false,
      }),
    );
    expect(
      generated.artifact.paths[
        "/api/threads/{threadId}/subagents/{taskId}/outcome/review"
      ].post,
    ).toEqual(
      expect.objectContaining({
        operationId:
          "post-threads-by-threadId-subagents-by-taskId-outcome-review",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/ReviewSubagentOutcomeRequest",
              },
            },
          },
        },
        responses: expect.objectContaining({
          200: expect.objectContaining({
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/SubagentOutcomeReview",
                },
              },
            },
          }),
        }),
        "x-napier-promoted-request-schema-ref":
          "#/components/schemas/ReviewSubagentOutcomeRequest",
        "x-napier-promoted-response-schema-refs": {
          200: "#/components/schemas/SubagentOutcomeReview",
        },
      }),
    );
    expect(generated.artifact.components.schemas.SubagentOutcomeReview).toEqual(
      expect.objectContaining({
        type: "object",
        required: expect.arrayContaining([
          "workerModel",
          "reviewerModel",
          "verdict",
          "usage",
          "reviewSha256",
        ]),
        additionalProperties: false,
      }),
    );
    expect(generated.artifact.paths["/api/receipt-trust/anchors"].get).toEqual(
      expect.objectContaining({
        operationId: "get-receipt-trust-anchors",
        responses: expect.objectContaining({
          200: expect.objectContaining({
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ReceiptTrustAnchorList",
                },
              },
            },
          }),
        }),
      }),
    );
    expect(generated.artifact.paths["/api/receipt-trust/anchors"].post).toEqual(
      expect.objectContaining({
        operationId: "post-receipt-trust-anchors",
        requestBody: expect.objectContaining({
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/CreateReceiptTrustAnchorRequest",
              },
            },
          },
        }),
        responses: expect.objectContaining({
          201: expect.objectContaining({
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ReceiptTrustAnchor",
                },
              },
            },
          }),
        }),
        "x-napier-promoted-request-schema-ref":
          "#/components/schemas/CreateReceiptTrustAnchorRequest",
        "x-napier-promoted-response-schema-refs": {
          201: "#/components/schemas/ReceiptTrustAnchor",
        },
      }),
    );
    expect(
      generated.artifact.paths["/api/receipt-trust/anchors/directory"].get,
    ).toEqual(
      expect.objectContaining({
        operationId: "get-receipt-trust-anchors-directory",
        responses: expect.objectContaining({
          200: expect.objectContaining({
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ReceiptTrustAnchorDirectory",
                },
              },
            },
          }),
        }),
        "x-napier-promoted-response-schema-refs": {
          200: "#/components/schemas/ReceiptTrustAnchorDirectory",
        },
      }),
    );
    expect(
      generated.artifact.paths["/api/receipt-trust/anchors/directory/discover"]
        .post,
    ).toEqual(
      expect.objectContaining({
        operationId: "post-receipt-trust-anchors-directory-discover",
        requestBody: expect.objectContaining({
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/DiscoverReceiptTrustAnchorDirectoryRequest",
              },
            },
          },
        }),
        responses: expect.objectContaining({
          200: expect.objectContaining({
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryDiscovery",
                },
              },
            },
          }),
        }),
        "x-napier-promoted-request-schema-ref":
          "#/components/schemas/DiscoverReceiptTrustAnchorDirectoryRequest",
        "x-napier-promoted-response-schema-refs": {
          200: "#/components/schemas/ReceiptTrustAnchorDirectoryDiscovery",
        },
      }),
    );
    expect(
      generated.artifact.paths[
        "/api/receipt-trust/anchors/directory/metadata/verify"
      ].post,
    ).toEqual(
      expect.objectContaining({
        operationId: "post-receipt-trust-anchors-directory-metadata-verify",
        requestBody: expect.objectContaining({
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/VerifyReceiptTrustAnchorDirectoryMetadataRequest",
              },
            },
          },
        }),
        responses: expect.objectContaining({
          200: expect.objectContaining({
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryMetadataVerification",
                },
              },
            },
          }),
        }),
        "x-napier-promoted-request-schema-ref":
          "#/components/schemas/VerifyReceiptTrustAnchorDirectoryMetadataRequest",
        "x-napier-promoted-response-schema-refs": {
          200: "#/components/schemas/ReceiptTrustAnchorDirectoryMetadataVerification",
        },
      }),
    );
    expect(
      generated.artifact.paths[
        "/api/receipt-trust/anchors/directory/signed-metadata"
      ].post,
    ).toEqual(
      expect.objectContaining({
        operationId: "post-receipt-trust-anchors-directory-signed-metadata",
        requestBody: expect.objectContaining({
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/SignReceiptTrustAnchorDirectoryMetadataRequest",
              },
            },
          },
        }),
        responses: expect.objectContaining({
          201: expect.objectContaining({
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryMetadataEnvelope",
                },
              },
            },
          }),
        }),
        "x-napier-promoted-request-schema-ref":
          "#/components/schemas/SignReceiptTrustAnchorDirectoryMetadataRequest",
        "x-napier-promoted-response-schema-refs": {
          201: "#/components/schemas/ReceiptTrustAnchorDirectoryMetadataEnvelope",
        },
      }),
    );
    expect(
      generated.artifact.paths[
        "/api/receipt-trust/anchors/directory/subscriptions"
      ].get,
    ).toEqual(
      expect.objectContaining({
        operationId: "get-receipt-trust-anchors-directory-subscriptions",
        responses: expect.objectContaining({
          200: expect.objectContaining({
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ReceiptTrustAnchorDirectorySubscriptionList",
                },
              },
            },
          }),
        }),
        "x-napier-promoted-response-schema-refs": {
          200: "#/components/schemas/ReceiptTrustAnchorDirectorySubscriptionList",
        },
      }),
    );
    expect(
      generated.artifact.paths[
        "/api/receipt-trust/anchors/directory/subscriptions"
      ].post,
    ).toEqual(
      expect.objectContaining({
        operationId: "post-receipt-trust-anchors-directory-subscriptions",
        requestBody: expect.objectContaining({
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/CreateReceiptTrustAnchorDirectorySubscriptionRequest",
              },
            },
          },
        }),
        responses: expect.objectContaining({
          201: expect.objectContaining({
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ReceiptTrustAnchorDirectorySubscription",
                },
              },
            },
          }),
          422: expect.objectContaining({
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryDiscovery",
                },
              },
            },
          }),
        }),
        "x-napier-promoted-request-schema-ref":
          "#/components/schemas/CreateReceiptTrustAnchorDirectorySubscriptionRequest",
        "x-napier-promoted-response-schema-refs": {
          201: "#/components/schemas/ReceiptTrustAnchorDirectorySubscription",
          422: "#/components/schemas/ReceiptTrustAnchorDirectoryDiscovery",
        },
      }),
    );
    expect(
      generated.artifact.paths[
        "/api/receipt-trust/anchors/directory/subscriptions/{subscriptionId}"
      ].post,
    ).toEqual(
      expect.objectContaining({
        operationId:
          "post-receipt-trust-anchors-directory-subscriptions-by-subscriptionId",
        parameters: [
          expect.objectContaining({
            name: "subscriptionId",
            in: "path",
            required: true,
          }),
        ],
        requestBody: expect.objectContaining({
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/UpdateReceiptTrustAnchorDirectorySubscriptionRequest",
              },
            },
          },
        }),
        responses: expect.objectContaining({
          200: expect.objectContaining({
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ReceiptTrustAnchorDirectorySubscription",
                },
              },
            },
          }),
        }),
        "x-napier-promoted-request-schema-ref":
          "#/components/schemas/UpdateReceiptTrustAnchorDirectorySubscriptionRequest",
        "x-napier-promoted-response-schema-refs": {
          200: "#/components/schemas/ReceiptTrustAnchorDirectorySubscription",
        },
      }),
    );
    expect(
      generated.artifact.paths[
        "/api/receipt-trust/anchors/directory/subscriptions/{subscriptionId}/refresh"
      ].post,
    ).toEqual(
      expect.objectContaining({
        operationId:
          "post-receipt-trust-anchors-directory-subscriptions-by-subscriptionId-refresh",
        requestBody: expect.objectContaining({
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/RefreshReceiptTrustAnchorDirectorySubscriptionRequest",
              },
            },
          },
        }),
        responses: expect.objectContaining({
          200: expect.objectContaining({
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ReceiptTrustAnchorDirectorySubscriptionRefreshResult",
                },
              },
            },
          }),
        }),
        "x-napier-promoted-request-schema-ref":
          "#/components/schemas/RefreshReceiptTrustAnchorDirectorySubscriptionRequest",
        "x-napier-promoted-response-schema-refs": {
          200: "#/components/schemas/ReceiptTrustAnchorDirectorySubscriptionRefreshResult",
        },
      }),
    );
    expect(
      generated.artifact.paths[
        "/api/receipt-trust/anchors/directory/subscriptions/quorum"
      ].post,
    ).toEqual(
      expect.objectContaining({
        operationId:
          "post-receipt-trust-anchors-directory-subscriptions-quorum",
        requestBody: expect.objectContaining({
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/EvaluateReceiptTrustAnchorDirectoryQuorumRequest",
              },
            },
          },
        }),
        responses: expect.objectContaining({
          200: expect.objectContaining({
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryQuorum",
                },
              },
            },
          }),
        }),
        "x-napier-promoted-request-schema-ref":
          "#/components/schemas/EvaluateReceiptTrustAnchorDirectoryQuorumRequest",
        "x-napier-promoted-response-schema-refs": {
          200: "#/components/schemas/ReceiptTrustAnchorDirectoryQuorum",
        },
      }),
    );
    expect(
      generated.artifact.paths["/api/receipt-trust/anchors/directory/verify"]
        .post,
    ).toEqual(
      expect.objectContaining({
        operationId: "post-receipt-trust-anchors-directory-verify",
        requestBody: expect.objectContaining({
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/VerifyReceiptTrustAnchorDirectoryRequest",
              },
            },
          },
        }),
        responses: expect.objectContaining({
          200: expect.objectContaining({
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryVerification",
                },
              },
            },
          }),
        }),
        "x-napier-promoted-request-schema-ref":
          "#/components/schemas/VerifyReceiptTrustAnchorDirectoryRequest",
        "x-napier-promoted-response-schema-refs": {
          200: "#/components/schemas/ReceiptTrustAnchorDirectoryVerification",
        },
      }),
    );
    expect(
      generated.artifact.paths["/api/receipt-trust/anchors/{anchorId}/revoke"]
        .post,
    ).toEqual(
      expect.objectContaining({
        operationId: "post-receipt-trust-anchors-by-anchorId-revoke",
        parameters: [
          expect.objectContaining({
            name: "anchorId",
            in: "path",
            required: true,
          }),
        ],
        requestBody: expect.objectContaining({
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/RevokeReceiptTrustAnchorRequest",
              },
            },
          },
        }),
        responses: expect.objectContaining({
          200: expect.objectContaining({
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ReceiptTrustAnchor",
                },
              },
            },
          }),
        }),
        "x-napier-promoted-request-schema-ref":
          "#/components/schemas/RevokeReceiptTrustAnchorRequest",
        "x-napier-promoted-response-schema-refs": {
          200: "#/components/schemas/ReceiptTrustAnchor",
        },
      }),
    );
    expect(generated.artifact.paths["/api/receipt-trust/verify"].post).toEqual(
      expect.objectContaining({
        operationId: "post-receipt-trust-verify",
        requestBody: expect.objectContaining({
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/VerifyTrustedReceiptRequest",
              },
            },
          },
        }),
        responses: expect.objectContaining({
          200: expect.objectContaining({
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/TrustedReceiptVerification",
                },
              },
            },
          }),
        }),
        "x-napier-promoted-request-schema-ref":
          "#/components/schemas/VerifyTrustedReceiptRequest",
        "x-napier-promoted-response-schema-refs": {
          200: "#/components/schemas/TrustedReceiptVerification",
        },
      }),
    );
  });

  it("rejects duplicate normalized operation ids", () => {
    expect(() =>
      extractManagementRoutes(`
        app.get("/api/one-two", () => undefined);
        app.get("/api/one_two", () => undefined);
      `),
    ).toThrow("Duplicate management operationId");
  });

  it("writes and checks the generated artifact through the CLI", async () => {
    const root = await createFixture();
    const artifactPath = path.join(
      root,
      "docs/artifacts/management-openapi.json",
    );

    const writeResult = await execFile(process.execPath, [
      scriptPath,
      "--repo-root",
      root,
      "--artifact-path",
      "docs/artifacts/management-openapi.json",
    ]);
    expect(writeResult.stdout).toContain(
      "Wrote docs/artifacts/management-openapi.json: 18 routes",
    );
    const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
    expect(artifact["x-napier-route-count"]).toBe(18);

    const checkResult = await execFile(process.execPath, [
      scriptPath,
      "--check",
      "--repo-root",
      root,
      "--artifact-path",
      "docs/artifacts/management-openapi.json",
    ]);
    expect(checkResult.stdout).toContain(
      "Management OpenAPI artifact is current",
    );

    await writeFile(artifactPath, '{"stale":true}\n');
    await expect(
      execFile(process.execPath, [
        scriptPath,
        "--check",
        "--repo-root",
        root,
        "--artifact-path",
        "docs/artifacts/management-openapi.json",
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("management-openapi.json is stale"),
    });
  });
});

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-openapi-"));
  temporaryRoots.push(root);
  await mkdir(path.join(root, "apps/server/src"), { recursive: true });
  await mkdir(path.join(root, "docs/artifacts"), { recursive: true });
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify({ name: "napier-fixture", version: "9.9.9" }, null, 2)}\n`,
  );
  await writeFile(
    path.join(root, "apps/server/src/app.ts"),
    `
      app.get("/api/health", () => undefined);
      app.get("/api/receipt-trust/anchors", () => undefined);
      app.get("/api/receipt-trust/anchors/directory", () => undefined);
      app.post("/api/receipt-trust/anchors", () => undefined);
      app.post("/api/receipt-trust/anchors/:anchorId/revoke", () => undefined);
      app.post("/api/receipt-trust/anchors/directory/discover", () => undefined);
      app.post("/api/receipt-trust/anchors/directory/metadata/verify", () => undefined);
      app.post("/api/receipt-trust/anchors/directory/signed-metadata", () => undefined);
      app.get("/api/receipt-trust/anchors/directory/subscriptions", () => undefined);
      app.post("/api/receipt-trust/anchors/directory/subscriptions", () => undefined);
      app.post("/api/receipt-trust/anchors/directory/subscriptions/:subscriptionId", () => undefined);
      app.post("/api/receipt-trust/anchors/directory/subscriptions/:subscriptionId/refresh", () => undefined);
      app.post("/api/receipt-trust/anchors/directory/subscriptions/quorum", () => undefined);
      app.post("/api/receipt-trust/anchors/directory/verify", () => undefined);
      app.post("/api/receipt-trust/verify", () => undefined);
      app.post("/api/threads/:threadId/subagents/:taskId/outcome/verify", () => undefined);
      app.post("/api/threads/:threadId/subagents/:taskId/outcome/review", () => undefined);
      app.post(
        "/api/threads/:threadId/runs",
        () => undefined,
      );
      app.get("/assets/index.js", () => undefined);
    `,
  );
  return root;
}
