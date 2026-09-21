import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { createLocalAgentRuntime } from "@napier/runtime/agent";
import { afterEach, describe, expect, it } from "vitest";
import { parseCliArgs, runCli, type RunCliDependencies } from "../src/cli.js";
import { loadCliHarnessProfile } from "../src/cli-harness-profile.js";
const candidateBytes = await readFile(
  new URL(
    "../../../benchmarks/harness-profiles/current-integrated.v1.json",
    import.meta.url,
  ),
  "utf8",
);
const candidate = JSON.parse(candidateBytes);
const currentCandidateBytes = await readFile(
  new URL(
    "../../../benchmarks/harness-profiles/current-integrated.v5.json",
    import.meta.url,
  ),
  "utf8",
);
const boundedCandidateBytes = await readFile(
  new URL(
    "../../../benchmarks/harness-profiles/current-integrated.v6.json",
    import.meta.url,
  ),
  "utf8",
);
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Harness policy CLI", () => {
  it.each(["preset", "file", "current-file", "bounded-file"])(
    "executes an explicit %s through the CLI without granting writes",
    async (selection) => {
      const root = await mkdtemp(
        path.join(tmpdir(), "napier-cli-harness-policy-"),
      );
      roots.push(root);
      await mkdir(path.join(root, "workspace"));
      const profileBytes =
        selection === "bounded-file"
          ? boundedCandidateBytes
          : selection === "current-file"
            ? currentCandidateBytes
            : candidateBytes;
      const selectedProfile = JSON.parse(profileBytes);
      await writeFile(path.join(root, "profile.json"), profileBytes);
      const provider = fauxProvider({ provider: "harness-cli" });
      provider.setResponses([
        (context) => {
          expect(
            selection === "preset"
              ? context.systemPrompt
              : JSON.stringify(context.messages),
          ).toContain("napier.task-working-state");
          if (selection === "current-file" || selection === "bounded-file") {
            expect(context.systemPrompt).toContain(
              '<contract_verification_protocol version="contract-staged-v3">',
            );
          }
          expect(context.tools?.map((tool) => tool.name)).not.toContain(
            "apply_patch",
          );
          return fauxAssistantMessage("Read-only Harness boundary inspected.");
        },
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      const stdout = new CaptureWritable();
      const stderr = new CaptureWritable();
      const code = await runCli(
        [
          "run",
          "--workspace",
          path.join(root, "workspace"),
          "--data-root",
          path.join(root, "state"),
          "--prompt",
          "Inspect the boundary.",
          "--model",
          "harness-cli/faux-1",
          "--preset",
          "read_only",
          ...(selection === "preset"
            ? ["--harness-policy", "coding-python.v1"]
            : ["--harness-profile-file", "profile.json"]),
          "--jsonl",
        ],
        { cwd: root, env: {}, stdout, stderr },
        providerDependencies(provider),
      );
      expect(code, stderr.text() + stdout.text()).toBe(0);
      expect(stdout.text()).toContain('"type":"harness.policy.bound"');
      expect(stdout.text()).toContain(
        selection === "preset"
          ? "coding-python.v1"
          : selectedProfile.contentSha256,
      );
    },
  );

  it("parses an explicit Harness strategy independently of the capability preset", () => {
    const base = ["run", "--workspace", ".", "--prompt", "Inspect"];
    const selected = parseCliArgs([
      ...base,
      "--harness-policy",
      "coding-python.v1",
      "--preset",
      "read_only",
    ]);
    expect(selected).toMatchObject({
      kind: "run",
      options: {
        harnessPolicyPreset: "coding-python.v1",
        capabilityPreset: "read_only",
      },
    });
    expect(() =>
      parseCliArgs([...base, "--harness-policy", "full_access"]),
    ).toThrow("--harness-policy must be one of");
    expect(() =>
      parseCliArgs([...base, "--harness-policy", "coding-python.v2"]),
    ).toThrow("--harness-policy must be one of");
    expect(
      parseCliArgs([...base, "--harness-profile-file", "profile.json"]),
    ).toMatchObject({ options: { harnessProfileFile: "profile.json" } });
    expect(() =>
      parseCliArgs([
        ...base,
        "--harness-profile-file",
        "profile.json",
        "--harness-policy",
        "coding-node.v1",
      ]),
    ).toThrow("mutually exclusive");
  });

  it("rejects a tampered profile before requesting a model or creating a thread", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-cli-bad-profile-"));
    roots.push(root);
    await mkdir(path.join(root, "workspace"));
    await writeFile(
      path.join(root, "profile.json"),
      JSON.stringify({ ...candidate, maxActiveTools: 1 }),
    );
    const stdout = new CaptureWritable(),
      stderr = new CaptureWritable();
    let calls = 0;
    const provider = fauxProvider({ provider: "harness-cli" });
    provider.setResponses([
      () => {
        calls++;
        return fauxAssistantMessage("Unexpected call");
      },
    ]);
    const code = await runCli(
      [
        "run",
        "--workspace",
        "workspace",
        "--data-root",
        "state",
        "--prompt",
        "Inspect",
        "--model",
        "harness-cli/faux-1",
        "--harness-profile-file",
        "profile.json",
        "--jsonl",
      ],
      { cwd: root, env: {}, stdout, stderr },
      providerDependencies(provider),
    );
    expect(code).toBe(1);
    expect(calls).toBe(0);
    expect(stdout.text()).not.toContain('"type":"run.started"');
    expect(stdout.text()).toContain("thread_cli_preflight");
  });

  it("bounds file input and respects cancellation", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-cli-profile-input-"),
    );
    roots.push(root);
    const signal = new AbortController().signal;
    await writeFile(path.join(root, "large.json"), " ".repeat(65537));
    await writeFile(path.join(root, "invalid.json"), "{");
    await expect(
      loadCliHarnessProfile("large.json", root, signal),
    ).rejects.toThrow("at most 65536");
    await expect(
      loadCliHarnessProfile("invalid.json", root, signal),
    ).rejects.toThrow();
    await expect(
      loadCliHarnessProfile("missing.json", root, signal),
    ).rejects.toThrow("ENOENT");
    await expect(loadCliHarnessProfile(".", root, signal)).rejects.toThrow(
      "regular JSON file",
    );
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      loadCliHarnessProfile("invalid.json", root, cancelled.signal),
    ).rejects.toThrow();
    // An absent optional profile must leave cancellation to the Run lifecycle,
    // which emits durable cancelled evidence instead of a preflight error.
    await expect(
      loadCliHarnessProfile(undefined, root, cancelled.signal),
    ).resolves.toBeUndefined();
    expect(
      await loadCliHarnessProfile(undefined, root, signal),
    ).toBeUndefined();
  });
});
function providerDependencies(
  provider: ReturnType<typeof fauxProvider>,
): RunCliDependencies {
  return {
    async createRuntime(options) {
      const services = await createLocalAgentRuntime(options);
      services.models.registerProvider(provider.provider);
      return services;
    },
  };
}
class CaptureWritable extends Writable {
  private chunks: string[] = [];
  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: () => void,
  ) {
    this.chunks.push(chunk.toString("utf8"));
    callback();
  }
  text() {
    return this.chunks.join("");
  }
}
