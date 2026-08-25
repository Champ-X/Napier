import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { writeBenchmarkCasFile } from "./benchmark-artifact-file.js";

interface ContentAddressedArtifact {
  contentSha256: string;
}

interface ArtifactVerification {
  valid: boolean;
  diagnostics: readonly string[];
}

export interface BenchmarkArtifactBinding {
  bundleFileName: string;
  bundleSha256: string;
  bundleBytes: number;
}

export interface BenchmarkWorkspace {
  temporaryRoot: string;
  workspaceRoot: string;
  dataRoot: string;
  defer(cleanup: () => void | Promise<void>): void;
}

export class BenchmarkCampaignRunner {
  readonly #outputDir: string;

  constructor(outputDir: string) {
    this.#outputDir = path.resolve(outputDir);
  }

  async withWorkspace<Result>(
    prefix: string,
    operation: (workspace: BenchmarkWorkspace) => Promise<Result>,
    baseRoot = tmpdir(),
  ): Promise<Result> {
    const temporaryRoot = await mkdtemp(path.join(baseRoot, prefix));
    const workspaceRoot = path.join(temporaryRoot, "workspace");
    const dataRoot = path.join(temporaryRoot, "state");
    const cleanups: Array<() => void | Promise<void>> = [];
    await mkdir(workspaceRoot);
    try {
      return await operation({
        temporaryRoot,
        workspaceRoot,
        dataRoot,
        defer: (cleanup) => cleanups.push(cleanup),
      });
    } finally {
      try {
        for (const cleanup of cleanups.reverse()) await cleanup();
      } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
    }
  }

  async persistArtifacts<
    Bundle extends ContentAddressedArtifact,
    Result extends ContentAddressedArtifact,
  >(input: {
    bundle: Bundle;
    ledgerFileName: string;
    createResult(binding: BenchmarkArtifactBinding): Result;
    resultFileName(result: Result): string;
    verify(result: Result, bundle: Bundle): ArtifactVerification;
    verificationError: string;
  }): Promise<{
    result: Result;
    bundle: Bundle;
    resultPath: string;
    ledgerPath: string;
  }> {
    const serializedBundle = `${JSON.stringify(input.bundle, null, 2)}\n`;
    const ledgerPath = path.join(this.#outputDir, input.ledgerFileName);
    await writeBenchmarkCasFile(ledgerPath, serializedBundle);
    const result = input.createResult({
      bundleFileName: input.ledgerFileName,
      bundleSha256: input.bundle.contentSha256,
      bundleBytes: Buffer.byteLength(serializedBundle, "utf8"),
    });
    const resultPath = path.join(this.#outputDir, input.resultFileName(result));
    await writeBenchmarkCasFile(
      resultPath,
      `${JSON.stringify(result, null, 2)}\n`,
    );
    const verification = input.verify(result, input.bundle);
    if (!verification.valid) {
      throw new Error(
        `${input.verificationError}: ${verification.diagnostics.join(",")}`,
      );
    }
    return { result, bundle: input.bundle, resultPath, ledgerPath };
  }

  async runTrials<Trial>(input: {
    trialCount: number;
    minimum: number;
    maximum: number;
    invalidCountMessage: string;
    beforeTrial?: () => void;
    runTrial(): Promise<Trial>;
    shouldStop?: () => boolean;
  }): Promise<Trial[]> {
    if (
      !Number.isSafeInteger(input.trialCount) ||
      input.trialCount < input.minimum ||
      input.trialCount > input.maximum
    ) {
      throw new Error(input.invalidCountMessage);
    }
    const trials: Trial[] = [];
    for (let index = 0; index < input.trialCount; index += 1) {
      input.beforeTrial?.();
      trials.push(await input.runTrial());
      if (input.shouldStop?.()) break;
    }
    return trials;
  }
}
