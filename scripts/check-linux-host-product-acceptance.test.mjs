import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { verifyLinuxHostProductAcceptance } from "./check-linux-host-product-acceptance.mjs";
import {
  includeLinuxHostSourceSnapshotPath,
  linuxGuestCommand,
} from "./linux-host-product-acceptance-live.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Linux host product acceptance artifact", () => {
  it("bounds guest diagnostics without truncating the final JSON result", () => {
    const command = linuxGuestCommand({
      archivePath: "/tmp/source.tar",
      runName: "napier-linux-host-test",
      nodeVersion: "v24.16.0",
    });

    expect(command).toContain(
      'node scripts/linux-host-product-acceptance-guest.mjs >"$guest_stdout" 2>"$guest_stderr"',
    );
    expect(command).toContain('cat "$guest_stdout"');
    expect(command).toContain('tail -c 65536 "$guest_stderr" >&2');
    expect(command).toContain("exit 1");
  });

  it("excludes mutable and downstream receipts from the clean source archive", () => {
    expect(
      [
        "goal.md",
        "docs/artifacts/linux-host-product-acceptance-stage19.json",
        "docs/artifacts/release-artifacts-audit-0.1.0.json",
      ].map(includeLinuxHostSourceSnapshotPath),
    ).toEqual([false, false, false]);
    expect(
      includeLinuxHostSourceSnapshotPath(
        "scripts/linux-host-product-acceptance-live.mjs",
      ),
    ).toBe(true);
  });

  it("accepts the current fresh Linux product receipt", async () => {
    await expect(verifyLinuxHostProductAcceptance()).resolves.toEqual(
      expect.objectContaining({
        valid: true,
        errors: [],
        path: "docs/artifacts/linux-host-product-acceptance-stage19.json",
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
  });

  it("rejects host, install, product, and scope tampering", async () => {
    for (const mutate of [
      (value) => {
        value.guest.host.containerized = true;
      },
      (value) => {
        value.guest.install.exitCode = 1;
      },
      (value) => {
        value.guest.product.doctor.warningCount = 2;
      },
      (value) => {
        value.guest.product.imageRepair.repair.action = "reused";
      },
      (value) => {
        value.guest.acquisition.localAnonymous.action = "built";
      },
      (value) => {
        value.scope.windowsHostProductAcceptance = true;
      },
    ]) {
      const root = await fixtureRoot();
      const artifactPath = path.join(
        root,
        "docs/artifacts/linux-host-product-acceptance-stage19.json",
      );
      const value = JSON.parse(await readFile(artifactPath, "utf8"));
      mutate(value);
      await writeFile(artifactPath, `${JSON.stringify(value, null, 2)}\n`);

      await expect(
        verifyLinuxHostProductAcceptance({ repoRoot: root }),
      ).resolves.toEqual(
        expect.objectContaining({
          valid: false,
          errors: expect.arrayContaining([
            expect.stringMatching(
              /Linux host product acceptance artifact (?:shape|content hash) is invalid/u,
            ),
          ]),
        }),
      );
    }
  });

  it("rejects artifact paths outside the repository", async () => {
    await expect(
      verifyLinuxHostProductAcceptance({ artifactPath: "../outside.json" }),
    ).rejects.toThrow("artifact path must remain inside the repository");
  });
});

async function fixtureRoot() {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-linux-host-artifact-"),
  );
  roots.push(root);
  for (const relative of [
    "docs/artifacts/linux-host-product-acceptance-stage19.json",
    "docs/artifacts/sandbox-acquisition-stage20.json",
    "package-lock.json",
    "packages/runtime/src/project-skill-snapshot-acquisition.ts",
    "packages/runtime/src/project-skill-snapshot-anchor.ts",
    "packages/runtime/src/project-skill-snapshot-memory.ts",
    "packages/runtime/src/project-skill-snapshot-model.ts",
    "packages/runtime/src/project-skill-snapshot.ts",
    "packages/runtime/src/sandbox-terminal.ts",
    "packages/contracts/src/sandbox-setup.ts",
    "packages/runtime/src/sandbox-official-release-model.ts",
    "packages/runtime/src/sandbox-official-release.ts",
    "packages/runtime/src/sandbox-runtime-acquisition.ts",
    "packages/runtime/src/sandbox-runtime-setup.ts",
    "packages/runtime/src/sandbox-setup-service.ts",
    "packages/runtime/src/sandbox-setup-verification.ts",
    "packages/runtime/src/sandbox-installation.ts",
    "apps/cli/src/sandbox-runtime-setup-cli.ts",
    "apps/web/src/SandboxSetupCard.tsx",
    "apps/web/src/sandbox-setup-view-model.ts",
    "scripts/copy-sandbox-image.mjs",
    "scripts/check-sandbox-acquisition.mjs",
    "scripts/sandbox-acquisition-acceptance.mjs",
    "scripts/sandbox-acquisition-artifact.mjs",
    "scripts/sandbox-acquisition-support.mjs",
    "scripts/check-linux-host-product-acceptance.mjs",
    "scripts/check-sandbox-product-acceptance.mjs",
    "scripts/linux-host-product-acceptance-artifact.mjs",
    "scripts/linux-host-product-acceptance-guest.mjs",
    "scripts/linux-host-product-acceptance-live.mjs",
    "scripts/prepare-node-pty.mjs",
    "scripts/prepare-node-pty.test.mjs",
    "scripts/sandbox-first-use-coding-acceptance.mjs",
    "scripts/sandbox-first-use-coding-support.mjs",
    "scripts/sandbox-invalid-binding-repair-acceptance.mjs",
    "scripts/sandbox-invalid-binding-repair-artifact.mjs",
    "scripts/sandbox-image-repair-acceptance.mjs",
    "scripts/sandbox-image-repair-artifact.mjs",
    "scripts/sandbox-product-acceptance-artifact.mjs",
    "scripts/sandbox-product-acceptance-live.mjs",
  ]) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.resolve(relative), target);
  }
  return root;
}
