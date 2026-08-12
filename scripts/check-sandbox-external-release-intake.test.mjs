import { execFile } from "node:child_process";
import {
  access,
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  applySandboxExternalReleaseIntake,
  previewSandboxExternalReleaseIntake,
  validateSandboxExternalReleaseIntakePreview,
  validateSandboxExternalReleaseIntakeResult,
} from "./sandbox-external-release-intake.mjs";
import {
  PACKAGED_EXTERNAL_RELEASE_PATH,
  RETAINED_EXTERNAL_AUTHORITY_PATH,
  RETAINED_EXTERNAL_RELEASE_PATH,
} from "./sandbox-external-release-promotion.mjs";
import {
  TEST_EXTERNAL_RELEASE_SOURCE_SHA as SOURCE_SHA,
  writeSandboxExternalReleaseTestFixture,
} from "./sandbox-external-release-test-fixture.mjs";

const execFileAsync = promisify(execFile);
const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Sandbox external release intake", () => {
  it("downloads, validates, promotes, and removes all transient inputs", async () => {
    const fixture = await intakeFixture();
    const preview = await previewSandboxExternalReleaseIntake(fixture);

    expect(validateSandboxExternalReleaseIntakePreview(preview)).toEqual([]);
    expect(preview).toEqual(
      expect.objectContaining({
        sourceSha: SOURCE_SHA,
        workflowRunId: "123",
        workflowRunAttempt: "1",
        promotionAction: "create",
        retention: expect.objectContaining({
          rawRunResponse: false,
          rawArtifactList: false,
          downloadedEvidence: false,
          temporaryPaths: false,
        }),
        scope: expect.objectContaining({
          releaseIntake: true,
          promotionPreviewValidated: true,
          s1Complete: false,
        }),
      }),
    );
    await expect(access(fixture.temporaryRoot)).rejects.toThrow();

    const result = await applySandboxExternalReleaseIntake({
      ...fixture,
      expectedPreviewSha256: preview.contentSha256,
    });

    expect(validateSandboxExternalReleaseIntakeResult(result, preview)).toEqual(
      [],
    );
    expect(result.scope).toEqual(
      expect.objectContaining({
        promotionApplied: true,
        packageParityVerified: true,
        s1Complete: false,
      }),
    );
    const [source, retained, packaged, authority] = await Promise.all([
      readFile(
        path.join(fixture.downloadSource, "external-publication-receipt.json"),
      ),
      readFile(path.join(fixture.repoRoot, RETAINED_EXTERNAL_RELEASE_PATH)),
      readFile(path.join(fixture.repoRoot, PACKAGED_EXTERNAL_RELEASE_PATH)),
      readFile(path.join(fixture.repoRoot, RETAINED_EXTERNAL_AUTHORITY_PATH)),
    ]);
    expect(retained).toEqual(source);
    expect(packaged).toEqual(source);
    expect(JSON.parse(authority.toString("utf8"))).toEqual(
      expect.objectContaining({
        authority: "external_publication",
        sourceSha: SOURCE_SHA,
        workflowRunId: "123",
      }),
    );
    await expect(access(fixture.temporaryRoot)).rejects.toThrow();
  });

  it("reports unchanged after exact promotion and rejects stale apply", async () => {
    const fixture = await intakeFixture();
    const first = await previewSandboxExternalReleaseIntake(fixture);
    await applySandboxExternalReleaseIntake({
      ...fixture,
      expectedPreviewSha256: first.contentSha256,
    });
    const second = await previewSandboxExternalReleaseIntake(fixture);

    expect(second.promotionAction).toBe("unchanged");
    await expect(
      applySandboxExternalReleaseIntake({
        ...fixture,
        expectedPreviewSha256: first.contentSha256,
      }),
    ).rejects.toThrow("preview is stale");
    await expect(access(fixture.temporaryRoot)).rejects.toThrow();
  });

  it("rejects bootstrap authority and tampered evidence without residue", async () => {
    for (const mutate of [
      (fixture) => {
        fixture.rawArtifacts.total_count = 0;
        fixture.rawArtifacts.artifacts = [];
      },
      (fixture) => {
        fixture.rawArtifacts.artifacts[0].size_in_bytes = 16 * 1024 * 1024 + 1;
      },
      async (fixture) => {
        await writeFile(
          path.join(fixture.downloadSource, "cosign.verify.json"),
          "[]",
        );
      },
      async (fixture) => {
        const target = path.join(fixture.downloadSource, "cosign.verify.json");
        await rm(target);
        await symlink("cosign.bundle.json", target);
      },
      async (fixture) => {
        await writeFile(
          path.join(fixture.downloadSource, "unexpected.txt"),
          "unexpected\n",
        );
      },
    ]) {
      const fixture = await intakeFixture();
      await mutate(fixture);

      await expect(
        previewSandboxExternalReleaseIntake(fixture),
      ).rejects.toThrow();
      await expect(access(fixture.temporaryRoot)).rejects.toThrow();
      await expect(
        readFile(path.join(fixture.repoRoot, RETAINED_EXTERNAL_RELEASE_PATH)),
      ).rejects.toThrow();
    }
  });

  it("rolls back promotion when transient cleanup fails", async () => {
    const fixture = await intakeFixture();
    const preview = await previewSandboxExternalReleaseIntake(fixture);
    let removalAttempts = 0;

    await expect(
      applySandboxExternalReleaseIntake({
        ...fixture,
        expectedPreviewSha256: preview.contentSha256,
        removeTemporaryRoot: async () => {
          removalAttempts += 1;
          if (removalAttempts === 1) {
            throw new Error("cleanup failed");
          }
          await rm(fixture.temporaryRoot, { recursive: true, force: true });
        },
      }),
    ).rejects.toThrow("cleanup failed");

    expect(removalAttempts).toBe(2);
    await expect(access(fixture.temporaryRoot)).rejects.toThrow();
    await expect(
      access(path.join(fixture.repoRoot, RETAINED_EXTERNAL_RELEASE_PATH)),
    ).rejects.toThrow();
    await expect(
      access(path.join(fixture.repoRoot, RETAINED_EXTERNAL_AUTHORITY_PATH)),
    ).rejects.toThrow();
    await expect(
      access(path.join(fixture.repoRoot, PACKAGED_EXTERNAL_RELEASE_PATH)),
    ).rejects.toThrow();
  });

  it("keeps CLI failure output independent of gh stderr and credentials", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-intake-cli-"));
    roots.push(root);
    const ghPath = path.join(root, "gh");
    const secret = "intake-secret-never-print";
    await writeFile(
      ghPath,
      `#!/bin/sh\nprintf '%s\\n' '${secret}' >&2\nexit 1\n`,
    );
    await chmod(ghPath, 0o700);

    const result = await execFileAsync(
      process.execPath,
      [
        path.resolve("scripts/check-sandbox-external-release-intake.mjs"),
        "--repo-root",
        root,
        "--source-sha",
        SOURCE_SHA,
        "--expected-run-id",
        "123",
      ],
      {
        env: {
          ...process.env,
          PATH: `${root}${path.delimiter}${process.env.PATH ?? ""}`,
          GH_TOKEN: secret,
        },
      },
    ).catch((error) => error);

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(
      /^Sandbox external release intake failed \([a-f0-9]{16}\)\n$/u,
    );
    expect(result.stderr).not.toContain(secret);
  });
});

