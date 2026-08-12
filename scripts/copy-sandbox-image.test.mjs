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
    const files = {
      Dockerfile: "FROM scratch\n",
      "package.json": '{"name":"sandbox"}\n',
      "package-lock.json": '{"lockfileVersion":3}\n',
    };
    await Promise.all(
      Object.entries(files).map(([fileName, content]) =>
        writeFile(path.join(root, "docker/napier-sandbox", fileName), content),
      ),
    );

    await copySandboxImageAsset(root);

    for (const [fileName, content] of Object.entries(files)) {
      await expect(
        readFile(
          path.join(root, "packages/runtime/dist/sandbox-image", fileName),
          "utf8",
        ),
      ).resolves.toBe(content);
    }
    await expect(
      readFile(
        path.join(
          root,
          "packages/runtime/dist/sandbox-image/external-publication.json",
        ),
        "utf8",
      ),
    ).rejects.toThrow();
  });

  it("copies a retained external release receipt and removes stale packaged bytes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-sandbox-asset-"));
    roots.push(root);
    await Promise.all([
      mkdir(path.join(root, "docker/napier-sandbox"), { recursive: true }),
      mkdir(path.join(root, "docs/artifacts"), { recursive: true }),
      mkdir(path.join(root, "packages/runtime/dist/sandbox-image"), {
        recursive: true,
      }),
    ]);
    for (const [fileName, content] of Object.entries({
      Dockerfile: "FROM scratch\n",
      "package.json": '{"name":"sandbox"}\n',
      "package-lock.json": '{"lockfileVersion":3}\n',
    })) {
      await writeFile(path.join(root, "docker/napier-sandbox", fileName), content);
    }
    const release = '{"kind":"napier.sandbox-external-publication"}\n';
    await writeFile(
      path.join(
        root,
        "docs/artifacts/sandbox-external-publication-0.1.0.json",
      ),
      release,
    );
    const destination = path.join(
      root,
      "packages/runtime/dist/sandbox-image/external-publication.json",
    );
    await writeFile(destination, "stale\n");

    await copySandboxImageAsset(root);
    await expect(readFile(destination, "utf8")).resolves.toBe(release);

    await rm(
      path.join(
        root,
        "docs/artifacts/sandbox-external-publication-0.1.0.json",
      ),
    );
    await copySandboxImageAsset(root);
    await expect(readFile(destination, "utf8")).rejects.toThrow();
  });
});
