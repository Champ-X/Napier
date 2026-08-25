import {
  cp,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { JsonValue } from "@napier/contracts";
import {
  canonicalJson,
  createLocalAgentRuntime,
  sha256,
  UnsupportedSandboxAdapter,
  type LocalAgentRuntimeOptions,
} from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import {
  runCodingBenchmark,
  type CodingBenchmarkDependencies,
} from "../src/coding-benchmark.js";
import {
  codingBenchmarkAstSha256,
  loadCodingBenchmarkCase,
} from "../src/coding-benchmark-case.js";
import {
  verifyCodingBenchmarkArtifacts,
  type CodingBenchmarkResult,
} from "../src/coding-benchmark-contract.js";

const CASE_ROOT = path.resolve(
  import.meta.dirname,
  "../../../benchmarks/coding/shipping-boundary-v1",
);
const SOURCE_SHA256 =
  "7599d299a32b68c2995a51f11b0b59927d6fa95cf5906075d122463e1012953e";
const EXPECTED_AST_SHA256 =
  "977058b3c7b87f5b64bc18756c0cae8b71adb84263b015e26f37090525c2680d";
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("CLI coding outcome benchmark", () => {
  it("normalizes formatting while preserving semantic AST changes", async () => {
    const expected = await readFile(
      path.join(CASE_ROOT, "expected/src/shipping.js"),
      "utf8",
    );
    const formatted = expected
      .replace("5_000", "5000")
      .replace(
        "if (subtotalCents >= 5000)",
        "if (subtotalCents >= 5000) /* boundary */",
      );
    const regressed = expected.replace(">=", ">");

    expect(codingBenchmarkAstSha256(formatted)).toBe(
      codingBenchmarkAstSha256(expected),
    );
    expect(codingBenchmarkAstSha256(regressed)).not.toBe(
      codingBenchmarkAstSha256(expected),
    );
  });

  it("scores a real Agent edit and emits self-verifying CAS artifacts", async () => {
    const outputDir = await temporaryOutput();
    const containerScratch = path.join(outputDir, "container-scratch");
    const provider = fauxProvider({ provider: "faux-coding-benchmark" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("read_file", { path: "src/shipping.js" }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        fauxToolCall("apply_patch", {
          operation: "replace",
          path: "src/shipping.js",
          expectedSha256: SOURCE_SHA256,
          edits: [{ oldText: "> 5_000", newText: ">= 5_000" }],
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Fixed the free-shipping boundary."),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const runtimeWorkspaceRoots: string[] = [];

    const artifacts = await runCodingBenchmark(
      {
        caseRoot: CASE_ROOT,
        outputDir,
        model: { provider: "faux-coding-benchmark", id: "faux-1" },
        env: {
          NAPIER_CONTAINER_SANDBOX_SCRATCH_DIR: containerScratch,
        },
      },
      providerDependencies(provider, async (options) => {
        runtimeWorkspaceRoots.push(await realpath(options.workspaceRoot));
      }),
    );

    expect(artifacts.result).toEqual(
      expect.objectContaining({
        kind: "napier.coding-benchmark-result",
        schemaVersion: 2,
        status: "passed",
        tooling: expect.objectContaining({
          started: 2,
          completed: 2,
          failed: 0,
          blocked: 0,
          repeatedCallCount: 0,
          applyPatchCompleted: true,
        }),
        evaluation: expect.objectContaining({
          status: "passed",
          diagnostics: [],
          targetSemanticMatch: true,
          allowedChangeSetMatch: true,
          changedFileCount: 1,
        }),
      }),
    );
    expect(path.basename(artifacts.resultPath)).toMatch(
      /^napier-benchmark-result-coding_shipping_boundary_v1-[a-f0-9]{16}\.json$/u,
    );
    expect(path.basename(artifacts.ledgerPath)).toMatch(
      /^napier-benchmark-ledger-coding_shipping_boundary_v1-[a-f0-9]{16}\.json$/u,
    );
    const [storedResultText, bundleText] = await Promise.all([
      readFile(artifacts.resultPath, "utf8"),
      readFile(artifacts.ledgerPath, "utf8"),
    ]);
    const storedResult = JSON.parse(storedResultText) as unknown;
    const bundle = JSON.parse(bundleText) as unknown;
    expect(verifyCodingBenchmarkArtifacts(storedResult, bundle)).toEqual(
      expect.objectContaining({ valid: true, diagnostics: [] }),
    );
    expect(bundle).toEqual(
      expect.objectContaining({
        kind: "napier.coding-benchmark-ledger",
        schemaVersion: 2,
        evaluationEvent: expect.objectContaining({
          type: "benchmark.evaluated",
        }),
      }),
    );
    expect(JSON.stringify(storedResult)).not.toContain(outputDir);
    expect(JSON.stringify(bundle)).not.toContain(outputDir);
    expect(bundleText).not.toContain("Fix the boundary bug");
    expect(bundleText).not.toContain("Fixed the free-shipping boundary");
    expect(bundleText).not.toContain("shippingCostCents");
    expect(bundleText).not.toContain("src/shipping.js");
    const canonicalScratch = await realpath(containerScratch);
    expect(runtimeWorkspaceRoots.length).toBeGreaterThan(0);
    expect(
      runtimeWorkspaceRoots.every((root) =>
        root.startsWith(`${canonicalScratch}${path.sep}`),
      ),
    ).toBe(true);
    expect(await readdir(containerScratch)).toEqual([]);
  });

  it("marks a correct edit inconclusive when the outcome Sandbox is unavailable", async () => {
    const outputDir = await temporaryOutput();
    const provider = fauxProvider({ provider: "faux-coding-inconclusive" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("read_file", { path: "src/shipping.js" }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        fauxToolCall("apply_patch", {
          operation: "replace",
          path: "src/shipping.js",
          expectedSha256: SOURCE_SHA256,
          edits: [{ oldText: "> 5_000", newText: ">= 5_000" }],
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Fixed the free-shipping boundary."),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const dependencies = providerDependencies(provider);
    dependencies.runOutcomeTest = async (input) => ({
      testSha256: input.testSha256,
      status: "unavailable",
      sandboxId: "nested-sandbox-unavailable",
      resultSha256: sha256("sandbox unavailable"),
      durationMs: 0,
      exitCode: null,
      stdoutSha256: sha256(""),
      stderrSha256: sha256(""),
      passed: false,
    });

    const artifacts = await runCodingBenchmark(
      {
        caseRoot: CASE_ROOT,
        outputDir,
        model: { provider: "faux-coding-inconclusive", id: "faux-1" },
        env: {},
      },
      dependencies,
    );

    expect(artifacts.result).toEqual(
      expect.objectContaining({
        status: "inconclusive",
        evaluation: expect.objectContaining({
          status: "inconclusive",
          targetSemanticMatch: true,
          allowedChangeSetMatch: true,
          diagnostics: ["outcome_test_unavailable"],
          outcomeTest: expect.objectContaining({
            status: "unavailable",
            passed: false,
          }),
        }),
      }),
    );
    expect(
      verifyCodingBenchmarkArtifacts(
        await readJson(artifacts.resultPath),
        await readJson(artifacts.ledgerPath),
      ),
    ).toEqual(expect.objectContaining({ valid: true, diagnostics: [] }));
  });

  it("rejects outcome evidence bound to another hidden test", async () => {
    const outputDir = await temporaryOutput();
    const provider = fauxProvider({ provider: "faux-coding-oracle-drift" });
    provider.setResponses([
      fauxAssistantMessage("No edit was needed."),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const dependencies = providerDependencies(provider);
    const runOutcomeTest = dependencies.runOutcomeTest!;
    dependencies.runOutcomeTest = async (input) => ({
      ...(await runOutcomeTest(input)),
      testSha256: sha256("different hidden test"),
    });

    await expect(
      runCodingBenchmark(
        {
          caseRoot: CASE_ROOT,
          outputDir,
          model: { provider: "faux-coding-oracle-drift", id: "faux-1" },
          env: {},
        },
        dependencies,
      ),
    ).rejects.toThrow("Coding benchmark outcome test evidence hash mismatch");
  });

  it("records a failed outcome without leaking credentials and rejects tampering", async () => {
    const outputDir = await temporaryOutput();
    const provider = fauxProvider({ provider: "faux-coding-failure" });
    provider.setResponses([
      fauxAssistantMessage("No edit was needed."),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const secret = "PRIVATE_CODING_BENCHMARK_KEY";

    const artifacts = await runCodingBenchmark(
      {
        caseRoot: CASE_ROOT,
        outputDir,
        model: { provider: "faux-coding-failure", id: "faux-1" },
        env: { BENCHMARK_PROVIDER_KEY: secret },
        credentialEnv: "BENCHMARK_PROVIDER_KEY",
      },
      providerDependencies(provider),
    );

    expect(artifacts.result.status).toBe("failed");
    expect(artifacts.result.run.status).toBe("completed");
    expect(artifacts.result.evaluation.diagnostics).toEqual([
      "outcome_test_failed",
      "expected_change_missing",
    ]);
    const [storedResult, bundle] = await Promise.all([
      readJson(artifacts.resultPath),
      readJson(artifacts.ledgerPath),
    ]);
    expect(JSON.stringify(storedResult)).not.toContain(secret);
    expect(JSON.stringify(bundle)).not.toContain(secret);
    const tampered = structuredClone(storedResult) as CodingBenchmarkResult;
    tampered.evaluation.status = "passed";
    expect(verifyCodingBenchmarkArtifacts(tampered, bundle)).toEqual(
      expect.objectContaining({
        valid: false,
        diagnostics: expect.arrayContaining(["result_hash_mismatch"]),
      }),
    );
    const tamperedDistribution = structuredClone(storedResult) as Record<
      string,
      unknown
    >;
    const tamperedTooling = tamperedDistribution["tooling"] as Record<
      string,
      unknown
    >;
    const tamperedOutcomes = tamperedTooling["toolOutcomes"] as Array<
      Record<string, unknown>
    >;
    tamperedOutcomes.push({
      toolName: "read_file",
      started: 0,
      completed: 0,
      failed: 1,
      blocked: 0,
      repeatedCallCount: 0,
    });
    rehashJsonObject(tamperedDistribution);
    expect(
      verifyCodingBenchmarkArtifacts(tamperedDistribution, bundle),
    ).toEqual(
      expect.objectContaining({
        valid: false,
        diagnostics: expect.arrayContaining(["result_shape_invalid"]),
      }),
    );
    expect(verifyCodingBenchmarkArtifacts(storedResult, null)).toEqual(
      expect.objectContaining({
        valid: false,
        diagnostics: expect.arrayContaining(["ledger_bundle_invalid"]),
      }),
    );

    const injectedBundle = structuredClone(bundle) as Record<string, unknown>;
    injectedBundle["prompt"] = "PRIVATE_INJECTED_PROMPT";
    rehashJsonObject(injectedBundle);
    const injectedResult = structuredClone(storedResult) as Record<
      string,
      unknown
    >;
    const injectedLedger = injectedResult["ledger"] as Record<string, unknown>;
    const injectedBundleSha256 = String(injectedBundle["contentSha256"]);
    injectedLedger["bundleSha256"] = injectedBundleSha256;
    injectedLedger["bundleFileName"] =
      `napier-benchmark-ledger-coding_shipping_boundary_v1-${injectedBundleSha256.slice(0, 16)}.json`;
    injectedLedger["bundleBytes"] = Buffer.byteLength(
      `${JSON.stringify(injectedBundle, null, 2)}\n`,
      "utf8",
    );
    rehashJsonObject(injectedResult);
    expect(
      verifyCodingBenchmarkArtifacts(injectedResult, injectedBundle),
    ).toEqual(
      expect.objectContaining({
        valid: false,
        diagnostics: expect.arrayContaining(["ledger_bundle_invalid"]),
      }),
    );
  });

  it("rejects unavailable credentials and symlinked case assets", async () => {
    const outputDir = await temporaryOutput();
    await expect(
      runCodingBenchmark({
        caseRoot: CASE_ROOT,
        outputDir,
        model: { provider: "deepseek", id: "deepseek-v4-flash" },
        env: {},
        credentialEnv: "DEEPSEEK_API_KEY",
      }),
    ).rejects.toThrow(
      "Coding benchmark credential environment variable is unavailable",
    );

    const root = await mkdtemp(path.join(tmpdir(), "napier-coding-case-"));
    temporaryRoots.push(root);
    const copiedCase = path.join(root, "case");
    const outside = path.join(root, "outside.js");
    await Promise.all([
      cp(CASE_ROOT, copiedCase, { recursive: true }),
      writeFile(outside, "export const outside = true;\n", "utf8"),
    ]);
    const expected = path.join(copiedCase, "expected/src/shipping.js");
    await rm(expected);
    await symlink(outside, expected);

    await expect(loadCodingBenchmarkCase(copiedCase)).rejects.toThrow(
      "Coding benchmark case entry is unsafe",
    );
  });

  it("keeps an externally timed-out Run out of scored outcomes", async () => {
    const outputDir = await temporaryOutput();
    const provider = fauxProvider({ provider: "faux-coding-timeout" });
    provider.setResponses([
      fauxAssistantMessage("This response must not be used."),
    ]);
    let runtimeCount = 0;
    const dependencies = providerDependencies(provider, async () => {
      runtimeCount += 1;
      if (runtimeCount === 2) {
        await new Promise((resolve) => setTimeout(resolve, 1_100));
      }
    });

    const artifacts = await runCodingBenchmark(
      {
        caseRoot: CASE_ROOT,
        outputDir,
        model: { provider: "faux-coding-timeout", id: "faux-1" },
        env: {},
        timeoutMs: 1_000,
      },
      dependencies,
    );

    expect(artifacts.result.status).toBe("inconclusive");
    expect(artifacts.result.run.status).toBe("cancelled");
    expect(artifacts.result.evaluation.diagnostics).toEqual(
      expect.arrayContaining(["run_not_completed", "outcome_test_unavailable"]),
    );
    expect(provider.state.callCount).toBe(0);
  }, 10_000);
});

function providerDependencies(
  provider: ReturnType<typeof fauxProvider>,
  beforeCreate?: (options: LocalAgentRuntimeOptions) => Promise<void>,
): CodingBenchmarkDependencies {
  return {
    now: () => new Date("2026-07-30T00:00:00.000Z"),
    async runOutcomeTest(input) {
      const source = await readFile(
        path.join(input.workspaceRoot, "src/shipping.js"),
        "utf8",
      );
      const passed =
        !input.signal?.aborted &&
        codingBenchmarkAstSha256(source) === EXPECTED_AST_SHA256;
      const status = input.signal?.aborted
        ? ("cancelled" as const)
        : passed
          ? ("succeeded" as const)
          : ("failed" as const);
      return {
        testSha256: input.testSha256,
        status,
        sandboxId: "coding-benchmark-test",
        resultSha256: sha256(
          canonicalJson({ testSha256: input.testSha256, status }),
        ),
        durationMs: 0,
        exitCode: status === "succeeded" ? 0 : status === "failed" ? 1 : null,
        stdoutSha256: sha256(""),
        stderrSha256: sha256(""),
        passed,
      };
    },
    async createRuntime(options: LocalAgentRuntimeOptions) {
      await beforeCreate?.(options);
      const services = await createLocalAgentRuntime({
        ...options,
        sandbox: new UnsupportedSandboxAdapter("coding-benchmark-test"),
      });
      services.models.registerProvider(provider.provider);
      return services;
    },
  };
}

async function temporaryOutput(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-coding-output-"));
  temporaryRoots.push(root);
  return root;
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function rehashJsonObject(value: Record<string, unknown>): void {
  delete value["contentSha256"];
  value["contentSha256"] = sha256(canonicalJson(value as JsonValue));
}