async function intakeFixture() {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "napier-intake-repo-"));
  const temporaryRoot = path.join(repoRoot, "transient");
  roots.push(repoRoot);
  const promotion = await writeSandboxExternalReleaseTestFixture(repoRoot);
  const downloadSource = promotion.evidenceDir;
  const rawRun = {
    id: 123,
    run_attempt: 1,
    event: "workflow_dispatch",
    status: "completed",
    conclusion: "success",
    head_branch: "main",
    head_sha: SOURCE_SHA,
    path: ".github/workflows/publish-sandbox.yml",
    updated_at: "2026-08-12T00:00:00.000Z",
    repository: { id: 42, full_name: "Champ-X/Napier" },
    head_repository: { id: 42, full_name: "Champ-X/Napier" },
  };
  const rawArtifacts = {
    total_count: 1,
    artifacts: [
      {
        id: 456,
        name: `sandbox-external-publication-${SOURCE_SHA}`,
        expired: false,
        size_in_bytes: 1024,
        workflow_run: {
          id: 123,
          head_branch: "main",
          head_sha: SOURCE_SHA,
          repository_id: 42,
          head_repository_id: 42,
        },
      },
    ],
  };
  return {
    repoRoot,
    sourceSha: SOURCE_SHA,
    expectedRunId: "123",
    temporaryRoot,
    downloadSource,
    rawRun,
    rawArtifacts,
    createTemporaryRoot: async () => temporaryRoot,
    runGh: async (args) => {
      if (args[0] === "api" && args.at(-1)?.includes("/artifacts")) {
        expect(args).toEqual(
          expect.arrayContaining(["--hostname", "github.com"]),
        );
        return { stdout: JSON.stringify(rawArtifacts), stderr: "" };
      }
      if (args[0] === "api") {
        expect(args).toEqual(
          expect.arrayContaining(["--hostname", "github.com"]),
        );
        return { stdout: JSON.stringify(rawRun), stderr: "" };
      }
      if (args[0] === "run" && args[1] === "download") {
        expect(args).toEqual(
          expect.arrayContaining(["--repo", "github.com/Champ-X/Napier"]),
        );
        const target = args[args.indexOf("--dir") + 1];
        const transientEntries = await readdirNames(temporaryRoot);
        expect(transientEntries.sort()).toEqual(["authority.json", "evidence"]);
        expect(await readdirNames(target)).toEqual([]);
        await mkdir(target, { recursive: true });
        for (const name of await readdirNames(downloadSource)) {
          await cp(path.join(downloadSource, name), path.join(target, name));
        }
        return { stdout: "", stderr: "" };
      }
      throw new Error("unexpected gh command");
    },
  };
}

async function readdirNames(directory) {
  const { readdir } = await import("node:fs/promises");
  return readdir(directory);
}
