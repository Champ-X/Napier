import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { ContainerClient } from "../src/sandbox-container-runtime.js";
import {
  pullOfficialSandboxRelease,
  validateOfficialSandboxRelease,
  type OfficialSandboxRelease,
} from "../src/sandbox-official-release.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";

describe("Official Sandbox external release", () => {
  it("validates one reviewed external publication receipt", () => {
    const receipt = releaseReceipt();

    expect(
      validateOfficialSandboxRelease(
        receipt,
        receipt.contextSha256,
        "e".repeat(64),
      ),
    ).toEqual(
      expect.objectContaining({
        image: "ghcr.io/champ-x/napier-sandbox",
        digest: receipt.digest,
        reference: `ghcr.io/champ-x/napier-sandbox@${receipt.digest}`,
        sourceSha: receipt.sourceSha,
        receiptSha256: "e".repeat(64),
      }),
    );
  });

  it("rejects tampered, unsigned, or context-mismatched receipts", () => {
    for (const mutate of [
      (value: any) => {
        value.contextSha256 = "0".repeat(64);
      },
      (value: any) => {
        value.cosign.verified = false;
      },
      (value: any) => {
        value.scope.externalAttestation = false;
      },
      (value: any) => {
        value.unexpected = true;
      },
    ]) {
      const receipt = releaseReceipt();
      mutate(receipt);
      rehash(receipt);
      expect(() =>
        validateOfficialSandboxRelease(receipt, "a".repeat(64), "e".repeat(64)),
      ).toThrow("release receipt");
    }
  });

  it("uses an empty private Docker config and removes it after a successful pull", async () => {
    const release = externalRelease();
    let configRoot = "";
    const runPull = vi.fn(async (request) => {
      const index = request.args.indexOf("--config");
      configRoot = request.args[index + 1]!;
      expect(request.args).toEqual([
        "--config",
        configRoot,
        "pull",
        "--platform",
        process.arch === "x64" ? "linux/amd64" : "linux/arm64",
        release.reference,
      ]);
      expect(request.env.DOCKER_CONFIG).toBe(configRoot);
      expect(request.env.DOCKER_HOST).toBe("unix:///private/docker.sock");
      expect(request.env.DOCKER_CONTEXT).toBeUndefined();
      expect(request.env.DOCKER_CERT_PATH).toBeUndefined();
      expect(request.env.DOCKER_TLS_VERIFY).toBeUndefined();
      expect(request.env.DOCKER_AUTH_CONFIG).toBeUndefined();
      await expect(
        readFile(path.join(configRoot, "config.json"), "utf8"),
      ).resolves.toBe('{"auths":{}}\n');
      return {
        exitCode: 0,
        outputBytes: 0,
        outputSha256: "f".repeat(64),
      };
    });
    const client = releaseClient(release);

    const result = await pullOfficialSandboxRelease(
      release,
      new AbortController().signal,
      {
        runPull,
        resolveExecutable: async () => process.execPath,
        client,
      },
    );

    expect(result).toEqual({
      status: "pulled",
      identity: expect.objectContaining({
        imageId: `sha256:${"1".repeat(64)}`,
      }),
    });
    expect(runPull).toHaveBeenCalledTimes(1);
    await expect(access(configRoot)).rejects.toThrow();
  });

  it("returns unavailable on anonymous pull rejection and still removes credentials", async () => {
    const release = externalRelease();
    let configRoot = "";

    const result = await pullOfficialSandboxRelease(
      release,
      new AbortController().signal,
      {
        resolveExecutable: async () => process.execPath,
        client: async (_executable, args) => {
          if (args[0] === "context") {
            return "unix:///private/docker.sock\n";
          }
          throw new Error("not found");
        },
        runPull: async (request) => {
          configRoot = request.env.DOCKER_CONFIG!;
          return {
            exitCode: 1,
            outputBytes: 4,
            outputSha256: "9".repeat(64),
          };
        },
      },
    );

    expect(result).toEqual({
      status: "unavailable",
      diagnosticSha256: "9".repeat(64),
    });
    await expect(access(configRoot)).rejects.toThrow();
  });

  it("removes a pulled reference when release labels fail verification", async () => {
    const release = externalRelease();
    const calls: string[][] = [];
    const client: ContainerClient = async (_executable, args) => {
      calls.push([...args]);
      if (args[0] === "context") return "unix:///private/docker.sock\n";
      if (
        args[0] === "image" &&
        args[1] === "inspect" &&
        args[2] === "--format"
      ) {
        return `${"0".repeat(64)}\t${release.sourceSha}\n`;
      }
      if (args[0] === "image" && args[1] === "rm") return "";
      throw new Error(`Unexpected Docker call: ${args.join(" ")}`);
    };

    await expect(
      pullOfficialSandboxRelease(release, new AbortController().signal, {
        resolveExecutable: async () => process.execPath,
        runPull: async () => ({
          exitCode: 0,
          outputBytes: 0,
          outputSha256: "f".repeat(64),
        }),
        client,
      }),
    ).rejects.toThrow("release labels are invalid");
    expect(calls).toContainEqual(["image", "rm", release.reference]);
  });
});

