import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { parseCliArgs, runCli } from "../src/cli.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Plugin scaffold CLI", () => {
  it("parses and writes one JSON receipt plus the example package", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-plugin-cli-"));
    roots.push(root);
    await mkdir(path.join(root, "workspace"));
    expect(
      parseCliArgs([
        "plugins",
        "--workspace",
        "workspace",
        "--scaffold",
        "plugin.reviewer",
        "--output",
        "extensions/reviewer",
        "--package",
        "@acme/napier-reviewer",
        "--display-name",
        "Review Assistant",
        "--jsonl",
      ]),
    ).toEqual({
      kind: "plugins",
      options: {
        operation: "scaffold",
        workspace: "workspace",
        pluginId: "plugin.reviewer",
        outputPath: "extensions/reviewer",
        packageName: "@acme/napier-reviewer",
        displayName: "Review Assistant",
        jsonl: true,
      },
    });
    const stdout = new CaptureWritable();
    const stderr = new CaptureWritable();
    const code = await runCli(
      [
        "plugins",
        "--workspace",
        "workspace",
        "--scaffold",
        "plugin.reviewer",
        "--output",
        "extensions/reviewer",
        "--package",
        "@acme/napier-reviewer",
        "--display-name",
        "Review Assistant",
        "--jsonl",
      ],
      {
        cwd: root,
        env: {},
        stdout,
        stderr,
      },
    );

    expect(code, stderr.text()).toBe(0);
    expect(stderr.text()).toBe("");
    expect(JSON.parse(stdout.text())).toEqual(
      expect.objectContaining({
        pluginId: "plugin.reviewer",
        packageName: "@acme/napier-reviewer",
        outputPath: path.join("extensions", "reviewer"),
        fileCount: 5,
      }),
    );
    expect(
      JSON.parse(
        await readFile(
          path.join(
            root,
            "workspace",
            "extensions",
            "reviewer",
            "napier.plugin.json",
          ),
          "utf8",
        ),
      ),
    ).toEqual(
      expect.objectContaining({
        id: "plugin.reviewer",
        displayName: "Review Assistant",
      }),
    );
  });

  it("fails closed without replacing an existing scaffold", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-plugin-cli-"));
    roots.push(root);
    await mkdir(path.join(root, "workspace"));
    const first = await runCli(
      ["plugins", "--workspace", "workspace", "--scaffold", "plugin.once"],
      io(root),
    );
    expect(first).toBe(0);
    const stdout = new CaptureWritable();
    const stderr = new CaptureWritable();
    const second = await runCli(
      [
        "plugins",
        "--workspace",
        "workspace",
        "--scaffold",
        "plugin.once",
        "--jsonl",
      ],
      { cwd: root, env: {}, stdout, stderr },
    );
    expect(second).toBe(1);
    expect(JSON.parse(stdout.text())).toEqual(
      expect.objectContaining({
        type: "error",
        code: "plugin_scaffold_failed",
        message: expect.stringContaining("already exists"),
      }),
    );
    expect(stderr.text()).toBe("");
  });

  it("persists optional desired state only through exact-preview apply", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-plugin-state-cli-"));
    roots.push(root);
    await mkdir(path.join(root, "workspace"));
    const status = await invoke(root, [
      "plugins",
      "--workspace",
      "workspace",
      "--jsonl",
    ]);
    expect(status.code).toBe(0);
    expect(JSON.parse(status.stdout)).toEqual(
      expect.objectContaining({
        source: "default",
        desiredState: expect.objectContaining({
          plugins: expect.arrayContaining([
            { id: "plugin.browser", version: "1.0.0", enabled: true },
          ]),
        }),
      }),
    );
    const preview = await invoke(root, [
      "plugins",
      "--workspace",
      "workspace",
      "--disable",
      "plugin.browser",
      "--jsonl",
    ]);
    expect(preview.code).toBe(0);
    const previewValue = JSON.parse(preview.stdout) as {
      contentSha256: string;
      nextEnabled: boolean;
    };
    expect(previewValue).toEqual(
      expect.objectContaining({
        pluginId: "plugin.browser",
        currentEnabled: true,
        nextEnabled: false,
      }),
    );
    const applied = await invoke(root, [
      "plugins",
      "--workspace",
      "workspace",
      "--disable",
      "plugin.browser",
      "--expected-preview",
      previewValue.contentSha256,
      "--apply",
      "--jsonl",
    ]);
    expect(applied.code).toBe(0);
    expect(JSON.parse(applied.stdout)).toEqual(
      expect.objectContaining({
        source: "configured",
        desiredState: expect.objectContaining({
          plugins: expect.arrayContaining([
            { id: "plugin.browser", version: "1.0.0", enabled: false },
          ]),
        }),
      }),
    );
    const stale = await invoke(root, [
      "plugins",
      "--workspace",
      "workspace",
      "--disable",
      "plugin.search",
      "--expected-preview",
      previewValue.contentSha256,
      "--apply",
      "--jsonl",
    ]);
    expect(stale.code).toBe(1);
    expect(JSON.parse(stale.stdout)).toEqual(
      expect.objectContaining({
        code: "plugin_state_failed",
        message: expect.stringContaining("stale"),
      }),
    );
    const enablePreview = await invoke(root, [
      "plugins",
      "--workspace",
      "workspace",
      "--enable",
      "plugin.browser",
      "--jsonl",
    ]);
    const enableValue = JSON.parse(enablePreview.stdout) as {
      contentSha256: string;
    };
    const enabled = await invoke(root, [
      "plugins",
      "--workspace",
      "workspace",
      "--enable",
      "plugin.browser",
      "--expected-preview",
      enableValue.contentSha256,
      "--apply",
      "--jsonl",
    ]);
    expect(enabled.code).toBe(0);
    expect(JSON.parse(enabled.stdout)).toEqual(
      expect.objectContaining({
        desiredState: expect.objectContaining({
          plugins: expect.arrayContaining([
            { id: "plugin.browser", version: "1.0.0", enabled: true },
          ]),
        }),
      }),
    );
  });

  it("rejects Artifact mutation and incomplete apply options", () => {
    expect(() =>
      parseCliArgs([
        "plugins",
        "--workspace",
        ".",
        "--disable",
        "plugin.browser",
        "--apply",
      ]),
    ).toThrow("requires both");
    expect(() =>
      parseCliArgs([
        "plugins",
        "--workspace",
        ".",
        "--enable",
        "plugin.search",
        "--disable",
        "plugin.browser",
      ]),
    ).toThrow("mutually exclusive");
  });
});

function io(cwd: string) {
  return {
    cwd,
    env: {},
    stdout: new CaptureWritable(),
    stderr: new CaptureWritable(),
  };
}

class CaptureWritable extends Writable {
  private readonly chunks: Buffer[] = [];

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }

  text(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

async function invoke(root: string, args: string[]) {
  const stdout = new CaptureWritable();
  const stderr = new CaptureWritable();
  const code = await runCli(args, {
    cwd: root,
    env: {},
    stdout,
    stderr,
  });
  return { code, stdout: stdout.text(), stderr: stderr.text() };
}
