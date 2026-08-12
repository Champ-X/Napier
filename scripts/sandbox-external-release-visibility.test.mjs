import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { sandboxImageSourceEvidence } from "./check-sandbox-image-sbom.mjs";
import {
  SANDBOX_EXTERNAL_RELEASE_IMAGE,
  inspectAnonymousSandboxBootstrap,
} from "./sandbox-external-release-visibility.mjs";
import { sha256 } from "./sandbox-external-publication-model.mjs";

const SOURCE_SHA = "a".repeat(40);
const TOKEN = "t".repeat(40);
const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Sandbox external release visibility", () => {
  it("verifies anonymous dual-platform bootstrap identity without retaining token", async () => {
    const fixture = await visibilityFixture();
    const result = await inspectAnonymousSandboxBootstrap(fixture);

    expect(result).toEqual(
      expect.objectContaining({
        status: "ready",
        blocker: null,
        sourceSha: SOURCE_SHA,
        contextSha256: fixture.contextSha256,
        image: SANDBOX_EXTERNAL_RELEASE_IMAGE,
        tag: `bootstrap-${SOURCE_SHA}`,
        tokenHttpStatus: 200,
        manifestHttpStatus: 200,
        anonymousTokenAcquired: true,
        indexDigestVerified: true,
        sourceLabelsVerified: true,
        platforms: [
          expect.objectContaining({ platform: "linux/amd64" }),
          expect.objectContaining({ platform: "linux/arm64" }),
        ],
      }),
    );
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it.each([
    [401, "ghcr_anonymous_token_unavailable"],
    [403, "ghcr_anonymous_token_unavailable"],
  ])("reports token HTTP %s as a blocker", async (status, blocker) => {
    const fixture = await visibilityFixture({ tokenStatus: status });

    await expect(inspectAnonymousSandboxBootstrap(fixture)).resolves.toEqual(
      expect.objectContaining({
        status: "blocked",
        blocker,
        tokenHttpStatus: status,
        manifestHttpStatus: null,
        digest: null,
        platforms: [],
      }),
    );
  });

  it.each([401, 403, 404])(
    "reports manifest HTTP %s as a blocker",
    async (status) => {
      const fixture = await visibilityFixture({ manifestStatus: status });

      await expect(inspectAnonymousSandboxBootstrap(fixture)).resolves.toEqual(
        expect.objectContaining({
          status: "blocked",
          blocker: "ghcr_bootstrap_tag_unavailable",
          tokenHttpStatus: 200,
          manifestHttpStatus: status,
          anonymousTokenAcquired: true,
        }),
      );
    },
  );

  it("rejects digest, platform, config, and label drift", async () => {
    for (const mutate of [
      (fixture) => {
        fixture.index.headers["docker-content-digest"] = `sha256:${"0".repeat(
          64,
        )}`;
      },
      (fixture) => {
        fixture.indexValue.manifests[1].platform.architecture = "amd64";
        fixture.rebuildIndex();
      },
      (fixture) => {
        fixture.configValues["linux/amd64"].os = "windows";
        fixture.refreshConfig("linux/amd64");
      },
      (fixture) => {
        fixture.configValues["linux/arm64"].config.Labels[
          "org.opencontainers.image.revision"
        ] = "b".repeat(40);
        fixture.refreshConfig("linux/arm64");
      },
    ]) {
      const fixture = await visibilityFixture();
      mutate(fixture);
      await expect(inspectAnonymousSandboxBootstrap(fixture)).rejects.toThrow();
    }
  });

  it("accepts descriptor-bound CDN blob bytes without a digest header", async () => {
    const fixture = await visibilityFixture();
    const request = fixture.request;
    fixture.request = async (input) => {
      const response = await request(input);
      return input.url.includes("/blobs/")
        ? { ...response, headers: {} }
        : response;
    };

    await expect(inspectAnonymousSandboxBootstrap(fixture)).resolves.toEqual(
      expect.objectContaining({ status: "ready", sourceLabelsVerified: true }),
    );
  });
});

