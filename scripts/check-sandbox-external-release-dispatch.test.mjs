import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { sandboxImageSourceEvidence } from "./check-sandbox-image-sbom.mjs";
import {
  applySandboxExternalReleaseDispatch,
  previewSandboxExternalReleaseDispatch,
  validateSandboxExternalReleaseDispatchPreview,
  validateSandboxExternalReleaseDispatchResult,
} from "./sandbox-external-release-dispatch.mjs";
import { SANDBOX_PUBLICATION_ACTIVE_RUN_STATUSES } from "./sandbox-external-release-dispatch-state.mjs";
import { sha256 } from "./sandbox-external-publication-model.mjs";

const SOURCE_SHA = "a".repeat(40);
const BOOTSTRAP_RUN_ID = "123";
const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Sandbox release dispatch", () => {
  it("blocks on private visibility without dispatch", async () => {
    const fixture = await dispatchFixture({ visibility: "blocked" });
    const preview = await previewSandboxExternalReleaseDispatch(fixture);

    expect(validateSandboxExternalReleaseDispatchPreview(preview)).toEqual([]);
    expect(preview).toEqual(
      expect.objectContaining({
        status: "blocked",
        blockers: ["ghcr_anonymous_token_unavailable"],
        visibility: expect.objectContaining({
          status: "blocked",
          tokenHttpStatus: 401,
          digest: null,
        }),
        scope: expect.objectContaining({
          packageVisibilityChanged: false,
          dispatchAllowed: false,
          externalReleaseAccepted: false,
          s1Complete: false,
        }),
      }),
    );
    expect(fixture.commands).not.toContainEqual(
      expect.arrayContaining(["workflow", "run"]),
    );
    await expect(
      applySandboxExternalReleaseDispatch({
        ...fixture,
        expectedPreviewSha256: preview.contentSha256,
      }),
    ).rejects.toThrow("prerequisites are unavailable");
  });

  it.each([
    [
      "active publication",
      [publicationRun({ id: 90, status: "waiting", title: "bootstrap" })],
      [],
      ["sandbox_publication_run_active"],
    ],
    [
      "successful release",
      [],
      [publicationRun({ id: 91, status: "completed", title: "release" })],
      ["sandbox_release_already_succeeded"],
    ],
  ])(
    "blocks when %s exists",
    async (_name, activeRuns, successes, blockers) => {
      const fixture = await dispatchFixture({ activeRuns, successes });
      const preview = await previewSandboxExternalReleaseDispatch(fixture);

      expect(preview).toEqual(
        expect.objectContaining({ status: "blocked", blockers }),
      );
      expect(fixture.commands).not.toContainEqual(
        expect.arrayContaining(["workflow", "run"]),
      );
    },
  );

  it("dispatches release and binds the exact returned run", async () => {
    const fixture = await dispatchFixture({});
    const preview = await previewSandboxExternalReleaseDispatch(fixture);
    expect(preview.status).toBe("ready");

    const result = await applySandboxExternalReleaseDispatch({
      ...fixture,
      expectedPreviewSha256: preview.contentSha256,
      sleep: async () => {},
    });

    expect(
      validateSandboxExternalReleaseDispatchResult(result, preview),
    ).toEqual([]);
    expect(result).toEqual(
      expect.objectContaining({
        status: "dispatched",
        outcomeCode: "run_identity_verified",
        sourceSha: SOURCE_SHA,
        workflowRunId: "101",
        workflowRunAttempt: "1",
        runStatus: "queued",
        scope: {
          anonymousVisibilityVerified: true,
          packageVisibilityChanged: false,
          dispatchRequested: true,
          dispatchOutcomeKnown: true,
          externalReleaseAccepted: false,
          s1Complete: false,
        },
      }),
    );
    expect(fixture.commands).toContainEqual([
      "workflow",
      "run",
      "publish-sandbox.yml",
      "--repo",
      "github.com/Champ-X/Napier",
      "--ref",
      "main",
      "-f",
      "mode=release",
      "-f",
      `source_sha=${SOURCE_SHA}`,
    ]);
  });

  it("rejects stale or invalid current/bootstrap state", async () => {
    const stale = await dispatchFixture({});
    const preview = await previewSandboxExternalReleaseDispatch(stale);
    stale.visibility = "blocked";
    await expect(
      applySandboxExternalReleaseDispatch({
        ...stale,
        expectedPreviewSha256: preview.contentSha256,
      }),
    ).rejects.toThrow("preview is stale");

    for (const fixture of [
      await dispatchFixture({ mainSha: "b".repeat(40) }),
      await dispatchFixture({ bootstrapTitle: "release" }),
      await dispatchFixture({ bootstrapConclusion: "failure" }),
    ]) {
      await expect(
        previewSandboxExternalReleaseDispatch(fixture),
      ).rejects.toThrow();
    }
  });

  it.each([
    ["dispatch command", { dispatchError: true }, "dispatch_command_failed"],
    ["missing URL", { dispatchStdout: "" }, "run_url_missing"],
    ["run lookup", { lookupError: true }, "run_lookup_failed"],
    [
      "run identity",
      { dispatchedHeadSha: "b".repeat(40) },
      "run_identity_invalid",
    ],
  ])(
    "returns indeterminate after %s uncertainty",
    async (_name, input, code) => {
      const fixture = await dispatchFixture(input);
      const preview = await previewSandboxExternalReleaseDispatch(fixture);

      await expect(
        applySandboxExternalReleaseDispatch({
          ...fixture,
          expectedPreviewSha256: preview.contentSha256,
          sleep: async () => {},
        }),
      ).resolves.toEqual(
        expect.objectContaining({
          status: "indeterminate",
          outcomeCode: code,
          scope: expect.objectContaining({
            packageVisibilityChanged: false,
            dispatchRequested: true,
            dispatchOutcomeKnown: false,
            s1Complete: false,
          }),
        }),
      );
    },
  );
});

