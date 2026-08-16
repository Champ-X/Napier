import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { validateKernelPluginManifest } from "../src/kernel-plugin-manifest.js";
import { scaffoldKernelPlugin } from "../src/kernel-plugin-scaffold.js";

const roots: string[] = [];
const execute = promisify(execFile);

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Kernel plugin scaffold", () => {
  it("writes a strict buildable example with a hash-bound receipt", async () => {
    const workspaceRoot = await workspace();

    const receipt = await scaffoldKernelPlugin({
      workspaceRoot,
      id: "plugin.example",
    });

    expect(receipt).toEqual(
      expect.objectContaining({
        kind: "napier.kernel-plugin-scaffold",
        schemaVersion: 1,
        pluginId: "plugin.example",
        version: "0.1.0",
        packageName: "@napier/plugin-example",
        outputPath: path.join("plugins", "example"),
        manifestSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        fileCount: 5,
        fileSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    const root = path.join(workspaceRoot, receipt.outputPath);
    const manifest = validateKernelPluginManifest(
      JSON.parse(await readFile(path.join(root, "napier.plugin.json"), "utf8")),
    );
    expect(manifest).toEqual(
      expect.objectContaining({
        id: "plugin.example",
        version: "0.1.0",
        capabilities: ["projection"],
        permissions: [],
        entries: {
          host: {
            package: "@napier/plugin-example",
            export: "./host",
          },
        },
        contributions: expect.objectContaining({
          projections: ["example.status"],
        }),
      }),
    );
    expect(manifest.contentSha256).toBe(receipt.manifestSha256);
    expect(await readFile(path.join(root, "src", "host.ts"), "utf8")).toContain(
      "satisfies KernelPluginDefinition",
    );
    expect(await readFile(path.join(root, "README.md"), "utf8")).toContain(
      "kernel.plugins.install(plugin)",
    );
    await mkdir(path.join(root, "node_modules", "@napier"), {
      recursive: true,
    });
    const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
    await symlink(
      path.join(repositoryRoot, "packages", "runtime"),
      path.join(root, "node_modules", "@napier", "runtime"),
    );
    await symlink(
      path.join(repositoryRoot, "packages", "contracts"),
      path.join(root, "node_modules", "@napier", "contracts"),
    );
    await execute(
      process.execPath,
      [
        path.join(repositoryRoot, "node_modules", "typescript", "bin", "tsc"),
        "-p",
        path.join(root, "tsconfig.json"),
      ],
      { cwd: root },
    );
    expect(
      await readFile(path.join(root, "dist", "host.js"), "utf8"),
    ).toContain("plugin.example");
  });

  it("rejects invalid IDs, protected/escaping paths, overwrite, and symlink parents", async () => {
    const workspaceRoot = await workspace();
    await expect(
      scaffoldKernelPlugin({ workspaceRoot, id: "invalid" }),
    ).rejects.toThrow("plugin.<name>");
    await expect(
      scaffoldKernelPlugin({
        workspaceRoot,
        id: "plugin.escape",
        outputPath: "../escape",
      }),
    ).rejects.toThrow("escapes");
    await expect(
      scaffoldKernelPlugin({
        workspaceRoot,
        id: "plugin.protected",
        outputPath: ".napier/plugin",
      }),
    ).rejects.toThrow("protected");
    await scaffoldKernelPlugin({ workspaceRoot, id: "plugin.duplicate" });
    await expect(
      scaffoldKernelPlugin({ workspaceRoot, id: "plugin.duplicate" }),
    ).rejects.toThrow("already exists");
    const external = await mkdtemp(path.join(tmpdir(), "napier-plugin-out-"));
    roots.push(external);
    await symlink(external, path.join(workspaceRoot, "linked"));
    await expect(
      scaffoldKernelPlugin({
        workspaceRoot,
        id: "plugin.linked",
        outputPath: "linked/plugin",
      }),
    ).rejects.toThrow("symlink");
  });
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-plugin-scaffold-"));
  roots.push(root);
  await mkdir(root, { recursive: true });
  return root;
}