async function visibilityFixture({
  tokenStatus = 200,
  manifestStatus = 200,
} = {}) {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "napier-visibility-"));
  roots.push(repoRoot);
  await mkdir(path.join(repoRoot, "docker/napier-sandbox"), {
    recursive: true,
  });
  for (const name of ["Dockerfile", "package.json", "package-lock.json"]) {
    await cp(
      path.resolve("docker/napier-sandbox", name),
      path.join(repoRoot, "docker/napier-sandbox", name),
    );
  }
  const contextSha256 = (await sandboxImageSourceEvidence(repoRoot))
    .contextSha256;
  const configValues = Object.fromEntries(
    ["linux/amd64", "linux/arm64"].map((platform) => {
      const [os, architecture] = platform.split("/");
      return [
        platform,
        {
          os,
          architecture,
          config: {
            Labels: {
              "io.napier.sandbox.context-sha256": contextSha256,
              "org.opencontainers.image.revision": SOURCE_SHA,
              "org.opencontainers.image.version": "0.1.0",
            },
          },
        },
      ];
    }),
  );
  const configs = Object.fromEntries(
    Object.entries(configValues).map(([platform, value]) => [
      platform,
      response(Buffer.from(JSON.stringify(value))),
    ]),
  );
  const manifestValues = Object.fromEntries(
    Object.entries(configs).map(([platform, config]) => [
      platform,
      {
        schemaVersion: 2,
        mediaType: "application/vnd.oci.image.manifest.v1+json",
        config: descriptor(config),
        layers: [descriptor(response(Buffer.from(`layer:${platform}`)))],
      },
    ]),
  );
  const manifests = Object.fromEntries(
    Object.entries(manifestValues).map(([platform, value]) => [
      platform,
      response(Buffer.from(JSON.stringify(value))),
    ]),
  );
  const indexValue = {
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.index.v1+json",
    manifests: Object.entries(manifests).map(([platform, manifest]) => {
      const [os, architecture] = platform.split("/");
      return {
        mediaType: "application/vnd.oci.image.manifest.v1+json",
        ...descriptor(manifest),
        platform: { os, architecture },
      };
    }),
  };
  const fixture = {
    repoRoot,
    sourceSha: SOURCE_SHA,
    contextSha256,
    indexValue,
    configValues,
    configs,
    manifests,
    index: response(Buffer.from(JSON.stringify(indexValue))),
    rebuildIndex() {
      fixture.index = response(Buffer.from(JSON.stringify(indexValue)));
    },
    refreshConfig(platform) {
      configs[platform] = response(
        Buffer.from(JSON.stringify(configValues[platform])),
      );
      manifestValues[platform].config = descriptor(configs[platform]);
      manifests[platform] = response(
        Buffer.from(JSON.stringify(manifestValues[platform])),
      );
      const descriptorIndex = indexValue.manifests.findIndex(
        (item) =>
          `${item.platform.os}/${item.platform.architecture}` === platform,
      );
      if (descriptorIndex >= 0) {
        indexValue.manifests[descriptorIndex] = {
          ...indexValue.manifests[descriptorIndex],
          ...descriptor(manifests[platform]),
        };
      }
      fixture.rebuildIndex();
    },
    request: async ({ url }) => {
      if (url.includes("/token?")) {
        return {
          status: tokenStatus,
          headers: {},
          body: Buffer.from(
            tokenStatus === 200 ? JSON.stringify({ token: TOKEN }) : "{}",
          ),
        };
      }
      if (url.endsWith(`/manifests/bootstrap-${SOURCE_SHA}`)) {
        return {
          ...(manifestStatus === 200
            ? fixture.index
            : { headers: {}, body: Buffer.from("{}") }),
          status: manifestStatus,
        };
      }
      for (const manifest of Object.values(manifests)) {
        if (
          url.endsWith(
            `/manifests/${manifest.headers["docker-content-digest"]}`,
          )
        ) {
          return manifest;
        }
      }
      for (const config of Object.values(configs)) {
        if (url.endsWith(`/blobs/${config.headers["docker-content-digest"]}`)) {
          return config;
        }
      }
      throw new Error(`unexpected request: ${url}`);
    },
  };
  return fixture;
}

function response(body) {
  return {
    status: 200,
    headers: { "docker-content-digest": `sha256:${sha256(body)}` },
    body,
  };
}

function descriptor(value) {
  return {
    digest: value.headers["docker-content-digest"],
    size: value.body.byteLength,
  };
}