async function dispatchFixture({
  visibility = "ready",
  activeRuns = [],
  successes = [],
  mainSha = SOURCE_SHA,
  bootstrapTitle = "bootstrap",
  bootstrapConclusion = "success",
  dispatchError = false,
  dispatchStdout = "https://github.com/Champ-X/Napier/actions/runs/101\n",
  lookupError = false,
  dispatchedHeadSha = SOURCE_SHA,
} = {}) {
  const repoRoot = await mkdtemp(
    path.join(tmpdir(), "napier-release-dispatch-"),
  );
  roots.push(repoRoot);
  const contextSha256 = await copyDockerContext(repoRoot);
  const commands = [];
  let dispatched = false;
  const fixture = {
    repoRoot,
    sourceSha: SOURCE_SHA,
    bootstrapRunId: BOOTSTRAP_RUN_ID,
    visibility,
    commands,
    runGit: async () => ({ stdout: `${SOURCE_SHA}\n`, stderr: "" }),
    request: visibilityRequest(contextSha256, () => fixture.visibility),
    runGh: async (args) => {
      commands.push(args);
      const endpoint = args.at(-1) ?? "";
      if (args[0] === "workflow") {
        dispatched = true;
        if (dispatchError) throw new Error("dispatch failed");
        return { stdout: dispatchStdout, stderr: "" };
      }
      if (endpoint.includes("/commits/main")) {
        return { stdout: JSON.stringify({ sha: mainSha }), stderr: "" };
      }
      if (endpoint.includes(`/actions/runs/${BOOTSTRAP_RUN_ID}`)) {
        return {
          stdout: JSON.stringify(
            bootstrapRun({
              title: bootstrapTitle,
              conclusion: bootstrapConclusion,
            }),
          ),
          stderr: "",
        };
      }
      if (endpoint.includes("/actions/runs/101") && dispatched) {
        if (lookupError) throw new Error("lookup failed");
        return {
          stdout: JSON.stringify(
            publicationRun({
              id: 101,
              status: "queued",
              title: "release",
              headSha: dispatchedHeadSha,
            }),
          ),
          stderr: "",
        };
      }
      if (endpoint.includes("/actions/workflows/")) {
        const requested = SANDBOX_PUBLICATION_ACTIVE_RUN_STATUSES.find(
          (status) => endpoint.includes(`status=${status}`),
        );
        if (endpoint.includes("status=success")) {
          expect(endpoint).toContain(`head_sha=${SOURCE_SHA}`);
        }
        const observed = requested
          ? activeRuns.filter((run) => run.status === requested)
          : endpoint.includes("status=success")
            ? successes
            : [];
        return {
          stdout: JSON.stringify({
            total_count: observed.length,
            workflow_runs: observed,
          }),
          stderr: "",
        };
      }
      throw new Error("unexpected gh command");
    },
  };
  return fixture;
}

