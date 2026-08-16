import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { canonicalJson, sha256 } from "../src/ed25519.js";
import {
  applyKernelPluginState,
  createKernelPluginDesiredState,
  loadKernelPluginDesiredState,
  previewKernelPluginState,
  validateKernelPluginDesiredState,
} from "../src/kernel-plugin-state.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Kernel plugin desired state", () => {
  it("defaults all built-ins enabled and persists an exact private preview", async () => {
    const root = await temporaryRoot();
    const initial = await loadKernelPluginDesiredState(root);
    expect(initial).toEqual(
      expect.objectContaining({
        source: "default",
        desiredState: expect.objectContaining({
          plugins: [
            { id: "plugin.artifact", version: "1.0.0", enabled: true },
            { id: "plugin.browser", version: "1.0.0", enabled: true },
            { id: "plugin.search", version: "1.0.0", enabled: true },
          ],
        }),
      }),
    );
    const preview = await previewKernelPluginState(
      root,
      "plugin.browser",
      false,
    );
    const applied = await applyKernelPluginState({
      dataRoot: root,
      pluginId: "plugin.browser",
      enabled: false,
      expectedPreviewSha256: preview.contentSha256,
    });

    expect(applied).toEqual(
      expect.objectContaining({
        source: "configured",
        bindingSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        desiredState: expect.objectContaining({
          contentSha256: preview.nextStateSha256,
          plugins: expect.arrayContaining([
            { id: "plugin.browser", version: "1.0.0", enabled: false },
          ]),
        }),
      }),
    );
    const filePath = path.join(root, "kernel-plugins.json");
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    expect(
      validateKernelPluginDesiredState(
        JSON.parse(await readFile(filePath, "utf8")) as unknown,
      ),
    ).toEqual(applied.desiredState);
  });

  it("rejects stale previews and boot-required Artifact mutation", async () => {
    const root = await temporaryRoot();
    const browserPreview = await previewKernelPluginState(
      root,
      "plugin.browser",
      false,
    );
    const searchPreview = await previewKernelPluginState(
      root,
      "plugin.search",
      false,
    );
    await applyKernelPluginState({
      dataRoot: root,
      pluginId: "plugin.search",
      enabled: false,
      expectedPreviewSha256: searchPreview.contentSha256,
    });
    await expect(
      applyKernelPluginState({
        dataRoot: root,
        pluginId: "plugin.browser",
        enabled: false,
        expectedPreviewSha256: browserPreview.contentSha256,
      }),
    ).rejects.toThrow("stale");
    await expect(
      previewKernelPluginState(root, "plugin.artifact", false),
    ).rejects.toThrow("boot-required");
  });

  it("fails closed on catalog, version, required-state, and hash drift", async () => {
    const root = await temporaryRoot();
    const valid = createKernelPluginDesiredState();
    for (const drifted of [
      { ...valid, plugins: valid.plugins.slice(1) },
      {
        ...valid,
        plugins: valid.plugins.map((plugin) =>
          plugin.id === "plugin.search"
            ? { ...plugin, version: "2.0.0" }
            : plugin,
        ),
      },
      {
        ...valid,
        plugins: valid.plugins.map((plugin) =>
          plugin.id === "plugin.artifact"
            ? { ...plugin, enabled: false }
            : plugin,
        ),
      },
      { ...valid, contentSha256: "f".repeat(64) },
    ]) {
      await writeFile(
        path.join(root, "kernel-plugins.json"),
        `${JSON.stringify(rehash(drifted))}\n`,
        { mode: 0o600 },
      );
      if (
        "contentSha256" in drifted &&
        drifted.contentSha256 === "f".repeat(64)
      ) {
        await chmod(path.join(root, "kernel-plugins.json"), 0o600);
      }
      await expect(loadKernelPluginDesiredState(root)).rejects.toThrow();
    }
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-kernel-plugins-"));
  roots.push(root);
  return root;
}

function rehash<T extends { contentSha256: string }>(value: T): T {
  if (value.contentSha256 === "f".repeat(64)) return value;
  const { contentSha256: _contentSha256, ...content } = value;
  return {
    ...value,
    contentSha256: sha256(canonicalJson(content)),
  };
}
