import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { BenchmarkCampaignRunner } from "../src/benchmark-campaign-runner.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("BenchmarkCampaignRunner", () => {
  it("isolates and cleans a benchmark workspace", async () => {
    const outputDir = await temporaryRoot();
    const runner = new BenchmarkCampaignRunner(outputDir);
    let observedRoot = "";
    let cleaned = false;

    const result = await runner.withWorkspace(
      "campaign-",
      async ({ temporaryRoot, workspaceRoot, dataRoot, defer }) => {
        observedRoot = temporaryRoot;
        defer(() => {
          cleaned = true;
        });
        await expect(stat(workspaceRoot)).resolves.toMatchObject({});
        expect(dataRoot).toBe(path.join(temporaryRoot, "state"));
        return "complete";
      },
      outputDir,
    );

    expect(result).toBe("complete");
    expect(cleaned).toBe(true);
    await expect(stat(observedRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("runs deferred cleanup in LIFO order after an operation fails", async () => {
    const outputDir = await temporaryRoot();
    const runner = new BenchmarkCampaignRunner(outputDir);
    const cleanups: string[] = [];
    let observedRoot = "";

    await expect(
      runner.withWorkspace(
        "campaign-",
        ({ temporaryRoot, defer }) => {
          observedRoot = temporaryRoot;
          defer(() => cleanups.push("first"));
          defer(() => cleanups.push("second"));
          throw new Error("campaign failed");
        },
        outputDir,
      ),
    ).rejects.toThrow("campaign failed");

    expect(cleanups).toEqual(["second", "first"]);
    await expect(stat(observedRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("persists and verifies a content-addressed artifact pair", async () => {
    const outputDir = await temporaryRoot();
    const runner = new BenchmarkCampaignRunner(outputDir);
    const bundle = { contentSha256: "a".repeat(64), value: 1 };

    const artifacts = await runner.persistArtifacts({
      bundle,
      ledgerFileName: "ledger.json",
      createResult: (binding) => ({
        contentSha256: "b".repeat(64),
        ledger: binding,
      }),
      resultFileName: () => "result.json",
      verify: () => ({ valid: true, diagnostics: [] }),
      verificationError: "Artifacts failed self-verification",
    });

    expect(JSON.parse(await readFile(artifacts.ledgerPath, "utf8"))).toEqual(
      bundle,
    );
    expect(JSON.parse(await readFile(artifacts.resultPath, "utf8"))).toEqual(
      artifacts.result,
    );
    expect(artifacts.result.ledger).toEqual({
      bundleFileName: "ledger.json",
      bundleSha256: bundle.contentSha256,
      bundleBytes: Buffer.byteLength(`${JSON.stringify(bundle, null, 2)}\n`),
    });
  });

  it("preserves artifact verification error semantics", async () => {
    const outputDir = await temporaryRoot();
    const runner = new BenchmarkCampaignRunner(outputDir);

    await expect(
      runner.persistArtifacts({
        bundle: { contentSha256: "a".repeat(64) },
        ledgerFileName: "ledger.json",
        createResult: (ledger) => ({
          contentSha256: "b".repeat(64),
          ledger,
        }),
        resultFileName: () => "result.json",
        verify: () => ({
          valid: false,
          diagnostics: ["result_hash_mismatch", "ledger_binding_mismatch"],
        }),
        verificationError: "Artifacts failed self-verification",
      }),
    ).rejects.toThrow(
      "Artifacts failed self-verification: result_hash_mismatch,ledger_binding_mismatch",
    );
  });

  it("runs bounded trials with the caller's abort policy", async () => {
    const runner = new BenchmarkCampaignRunner(await temporaryRoot());
    let runs = 0;
    const trials = await runner.runTrials({
      trialCount: 4,
      minimum: 2,
      maximum: 10,
      invalidCountMessage: "invalid count",
      runTrial: async () => (runs += 1),
      shouldStop: () => runs === 2,
    });

    expect(trials).toEqual([1, 2]);
    await expect(
      runner.runTrials({
        trialCount: 1,
        minimum: 2,
        maximum: 10,
        invalidCountMessage: "invalid count",
        runTrial: async () => 1,
      }),
    ).rejects.toThrow("invalid count");
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-campaign-runner-"));
  temporaryRoots.push(root);
  return root;
}
