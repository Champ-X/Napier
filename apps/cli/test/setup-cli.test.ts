import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { createLocalAgentRuntime } from "@napier/runtime";

import { parseCliArgs, runCli } from "../src/cli.js";
import type { CliIo } from "../src/cli-runtime.js";

const roots: string[] = [];
const SECRET = "cli-provider-setup-secret-never-print";

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Napier setup CLI", () => {
  it("parses preview and exact-hash apply options", () => {
    expect(
      parseCliArgs([
        "setup",
        "--workspace",
        ".",
        "--data-root",
        ".napier-test",
        "--jsonl",
      ]),
    ).toEqual({
      kind: "setup",
      options: {
        workspace: ".",
        dataRoot: ".napier-test",
        apply: false,
        jsonl: true,
      },
    });
    expect(
      parseCliArgs([
        "setup",
        "--workspace",
        ".",
        "--provider",
        "DeepSeek",
        "--expected-preview",
        "a".repeat(64),
        "--apply",
      ]),
    ).toEqual({
      kind: "setup",
      options: {
        workspace: ".",
        providerId: "deepseek",
        expectedPreviewSha256: "a".repeat(64),
        apply: true,
        jsonl: false,
      },
    });
    expect(() =>
      parseCliArgs(["setup", "--workspace", ".", "--apply"]),
    ).toThrow("--apply requires --provider and --expected-preview");
    expect(parseCliArgs(["setup", "--help"])).toEqual({ kind: "help" });
  });

  it("previews then explicitly enables the same locator without creating a Thread", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-setup-cli-"));
    roots.push(root);
    const workspace = path.join(root, "workspace");
    const dataRoot = path.join(root, "data");
    await mkdir(workspace);
    const env = { DEEPSEEK_API_KEY: SECRET };
    const baseline = await createLocalAgentRuntime({
      workspaceRoot: workspace,
      dataRoot,
      env,
    });
    const beforeThreads = baseline.store.listThreads();
    const beforeAgent = baseline.store.listAgents()[0]!;
    const beforeRevisionCount =
      baseline.store.listAgentRevisions(beforeAgent.id).length;
    await baseline.shutdown();
    const previewOutput = new CaptureWritable();
    const previewErrors = new CaptureWritable();

    const previewCode = await runCli(
      [
        "setup",
        "--workspace",
        workspace,
        "--data-root",
        dataRoot,
        "--jsonl",
      ],
      cliIo(root, env, previewOutput, previewErrors),
    );

    expect(previewCode).toBe(0);
    expect(previewErrors.text()).toBe("");
    const preview = JSON.parse(previewOutput.text()) as {
      contentSha256: string;
      recommendedProviderId: string;
      candidates: Array<{ environmentVariable: string; status: string }>;
    };
    expect(preview.recommendedProviderId).toBe("deepseek");
    expect(preview.candidates[0]).toEqual(
      expect.objectContaining({
        environmentVariable: "DEEPSEEK_API_KEY",
        status: "available",
      }),
    );
    expect(previewOutput.text()).not.toContain(SECRET);

    const applyOutput = new CaptureWritable();
    const applyErrors = new CaptureWritable();
    const applyCode = await runCli(
      [
        "setup",
        "--workspace",
        workspace,
        "--data-root",
        dataRoot,
        "--provider",
        "deepseek",
        "--expected-preview",
        preview.contentSha256,
        "--apply",
        "--jsonl",
      ],
      cliIo(root, env, applyOutput, applyErrors),
    );

    expect(applyCode).toBe(0);
    expect(applyErrors.text()).toBe("");
    expect(JSON.parse(applyOutput.text())).toEqual(
      expect.objectContaining({
        kind: "napier.provider-setup-result",
        providerId: "deepseek",
        action: "created",
        status: "ready",
      }),
    );
    expect(applyOutput.text()).not.toContain(SECRET);

    const inspection = await createLocalAgentRuntime({
      workspaceRoot: workspace,
      dataRoot,
      env,
    });
    try {
      expect(inspection.store.listThreads()).toEqual(beforeThreads);
      expect(inspection.store.getAgent(beforeAgent.id)).toEqual(beforeAgent);
      expect(
        inspection.store.listAgentRevisions(beforeAgent.id),
      ).toHaveLength(beforeRevisionCount);
      expect(inspection.store.listCredentialReferences()).toEqual([
        expect.objectContaining({
          providerId: "deepseek",
          source: {
            type: "environment",
            variable: "DEEPSEEK_API_KEY",
          },
          status: "active",
          availability: "available",
        }),
      ]);
    } finally {
      await inspection.shutdown();
    }
  });
});

function cliIo(
  cwd: string,
  env: Readonly<Record<string, string | undefined>>,
  stdout: Writable,
  stderr: Writable,
): CliIo {
  return { cwd, env, stdout, stderr };
}

class CaptureWritable extends Writable {
  private readonly chunks: string[] = [];

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(chunk.toString("utf8"));
    callback();
  }

  text(): string {
    return this.chunks.join("");
  }
}
