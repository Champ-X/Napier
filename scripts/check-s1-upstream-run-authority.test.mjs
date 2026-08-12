import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  verifyS1UpstreamRunAuthorityFile,
  writeS1UpstreamRunAuthority,
} from "./check-s1-upstream-run-authority.mjs";
import {
  createS1UpstreamRunAuthority,
  validateS1UpstreamRunAuthority,
} from "./s1-upstream-run-authority.mjs";
import {
  canonicalJson,
  sha256,
} from "./sandbox-external-publication-model.mjs";

const SOURCE_SHA = "a".repeat(40);
const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("S1 upstream workflow run authority", () => {
  it.each([
    [
      "external_publication",
      ".github/workflows/publish-sandbox.yml",
      `sandbox-external-publication-${SOURCE_SHA}`,
    ],
    [
      "windows_host_product_acceptance",
      ".github/workflows/windows-host-product-acceptance.yml",
      `napier-windows-host-product-acceptance-${SOURCE_SHA}`,
    ],
  ])("accepts exact successful %s authority", (authority, workflow, name) => {
    const value = artifact({ authority, workflow, name });

    expect(
      validateS1UpstreamRunAuthority(value, {
        authority,
        sourceSha: SOURCE_SHA,
        workflowRunId: "123",
      }),
    ).toEqual([]);
    expect(value.scope).toEqual({
      necessarySourceAuthority: true,
      semanticReceiptVerified: false,
      s1Complete: false,
    });
  });

  it.each([
    [
      "failed conclusion",
      ({ run }) => {
        run.conclusion = "failure";
      },
    ],
    [
      "queued status",
      ({ run }) => {
        run.status = "queued";
        run.conclusion = null;
      },
    ],
    [
      "automatic event",
      ({ run }) => {
        run.event = "push";
      },
    ],
    [
      "wrong workflow",
      ({ run }) => {
        run.path = ".github/workflows/other.yml";
      },
    ],
    [
      "wrong source",
      ({ run }) => {
        run.head_sha = "b".repeat(40);
      },
    ],
    [
      "forked head",
      ({ run }) => {
        run.head_repository.full_name = "fork/Napier";
        run.head_repository.id = 99;
      },
    ],
    [
      "expired artifact",
      ({ artifacts }) => {
        artifacts.artifacts[0].expired = true;
      },
    ],
    [
      "empty artifact",
      ({ artifacts }) => {
        artifacts.artifacts[0].size_in_bytes = 0;
      },
    ],
    [
      "wrong artifact source",
      ({ artifacts }) => {
        artifacts.artifacts[0].workflow_run.head_sha = "b".repeat(40);
      },
    ],
    [
      "duplicate artifact name",
      ({ artifacts }) => {
        artifacts.artifacts.push(structuredClone(artifacts.artifacts[0]));
        artifacts.total_count = 2;
      },
    ],
  ])("rejects %s before producing authority", (_name, mutate) => {
    const fixture = fixtureValues();
    mutate(fixture);
    expect(() =>
      createS1UpstreamRunAuthority({
        authority: "external_publication",
        sourceSha: SOURCE_SHA,
        expectedRunId: "123",
        ...fixture,
      }),
    ).toThrow();
  });

  it("rejects scope and content tampering after rehash", () => {
    const value = artifact();
    value.scope.s1Complete = true;
    rehash(value);

    expect(validateS1UpstreamRunAuthority(value)).not.toEqual([]);
  });

  it("rejects an authority replayed for another requested run", () => {
    const value = artifact();

    expect(
      validateS1UpstreamRunAuthority(value, {
        authority: "external_publication",
        sourceSha: SOURCE_SHA,
        workflowRunId: "124",
      }),
    ).toContain("S1 upstream run authority workflowRunId does not match");
  });

  it("writes and independently replays a sanitized authority file", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-s1-authority-"));
    roots.push(root);
    const runPath = path.join(root, "run.json");
    const artifactsPath = path.join(root, "artifacts.json");
    const outputPath = path.join(root, "authority.json");
    const fixture = fixtureValues();
    await Promise.all([
      writeFile(runPath, JSON.stringify(fixture.run)),
      writeFile(artifactsPath, JSON.stringify(fixture.artifacts)),
    ]);

    await expect(
      writeS1UpstreamRunAuthority({
        authority: "external_publication",
        sourceSha: SOURCE_SHA,
        expectedRunId: "123",
        runPath,
        artifactsPath,
        outputPath,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        valid: true,
        errors: [],
        path: outputPath,
      }),
    );
    const serialized = await readFile(outputPath, "utf8");
    const written = JSON.parse(serialized);
    expect(written).not.toHaveProperty("actor");
    expect(written).not.toHaveProperty("download_url");
    expect(written.artifact).not.toHaveProperty("archive_download_url");
    expect(written.artifact).not.toHaveProperty("created_at");
    await expect(
      verifyS1UpstreamRunAuthorityFile({
        authority: "external_publication",
        sourceSha: SOURCE_SHA,
        expectedRunId: "123",
        artifactPath: outputPath,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        valid: true,
        errors: [],
        path: outputPath,
      }),
    );
  });
});

function artifact({
  authority = "external_publication",
  workflow = ".github/workflows/publish-sandbox.yml",
  name = `sandbox-external-publication-${SOURCE_SHA}`,
} = {}) {
  const fixture = fixtureValues({ workflow, name });
  return createS1UpstreamRunAuthority({
    authority,
    sourceSha: SOURCE_SHA,
    expectedRunId: "123",
    ...fixture,
  });
}

function fixtureValues({
  workflow = ".github/workflows/publish-sandbox.yml",
  name = `sandbox-external-publication-${SOURCE_SHA}`,
} = {}) {
  return {
    run: {
      id: 123,
      run_attempt: 2,
      event: "workflow_dispatch",
      status: "completed",
      conclusion: "success",
      head_branch: "main",
      head_sha: SOURCE_SHA,
      path: workflow,
      updated_at: "2026-08-12T00:00:00.000Z",
      repository: { id: 42, full_name: "Champ-X/Napier" },
      head_repository: { id: 42, full_name: "Champ-X/Napier" },
    },
    artifacts: {
      total_count: 1,
      artifacts: [
        {
          id: 456,
          name,
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
    },
  };
}

function rehash(value) {
  const { contentSha256: _contentSha256, ...content } = value;
  value.contentSha256 = sha256(canonicalJson(content));
}
