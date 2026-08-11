import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { verifySandboxMultiArchitecture } from "./check-sandbox-multi-architecture.mjs";
import { runSandboxMultiArchitectureAcceptance } from "./sandbox-multi-architecture-live.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Sandbox multi-architecture artifact", () => {
  it("accepts the current local dual-platform receipt", async () => {
    await expect(verifySandboxMultiArchitecture()).resolves.toEqual(
      expect.objectContaining({
        valid: true,
        errors: [],
        path: "docs/artifacts/sandbox-multi-architecture-stage14.json",
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
  });

  it("rejects duplicate images, missing checks, and publication overclaim", async () => {
    for (const mutate of [
      (value) => {
        value.platforms[1].imageId = value.platforms[0].imageId;
      },
      (value) => {
        value.platforms[0].checkCodes.pop();
      },
      (value) => {
        value.scope.registryPublication = true;
      },
    ]) {
      const root = await fixtureRoot();
      const artifactPath = path.join(
        root,
        "docs/artifacts/sandbox-multi-architecture-stage14.json",
      );
      const value = JSON.parse(await readFile(artifactPath, "utf8"));
      mutate(value);
      await writeFile(artifactPath, `${JSON.stringify(value, null, 2)}\n`);

      await expect(
        verifySandboxMultiArchitecture({ repoRoot: root }),
      ).resolves.toEqual(
        expect.objectContaining({
          valid: false,
          errors: expect.arrayContaining([
            expect.stringMatching(
              /Sandbox multi-architecture artifact (?:shape|content hash) is invalid/u,
            ),
          ]),
        }),
      );
    }
  });

  it("rejects artifact paths outside the repository", async () => {
    await expect(
      verifySandboxMultiArchitecture({ artifactPath: "../outside.json" }),
    ).rejects.toThrow("artifact path must remain inside the repository");
  });

  it("removes the temporary tag when a platform build fails", async () => {
    const calls = [];
    const emptySnapshot = {
      containers: [],
      networks: [],
      images: [],
      scratch: [],
    };
    const docker = async (args) => {
      calls.push(args);
      if (args[0] === "buildx" && args[1] === "version") {
        return { output: "github.com/docker/buildx v0.35.0\n" };
      }
      if (args[0] === "buildx" && args[1] === "inspect") {
        return {
          output: [
            "Driver: docker",
            "BuildKit version: v0.30.0",
            "Platforms: linux/arm64, linux/amd64",
          ].join("\n"),
        };
      }
      if (args[0] === "buildx" && args[1] === "build") {
        throw new Error("controlled build failure");
      }
      if (args[0] === "image" && args[1] === "rm") {
        return { output: "" };
      }
      if (args[0] === "image" && args[1] === "ls") {
        return { output: "" };
      }
      throw new Error(`unexpected Docker call: ${args.join(" ")}`);
    };

    await expect(
      runSandboxMultiArchitectureAcceptance({
        repoRoot: process.cwd(),
        source: { contextSha256: "a".repeat(64) },
        dependencies: {
          docker,
          snapshot: async () => emptySnapshot,
        },
      }),
    ).rejects.toThrow("controlled build failure");

    expect(calls.some((args) => args[0] === "image" && args[1] === "rm")).toBe(
      true,
    );
    expect(calls.some((args) => args[0] === "image" && args[1] === "ls")).toBe(
      true,
    );
  });
});

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-multi-arch-"));
  roots.push(root);
  for (const relative of [
    "docker/napier-sandbox/Dockerfile",
    "docker/napier-sandbox/package.json",
    "docker/napier-sandbox/package-lock.json",
    "docs/artifacts/sandbox-multi-architecture-stage14.json",
    "packages/runtime/src/doctor-lsp-runtime-probe.ts",
    "packages/runtime/src/sandbox-container-runtime.ts",
    "packages/runtime/src/sandbox-container-path-mapping.ts",
    "packages/runtime/src/sandbox-launch-policy.ts",
    "packages/runtime/src/sandbox-oci.ts",
    "packages/runtime/src/sandbox-oci-launch-arguments.ts",
    "scripts/check-sandbox-image-sbom.mjs",
    "scripts/check-sandbox-multi-architecture.mjs",
    "scripts/sandbox-multi-architecture-artifact.mjs",
    "scripts/sandbox-multi-architecture-live.mjs",
  ]) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.resolve(relative), target);
  }
  return root;
}
