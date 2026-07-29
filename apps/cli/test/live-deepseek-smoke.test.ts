import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";

import type { StreamFrame } from "@napier/contracts";
import { createLocalAgentRuntime } from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/cli.js";

const describeLive =
  process.env["NAPIER_LIVE_CLI_DEEPSEEK_SMOKE"] === "1"
    ? describe
    : describe.skip;
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describeLive("live DeepSeek CLI smoke", () => {
  it("runs a low-cost real model through the JSONL CLI", async () => {
    const apiKey = process.env["DEEPSEEK_API_KEY"]?.trim();
    if (!apiKey) {
      throw new Error(
        "Set DEEPSEEK_API_KEY before running the live CLI smoke test",
      );
    }
    const modelId =
      process.env["DEEPSEEK_MODEL"]?.trim() || "deepseek-v4-flash";
    const root = await mkdtemp(path.join(tmpdir(), "napier-live-cli-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const dataRoot = path.join(root, "state");
    await mkdir(workspaceRoot);
    const setup = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot,
      env: { DEEPSEEK_API_KEY: apiKey },
    });
    await setup.store.createCredentialReference({
      providerId: "deepseek",
      label: "CLI live smoke env",
      source: { type: "environment", variable: "DEEPSEEK_API_KEY" },
    });
    await setup.shutdown();
    const stdout = new CaptureWritable();
    const stderr = new CaptureWritable();

    const code = await runCli(
      [
        "run",
        "--workspace",
        workspaceRoot,
        "--data-root",
        dataRoot,
        "--prompt",
        "Reply with exactly NAPIER_CLI_LIVE_OK.",
        "--model",
        `deepseek/${modelId}`,
        "--jsonl",
      ],
      {
        cwd: root,
        env: { DEEPSEEK_API_KEY: apiKey },
        stdout,
        stderr,
      },
    );

    expect(code).toBe(0);
    expect(stderr.text()).toBe("");
    const frames = stdout
      .text()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as StreamFrame);
    expect(frames.at(-1)).toEqual(
      expect.objectContaining({ type: "done", status: "completed" }),
    );
    expect(stdout.text()).not.toContain(apiKey);
  }, 60_000);
});

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
