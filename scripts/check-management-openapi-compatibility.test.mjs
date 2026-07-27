import { execFile as execFileWithCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import {
  createManagementOpenApiCompatibilityFixture,
  extractCompatibleOperations,
  verifyManagementOpenApiCompatibilityFixture,
} from "./check-management-openapi-compatibility.mjs";

const execFile = promisify(execFileWithCallback);
const temporaryRoots = [];
const scriptPath = path.resolve(
  "scripts/check-management-openapi-compatibility.mjs",
);

describe("management OpenAPI compatibility fixture", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryRoots
        .splice(0)
        .map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("extracts a stable compatibility projection from OpenAPI operations", () => {
    expect(
      extractCompatibleOperations(createOpenApiArtifact(["/api/health"]))[0],
    ).toEqual({
      key: "GET /api/health",
      method: "get",
      path: "/api/health",
      operationId: "get-health",
      tags: ["health"],
      pathParameters: [],
      acceptsJsonRequestBody: false,
      responseStatuses: ["200", "400", "404"],
    });
  });

  it("writes and verifies a compatibility fixture through the CLI", async () => {
    const root = await createFixture();
    const fixturePath = path.join(
      root,
      "docs/artifacts/management-openapi-compatibility.json",
    );

    const writeResult = await execFile(process.execPath, [
      scriptPath,
      "--repo-root",
      root,
      "--fixture-path",
      "docs/artifacts/management-openapi-compatibility.json",
    ]);
    expect(writeResult.stdout).toContain(
      "Management OpenAPI compatibility fixture generated: 2 operations",
    );
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    expect(fixture).toMatchObject({
      type: "napier.management-openapi-compatibility-fixture",
      schemaVersion: 1,
      operationCount: 2,
      operations: [
        expect.objectContaining({ key: "GET /api/health" }),
        expect.objectContaining({ key: "POST /api/threads/{threadId}/runs" }),
      ],
    });

    const verification = await verifyManagementOpenApiCompatibilityFixture({
      repoRoot: root,
      fixturePath: "docs/artifacts/management-openapi-compatibility.json",
    });
    expect(verification).toEqual(
      expect.objectContaining({
        valid: true,
        errors: [],
        baselineOperationCount: 2,
        currentOperationCount: 2,
        compatibleOperationCount: 2,
      }),
    );

    const verifyResult = await execFile(process.execPath, [
      scriptPath,
      "--repo-root",
      root,
      "--verify-fixture-path",
      "docs/artifacts/management-openapi-compatibility.json",
    ]);
    expect(verifyResult.stdout).toContain(
      "Management OpenAPI compatibility verified: 2/2 operations",
    );
  });

  it("allows additive routes without changing the existing fixture", async () => {
    const root = await createFixture();
    const fixture = await createManagementOpenApiCompatibilityFixture({
      repoRoot: root,
    });
    await writeFile(
      path.join(root, "docs/artifacts/management-openapi-compatibility.json"),
      `${JSON.stringify(fixture, null, 2)}\n`,
    );
    await writeOpenApiArtifact(root, [
      "/api/health",
      "/api/threads/{threadId}/runs",
      "/api/threads/{threadId}/runs/{runId}",
    ]);

    const verification = await verifyManagementOpenApiCompatibilityFixture({
      repoRoot: root,
      fixturePath: "docs/artifacts/management-openapi-compatibility.json",
    });

    expect(verification).toEqual(
      expect.objectContaining({
        valid: true,
        addedOperationCount: 1,
        addedOperations: ["GET /api/threads/{threadId}/runs/{runId}"],
      }),
    );
  });

  it("rejects removed or changed operations", async () => {
    const root = await createFixture();
    const fixture = await createManagementOpenApiCompatibilityFixture({
      repoRoot: root,
    });
    await writeFile(
      path.join(root, "docs/artifacts/management-openapi-compatibility.json"),
      `${JSON.stringify(fixture, null, 2)}\n`,
    );
    await writeOpenApiArtifact(root, ["/api/health"], {
      healthOperationId: "get-health-renamed",
    });

    const verification = await verifyManagementOpenApiCompatibilityFixture({
      repoRoot: root,
      fixturePath: "docs/artifacts/management-openapi-compatibility.json",
    });

    expect(verification.valid).toBe(false);
    expect(verification.errors).toEqual(
      expect.arrayContaining([
        "operation changed: GET /api/health",
        "operation removed: POST /api/threads/{threadId}/runs",
      ]),
    );
  });
});

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-openapi-compat-"));
  temporaryRoots.push(root);
  await mkdir(path.join(root, "docs/artifacts"), { recursive: true });
  await writeOpenApiArtifact(root, [
    "/api/health",
    "/api/threads/{threadId}/runs",
  ]);
  return root;
}

async function writeOpenApiArtifact(root, routePaths, options = {}) {
  await writeFile(
    path.join(root, "docs/artifacts/management-openapi-0.1.0.json"),
    `${JSON.stringify(createOpenApiArtifact(routePaths, options), null, 2)}\n`,
  );
}

function createOpenApiArtifact(routePaths, options = {}) {
  const paths = {};
  for (const routePath of routePaths) {
    if (routePath === "/api/health") {
      paths[routePath] = {
        get: {
          operationId: options.healthOperationId ?? "get-health",
          tags: ["health"],
          responses: {
            200: { description: "OK" },
            400: { description: "Bad request" },
            404: { description: "Not found" },
          },
        },
      };
      continue;
    }
    if (routePath === "/api/threads/{threadId}/runs") {
      paths[routePath] = {
        post: {
          operationId: "post-threads-by-threadId-runs",
          tags: ["threads"],
          parameters: [
            { name: "threadId", in: "path", required: true, schema: true },
          ],
          requestBody: {
            content: {
              "application/json": { schema: true },
            },
          },
          responses: {
            200: { description: "OK" },
            400: { description: "Bad request" },
            409: { description: "Conflict" },
          },
        },
      };
      continue;
    }
    paths[routePath] = {
      get: {
        operationId: "get-threads-by-threadId-runs-by-runId",
        tags: ["threads"],
        parameters: [
          { name: "runId", in: "path", required: true, schema: true },
          { name: "threadId", in: "path", required: true, schema: true },
        ],
        responses: {
          200: { description: "OK" },
          400: { description: "Bad request" },
        },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: "Napier Management API", version: "0.1.0" },
    paths,
    "x-napier-artifact-kind": "management-openapi",
    "x-napier-route-count": routePaths.length,
    "x-napier-route-set-sha256": "f".repeat(64),
  };
}
