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

    expect(generated.routeCount).toBe(2);
    expect(generated.routeSetSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(generated.artifact).toEqual(
      expect.objectContaining({
        openapi: "3.1.0",
        info: expect.objectContaining({
          title: "Napier Management API",
          version: "9.9.9",
        }),
        "x-napier-source-path": "apps/server/src/app.ts",
        "x-napier-route-count": 2,
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
      "Wrote docs/artifacts/management-openapi.json: 2 routes",
    );
    const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
    expect(artifact["x-napier-route-count"]).toBe(2);

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
      app.post(
        "/api/threads/:threadId/runs",
        () => undefined,
      );
      app.get("/assets/index.js", () => undefined);
    `,
  );
  return root;
}
