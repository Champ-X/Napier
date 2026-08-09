import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type { StreamFrame } from "@napier/contracts";
import {
  createLocalAgentRuntime,
  UnsupportedSandboxAdapter,
  type LocalAgentRuntimeOptions,
} from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { runCli, type RunCliDependencies } from "../src/cli.js";
import { CliPublicError, cliErrorFrame } from "../src/cli-public-error.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("CLI credential recovery", () => {
  it("projects a missing locator without exposing its name", async () => {
    const fixture = await createFixture();
    const stdout = new CaptureWritable();
    const credentialEnv = "PRIVATE_MISSING_PROVIDER_KEY";
    const code = await runCli(
      [
        "run",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--prompt",
        "Do not start.",
        "--model",
        "deepseek/deepseek-v4-flash",
        "--credential-env",
        credentialEnv,
        "--jsonl",
      ],
      {
        cwd: fixture.root,
        env: {},
        stdout,
        stderr: new CaptureWritable(),
      },
    );

    expect(code).toBe(1);
    expect(parseFrames(stdout.text())).toEqual([
      expect.objectContaining({
        type: "error",
        threadId: "thread_cli_preflight",
        code: "run_failed",
        message:
          "Credential environment variable is unavailable. Set the selected --credential-env variable and retry.",
        diagnosticSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    ]);
    expect(stdout.text()).not.toContain(credentialEnv);
  });

  it("projects a conflicting locator without exposing either secret", async () => {
    const fixture = await createFixture();
    const provider = fauxProvider({ provider: "recovery-provider" });
    provider.setResponses([
      fauxAssistantMessage("BOOTSTRAP_OK"),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const dependencies = providerDependencies(provider);
    const firstStdout = new CaptureWritable();
    const firstCode = await runCli(
      runArgs(fixture, "RECOVERY_PROVIDER_KEY"),
      {
        cwd: fixture.root,
        env: { RECOVERY_PROVIDER_KEY: "PRIVATE_FIRST_KEY" },
        stdout: firstStdout,
        stderr: new CaptureWritable(),
      },
      dependencies,
    );
    expect(firstCode).toBe(0);
    const calls = provider.state.callCount;

    const conflictStdout = new CaptureWritable();
    const conflictCode = await runCli(
      runArgs(fixture, "OTHER_RECOVERY_PROVIDER_KEY"),
      {
        cwd: fixture.root,
        env: { OTHER_RECOVERY_PROVIDER_KEY: "PRIVATE_SECOND_KEY" },
        stdout: conflictStdout,
        stderr: new CaptureWritable(),
      },
      dependencies,
    );

    expect(conflictCode).toBe(1);
    expect(provider.state.callCount).toBe(calls);
    expect(parseFrames(conflictStdout.text())).toEqual([
      expect.objectContaining({
        type: "error",
        message:
          "This provider already uses a different active credential reference. Use that locator or update it through setup, then retry.",
      }),
    ]);
    expect(conflictStdout.text()).not.toContain("PRIVATE_FIRST_KEY");
    expect(conflictStdout.text()).not.toContain("PRIVATE_SECOND_KEY");
    expect(conflictStdout.text()).not.toContain("OTHER_RECOVERY_PROVIDER_KEY");
  });

  it("keeps unknown failures generic and hash-only", () => {
    const privateDiagnostic = "PRIVATE_PROVIDER_DIAGNOSTIC";
    const generic = cliErrorFrame(
      "thread_cli_preflight",
      new Error(privateDiagnostic),
    );
    const projected = cliErrorFrame(
      "thread_cli_preflight",
      new CliPublicError("model_unavailable", privateDiagnostic),
    );

    expect(generic.message).toBe("Run failed while streaming.");
    expect(JSON.stringify(generic)).not.toContain(privateDiagnostic);
    expect(projected.message).toContain(
      "Verify the provider/model, then run napier doctor",
    );
    expect(JSON.stringify(projected)).not.toContain(privateDiagnostic);
    expect(projected.diagnosticSha256).toBe(generic.diagnosticSha256);
  });
});

function runArgs(fixture: Fixture, credentialEnv: string): string[] {
  return [
    "run",
    "--workspace",
    fixture.workspaceRoot,
    "--data-root",
    fixture.dataRoot,
    "--prompt",
    "Bootstrap the credential.",
    "--model",
    "recovery-provider/faux-1",
    "--credential-env",
    credentialEnv,
    "--jsonl",
  ];
}

function providerDependencies(
  provider: ReturnType<typeof fauxProvider>,
): RunCliDependencies {
  return {
    async createRuntime(options: LocalAgentRuntimeOptions) {
      const services = await createLocalAgentRuntime({
        ...options,
        sandbox: new UnsupportedSandboxAdapter("cli-credential-recovery"),
      });
      services.models.registerProvider(provider.provider);
      return services;
    },
  };
}

interface Fixture {
  root: string;
  workspaceRoot: string;
  dataRoot: string;
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-cli-recovery-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "state");
  await mkdir(workspaceRoot);
  return { root, workspaceRoot, dataRoot };
}

function parseFrames(output: string): StreamFrame[] {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as StreamFrame);
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