function releaseClient(release: OfficialSandboxRelease): ContainerClient {
  return vi.fn(async (_executable, args) => {
    if (args[0] === "context") return "unix:///private/docker.sock\n";
    if (
      args[0] === "image" &&
      args[1] === "inspect" &&
      args[2] === "--format"
    ) {
      if (String(args[3]).includes(".Config.Labels")) {
        return `${release.contextSha256}\t${release.sourceSha}\n`;
      }
      return `sha256:${"1".repeat(64)}\tlinux\t${process.arch === "x64" ? "amd64" : "arm64"}\n`;
    }
    throw new Error(`Unexpected Docker call: ${args.join(" ")}`);
  });
}

function externalRelease(): OfficialSandboxRelease {
  const digest = `sha256:${"d".repeat(64)}`;
  return {
    image: "ghcr.io/champ-x/napier-sandbox",
    version: "0.1.0",
    digest,
    reference: `ghcr.io/champ-x/napier-sandbox@${digest}`,
    sourceSha: "b".repeat(40),
    contextSha256: "a".repeat(64),
    receiptSha256: "e".repeat(64),
    platforms: ["linux/amd64", "linux/arm64"],
  };
}

function releaseReceipt(): any {
  const withoutHash = {
    kind: "napier.sandbox-external-publication",
    schemaVersion: 1,
    generatedAt: "2026-08-12T00:00:00.000Z",
    repository: "Champ-X/Napier",
    workflow: ".github/workflows/publish-sandbox.yml",
    workflowRunId: "123",
    workflowRunAttempt: "1",
    sourceSha: "b".repeat(40),
    image: "ghcr.io/champ-x/napier-sandbox",
    version: "0.1.0",
    digest: `sha256:${"d".repeat(64)}`,
    platforms: ["linux/amd64", "linux/arm64"],
    contextSha256: "a".repeat(64),
    remoteIndex: {
      sha256: "1".repeat(64),
      byteCount: 100,
      attestationDescriptorCount: 2,
    },
    buildkitAttestations: {
      sha256: "2".repeat(64),
      predicateCount: 2,
      sbomPredicateVerified: true,
      provenancePredicateVerified: true,
    },
    anonymousPullAndExecution: true,
    anonymousPlatforms: { sha256: "3".repeat(64), platformCount: 2 },
    cosign: {
      algorithm: "keyless-oidc",
      verified: true,
      transparencyLogVerified: true,
      bundleSha256: "4".repeat(64),
      verificationSha256: "5".repeat(64),
      transparencyEntryCount: 1,
    },
    externalAttestation: {
      predicateType: "https://slsa.dev/provenance/v1",
      verified: true,
      registryStored: true,
      transparencyLogVerified: true,
      predicateSha256: "6".repeat(64),
      bundleSha256: "7".repeat(64),
      verificationSha256: "8".repeat(64),
      verificationCount: 1,
      transparencyEntryCount: 1,
    },
    retention: {
      credentialValues: false,
      rawWorkflowLog: false,
      rawDockerOutput: false,
      imageBytes: false,
      workspacePaths: false,
    },
    scope: {
      externalRegistryPublished: true,
      releaseSigningIdentity: true,
      transparencyLogRecorded: true,
      externalAttestation: true,
      windowsHostProductAcceptance: false,
      s1Complete: false,
    },
  };
  return {
    ...withoutHash,
    contentSha256: sha256(canonicalJson(withoutHash)),
  };
}

function rehash(value: any): void {
  const { contentSha256: _contentSha256, ...content } = value;
  value.contentSha256 = sha256(canonicalJson(content));
}
