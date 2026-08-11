import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  collectSandboxImageEvidence,
  verifySandboxImageArtifacts,
} from "./check-sandbox-image-sbom.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Sandbox image SBOM audit", () => {
  it("creates a deterministic local-only CycloneDX projection", async () => {
    const root = await fixtureRoot();
    const first = await collectSandboxImageEvidence(
      {
        repoRoot: root,
        image: "napier-sandbox:0.1.0",
        sbomPath: "docs/artifacts/sbom.json",
      },
      { docker: dockerFixture() },
    );
    const second = await collectSandboxImageEvidence(
      {
        repoRoot: root,
        image: "napier-sandbox:0.1.0",
        sbomPath: "docs/artifacts/sbom.json",
      },
      { docker: dockerFixture() },
    );

    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    expect(first.sbom).toEqual(
      expect.objectContaining({
        bomFormat: "CycloneDX",
        specVersion: "1.5",
        components: expect.arrayContaining([
          expect.objectContaining({
            name: "git",
            version: "1:2.39.5-0+deb12u2",
          }),
          expect.objectContaining({
            name: "typescript",
            version: "5.9.3",
          }),
        ]),
      }),
    );
    expect(first.receipt).toEqual(
      expect.objectContaining({
        scope: "local-single-platform",
        publication: {
          registryPublished: false,
          signed: false,
          attested: false,
        },
        sbom: expect.objectContaining({
          componentCount: 4,
          debianComponentCount: 2,
          npmComponentCount: 1,
          runtimeComponentCount: 1,
        }),
      }),
    );
  });

  it("rejects SBOM and current Dockerfile drift offline", async () => {
    const root = await fixtureRoot();
    const options = {
      repoRoot: root,
      image: "napier-sandbox:0.1.0",
      sbomPath: "docs/artifacts/sbom.json",
      receiptPath: "docs/artifacts/receipt.json",
      verifyReceiptPath: "docs/artifacts/receipt.json",
    };
    const result = await collectSandboxImageEvidence(options, {
      docker: dockerFixture(),
    });
    await writeArtifact(root, options.sbomPath, result.sbom);
    await writeArtifact(root, options.receiptPath, result.receipt);
    expect(await verifySandboxImageArtifacts(options)).toEqual(
      expect.objectContaining({ valid: true, errors: [] }),
    );

    const tampered = structuredClone(result.sbom);
    tampered.components[0].version = "tampered";
    await writeArtifact(root, options.sbomPath, tampered);
    expect((await verifySandboxImageArtifacts(options)).errors).toEqual(
      expect.arrayContaining([
        "receipt SBOM SHA-256 does not match the SBOM",
        "receipt does not match the current SBOM projection",
      ]),
    );

    await writeArtifact(root, options.sbomPath, result.sbom);
    await writeFile(
      path.join(root, "docker/napier-sandbox/Dockerfile"),
      "FROM scratch\n",
    );
    expect((await verifySandboxImageArtifacts(options)).errors).toContain(
      "receipt source does not match the current Dockerfile",
    );
  });

  it("rejects live inventory mismatch and repository escapes", async () => {
    const root = await fixtureRoot();
    const options = {
      repoRoot: root,
      image: "napier-sandbox:0.1.0",
      sbomPath: "docs/artifacts/sbom.json",
      receiptPath: "docs/artifacts/receipt.json",
      verifyReceiptPath: "docs/artifacts/receipt.json",
    };
    const result = await collectSandboxImageEvidence(options, {
      docker: dockerFixture(),
    });
    await writeArtifact(root, options.sbomPath, result.sbom);
    await writeArtifact(root, options.receiptPath, result.receipt);

    const verification = await verifySandboxImageArtifacts({
      ...options,
      live: true,
      dependencies: {
        docker: dockerFixture({ debian: "git\t9.9\tarm64\n" }),
      },
    });
    expect(verification.valid).toBe(false);
    expect(verification.errors).toContain(
      "live image SBOM does not match the stored SBOM",
    );

    await expect(
      verifySandboxImageArtifacts({
        ...options,
        sbomPath: "../outside.json",
      }),
    ).rejects.toThrow("artifact path must remain inside the repository");
  });
});

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-sbom-audit-"));
  roots.push(root);
  await mkdir(path.join(root, "docker/napier-sandbox"), { recursive: true });
  await Promise.all([
    writeFile(
      path.join(root, "docker/napier-sandbox/Dockerfile"),
      "FROM node:24.16.0-bookworm-slim@sha256:fixture\n",
    ),
    writeFile(
      path.join(root, "docker/napier-sandbox/package.json"),
      `${JSON.stringify({ name: "napier-sandbox-toolchain" })}\n`,
    ),
    writeFile(
      path.join(root, "docker/napier-sandbox/package-lock.json"),
      `${JSON.stringify({ lockfileVersion: 3, packages: {} })}\n`,
    ),
  ]);
  return root;
}

function dockerFixture(overrides = {}) {
  const dockerfile = "FROM node:24.16.0-bookworm-slim@sha256:fixture\n";
  const packageJson = `${JSON.stringify({ name: "napier-sandbox-toolchain" })}\n`;
  const packageLock = `${JSON.stringify({ lockfileVersion: 3, packages: {} })}\n`;
  const dockerfileSha256 = sha256(dockerfile);
  const packageJsonSha256 = sha256(packageJson);
  const packageLockSha256 = sha256(packageLock);
  const contextSha256 = sha256(
    JSON.stringify({
      dockerfile: "docker/napier-sandbox/Dockerfile",
      dockerfileSha256,
      packageJson: "docker/napier-sandbox/package.json",
      packageJsonSha256,
      packageLock: "docker/napier-sandbox/package-lock.json",
      packageLockSha256,
    }),
  );
  const inspect = JSON.stringify([
    {
      Id: `sha256:${"a".repeat(64)}`,
      RepoDigests: [`napier-sandbox@sha256:${"a".repeat(64)}`],
      Os: "linux",
      Architecture: "arm64",
      Size: 123456,
      Config: {
        Labels: {
          "io.napier.sandbox.context-sha256": contextSha256,
          "org.opencontainers.image.version": "0.1.0",
        },
      },
    },
  ]);
  const npm = JSON.stringify({
    packages: {
      "": {},
      "node_modules/typescript": {
        version: "5.9.3",
        license: "Apache-2.0",
        integrity: `sha512-${Buffer.alloc(64, 1).toString("base64")}`,
      },
    },
  });
  return async (args) => {
    if (args[0] === "image") return inspect;
    if (args[0] === "context") return "unix:///var/run/docker.sock\n";
    if (args.includes("/usr/bin/dpkg-query")) {
      return (
        overrides.debian ??
        "ca-certificates\t20250419~deb12u1\tall\ngit\t1:2.39.5-0+deb12u2\tarm64\n"
      );
    }
    if (
      args.includes("/usr/local/bin/node") &&
      args.some(
        (argument) =>
          argument.includes("nodeInspector") ||
          argument.includes("platform.python_version"),
      )
    ) {
      return JSON.stringify({
        node: "24.16.0",
        nodeInspector: "24.16.0",
        shell: "5.2.15",
        python: "3.11.2",
        git: "2.39.5",
        typescript: "5.9.3",
        typescriptLanguageServer: "5.3.0",
        vitest: "4.1.9",
        prettier: "3.8.4",
      });
    }
    return overrides.npm ?? npm;
  };
}

async function writeArtifact(root, relativePath, value) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
