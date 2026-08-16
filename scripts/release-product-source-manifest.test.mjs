import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createReleaseProductSourceManifest,
  verifyReleaseProductSourceManifest,
} from "./release-product-source-manifest.mjs";

const roots = [];
const MANIFEST = "docs/artifacts/default-product-source-manifest-0.1.3.json";

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Release Product source manifest", () => {
  it("binds a material successor source set to the running identity", async () => {
    const manifest = await verifyReleaseProductSourceManifest();
    expect(manifest).toMatchObject({
      kind: "napier.release-product-source-manifest",
      schemaVersion: 1,
      productVersion: "0.1.3",
      predecessor: {
        productVersion: "0.1.2",
        commit: "45c736f0b426db5d03f88adbb17acb8df32e7703",
      },
      fileCount: expect.any(Number),
      totalBytes: expect.any(Number),
      contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(manifest.predecessor.changedPathCount).toBeGreaterThan(0);
    expect(manifest.files.some((file) => file.path === "goal.md")).toBe(false);
    expect(
      manifest.files.some((file) =>
        file.path.startsWith("packages/runtime/src/"),
      ),
    ).toBe(true);
  });

  it("rejects manifest drift and regenerates deterministically", async () => {
    const expected = await createReleaseProductSourceManifest();
    const observed = JSON.parse(await readFile(MANIFEST, "utf8"));
    expect(expected).toEqual(observed);
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-release-product-source-"),
    );
    roots.push(root);
    const target = path.join(root, "manifest.json");
    observed.files[0].bytes += 1;
    await writeFile(target, `${JSON.stringify(observed, null, 2)}\n`, "utf8");
    await expect(verifyReleaseProductSourceManifest(target)).rejects.toThrow();
  });
});
