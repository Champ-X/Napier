import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { ArtifactManifestEntry } from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { HostDirectSandboxAdapter } from "../src/sandbox-host-direct.js";
import { previewWorkspaceArtifactDiff } from "../src/workspace-artifact-diff.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("previewWorkspaceArtifactDiff", () => {
  it("returns a bounded working-tree diff without changing Git metadata", async () => {
    const workspaceRoot = await createRepository();
    const indexPath = path.join(workspaceRoot, ".git/index");
    const indexBefore = await sha256File(indexPath);
    await writeFile(
      path.join(workspaceRoot, "report.md"),
      "# Report\nPRIVATE_DIFF_AFTER\n",
      "utf8",
    );

    const preview = await previewWorkspaceArtifactDiff(
      workspaceRoot,
      artifact(),
      new HostDirectSandboxAdapter(),
    );

    expect(preview).toEqual(
      expect.objectContaining({
        scope: "working",
        outputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        outputBytes: expect.any(Number),
        fileCount: 1,
        hunkCount: 1,
        addedLineCount: 1,
        deletedLineCount: 1,
        repositoryStateSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(preview.text).toContain("-PRIVATE_DIFF_BEFORE");
    expect(preview.text).toContain("+PRIVATE_DIFF_AFTER");
    expect(preview.outputBytes).toBe(Buffer.byteLength(preview.text, "utf8"));
    expect(preview.outputSha256).toBe(
      createHash("sha256").update(preview.text).digest("hex"),
    );
    expect(await sha256File(indexPath)).toBe(indexBefore);
  });

  it("rejects escaped, non-file, and unsettled artifact targets", async () => {
    const sandbox = new HostDirectSandboxAdapter();
    const root = await temporaryRoot();

    await expect(
      previewWorkspaceArtifactDiff(
        root,
        artifact({ path: "../PRIVATE_OUTSIDE.md" }),
        sandbox,
      ),
    ).rejects.toThrow("escapes the configured workspace");
    await expect(
      previewWorkspaceArtifactDiff(
        root,
        artifact({ kind: "directory" }),
        sandbox,
      ),
    ).rejects.toThrow("Only file artifacts can be diffed");
    await expect(
      previewWorkspaceArtifactDiff(
        root,
        artifact({ status: "candidate" }),
        sandbox,
      ),
    ).rejects.toThrow("Only produced or verified artifacts can be diffed");
  });
});

function artifact(
  overrides: Partial<ArtifactManifestEntry> = {},
): ArtifactManifestEntry {
  return {
    id: "report",
    path: "report.md",
    kind: "file",
    description: "Verified report",
    status: "verified",
    evidence: "Verified by the runtime.",
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
    ...overrides,
  };
}

async function createRepository(): Promise<string> {
  const root = await temporaryRoot();
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  await git(workspaceRoot, ["init", "--quiet"]);
  await writeFile(
    path.join(workspaceRoot, "report.md"),
    "# Report\nPRIVATE_DIFF_BEFORE\n",
    "utf8",
  );
  await git(workspaceRoot, ["add", "report.md"]);
  await git(workspaceRoot, [
    "-c",
    "user.name=Napier Test",
    "-c",
    "user.email=napier@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  ]);
  return workspaceRoot;
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-artifact-diff-"));
  roots.push(root);
  return root;
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("/usr/bin/git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
}

async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}
