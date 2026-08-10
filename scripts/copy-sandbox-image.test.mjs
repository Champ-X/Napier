import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { copySandboxImageAsset } from "./copy-sandbox-image.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Sandbox image build asset", () => {
  it("copies the pinned Dockerfile into the Runtime dist package", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-sandbox-asset-"));
    roots.push(root);
    await mkdir(path.join(root, "docker/napier-sandbox"), { recursive: true });
    await writeFile(
      path.join(root, "docker/napier-sandbox/Dockerfile"),
      "FROM scratch\n",
    );

    await copySandboxImageAsset(root);

    await expect(
      readFile(
        path.join(root, "packages/runtime/dist/sandbox-image/Dockerfile"),
        "utf8",
      ),
    ).resolves.toBe("FROM scratch\n");
  });
});