function visibilityRequest(contextSha256, visibility) {
  return async ({ url }) => {
    if (url.includes("/token?")) {
      return visibility() === "ready"
        ? {
            status: 200,
            headers: {},
            body: Buffer.from(JSON.stringify({ token: "t".repeat(40) })),
          }
        : { status: 401, headers: {}, body: Buffer.from("{}") };
    }
    if (visibility() !== "ready")
      throw new Error("unexpected registry request");
    const [index, manifests, configs] = registryFixture(contextSha256);
    if (url.includes(`/manifests/bootstrap-${SOURCE_SHA}`)) return index;
    for (const manifest of Object.values(manifests)) {
      if (
        url.endsWith(`/manifests/${manifest.headers["docker-content-digest"]}`)
      ) {
        return manifest;
      }
    }
    for (const config of Object.values(configs)) {
      if (url.endsWith(`/blobs/${config.headers["docker-content-digest"]}`)) {
        return config;
      }
    }
    throw new Error("unexpected registry request");
  };
}

function registryFixture(contextSha256) {
  const configs = Object.fromEntries(
    ["linux/amd64", "linux/arm64"].map((platform) => {
      const [os, architecture] = platform.split("/");
      return [
        platform,
        response(
          Buffer.from(
            JSON.stringify({
              os,
              architecture,
              config: {
                Labels: {
                  "io.napier.sandbox.context-sha256": contextSha256,
                  "org.opencontainers.image.revision": SOURCE_SHA,
                  "org.opencontainers.image.version": "0.1.0",
                },
              },
            }),
          ),
        ),
      ];
    }),
  );
  const manifests = Object.fromEntries(
    Object.entries(configs).map(([platform, config]) => [
      platform,
      response(
        Buffer.from(
          JSON.stringify({
            schemaVersion: 2,
            mediaType: "application/vnd.oci.image.manifest.v1+json",
            config: descriptor(config),
            layers: [descriptor(response(Buffer.from(`layer:${platform}`)))],
          }),
        ),
      ),
    ]),
  );
  const index = response(
    Buffer.from(
      JSON.stringify({
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
      }),
    ),
  );
  return [index, manifests, configs];
}

function bootstrapRun({ title = "bootstrap", conclusion = "success" } = {}) {
  return {
    id: Number(BOOTSTRAP_RUN_ID),
    run_attempt: 1,
    event: "workflow_dispatch",
    status: "completed",
    conclusion,
    head_branch: "main",
    head_sha: SOURCE_SHA,
    path: ".github/workflows/publish-sandbox.yml",
    display_title: `Sandbox OCI ${title} @ ${SOURCE_SHA}`,
    updated_at: "2026-08-13T00:00:00.000Z",
    repository: { full_name: "Champ-X/Napier" },
    head_repository: { full_name: "Champ-X/Napier" },
  };
}

function publicationRun({ id, status, title, headSha = SOURCE_SHA }) {
  return {
    id,
    run_attempt: 1,
    event: "workflow_dispatch",
    status,
    conclusion: status === "completed" ? "success" : null,
    head_branch: "main",
    head_sha: headSha,
    path: ".github/workflows/publish-sandbox.yml",
    display_title: `Sandbox OCI ${title} @ ${headSha}`,
    updated_at: "2026-08-13T00:00:00.000Z",
    repository: { full_name: "Champ-X/Napier" },
    head_repository: { full_name: "Champ-X/Napier" },
  };
}

async function copyDockerContext(root) {
  await mkdir(path.join(root, "docker/napier-sandbox"), { recursive: true });
  for (const name of ["Dockerfile", "package.json", "package-lock.json"]) {
    await cp(
      path.resolve("docker/napier-sandbox", name),
      path.join(root, "docker/napier-sandbox", name),
    );
  }
  return (await sandboxImageSourceEvidence(root)).contextSha256;
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
