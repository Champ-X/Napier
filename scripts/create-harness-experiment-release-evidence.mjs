#!/usr/bin/env node

import { PassThrough } from "node:stream";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";

import { AgentRuntime } from "../packages/runtime/dist/agent-runtime.js";
import { canonicalJson, sha256 } from "../packages/runtime/dist/ed25519.js";
import {
  createHarnessExperiment,
  createModelHarnessExperimentProfile,
  createHarnessExperimentReleaseEvidence,
  executeHarnessExperiment,
  validateHarnessExperimentReleaseEvidence,
} from "../packages/harness-eval/dist/harness-experiments.js";
import { ModelRegistry } from "../packages/runtime/dist/models.js";
import { LocalStore } from "../packages/runtime/dist/store.js";
import { createReleaseProductSourceManifest } from "./release-product-source-manifest.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const outputPath = path.join(
  repoRoot,
  "docs/artifacts/harness-experiment-release-evidence-0.1.3.json",
);
const caseInputs = new Map(
  Array.from({ length: 30 }, (_, index) => {
    const id = `case_${String(index + 1)}`;
    return [id, `Execute deterministic Harness release case ${id}.`];
  }),
);

const verifyIndex = process.argv.indexOf("--verify");
if (verifyIndex >= 0) {
  const target = path.resolve(
    repoRoot,
    process.argv[verifyIndex + 1] ?? path.relative(repoRoot, outputPath),
  );
  const evidence = validateHarnessExperimentReleaseEvidence(
    JSON.parse(await readFile(target, "utf8")),
  );
  process.stdout.write(
    `${JSON.stringify({ valid: true, promotionReady: evidence.promotionReady, contentSha256: evidence.contentSha256 })}\n`,
  );
} else {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "napier-harness-release-"),
  );
  try {
    const sourceManifest = await createReleaseProductSourceManifest();
    const experiment = createHarnessExperiment({
      id: "agent_harness_release_v1",
      baselineProfile: createModelHarnessExperimentProfile({
        id: "harness-v0",
        maxActiveTools: 20,
      }),
      candidateProfile: createModelHarnessExperimentProfile({
        id: "harness-v1",
        maxActiveTools: 12,
      }),
      cases: [...caseInputs].map(([id, text], index) => ({
        id,
        inputSha256: sha256(text),
        tags: [index < 15 ? "research" : "coding"],
      })),
      modelRouteLock: {
        role: "default",
        servingModel: { provider: "fixture", id: "fixed" },
        fallbackSamples: "separate_stratum",
      },
      seeds: [11, 22, 33],
      primaryMetrics: ["task_success", "tool_schema_tokens"],
      guardrailMetrics: ["intervention_count", "evidence_completeness"],
    });
    const configurationSha256 = sha256(
      canonicalJson({
        baselineProfileSha256: experiment.baselineProfile.contentSha256,
        candidateProfileSha256: experiment.candidateProfile.contentSha256,
        caseSetDigest: experiment.caseSetDigest,
        modelRouteLock: experiment.modelRouteLock,
        seeds: experiment.seeds,
      }),
    );
    const executions = [];
    for (let round = 0; round < 2; round += 1) {
      executions.push(
        await runExecution(
          temporaryRoot,
          experiment,
          `round-${String(round + 1)}`,
        ),
      );
    }
    const evidence = createHarnessExperimentReleaseEvidence({
      generatedAt: new Date().toISOString(),
      productVersion: sourceManifest.productVersion,
      experiment,
      executions,
      bindings: executions.map((execution) => ({
        executionSha256: execution.contentSha256,
        sourceManifestSha256: sourceManifest.contentSha256,
        configurationSha256,
        credentialClass: "test_fixture",
      })),
    });
    if (!evidence.promotionReady) {
      throw new Error(
        `Harness experiment release evidence is blocked: ${evidence.blockers.join(",")}`,
      );
    }
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(
      outputPath,
      `${JSON.stringify(evidence, null, 2)}\n`,
      "utf8",
    );
    process.stdout.write(
      `${JSON.stringify({ outputPath: path.relative(repoRoot, outputPath), runCount: evidence.executions.reduce((sum, execution) => sum + execution.trials.length, 0), contentSha256: evidence.contentSha256 })}\n`,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function runExecution(root, experiment, round) {
  const workspaceRoot = path.join(root, round, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, round, "data"),
  });
  await store.initialize();
  const provider = fauxProvider({
    provider: "fixture",
    models: [{ id: "fixed" }],
  });
  provider.setResponses(
    Array.from({ length: 360 }, () => fauxAssistantMessage('{"facts":[]}')),
  );
  const models = new ModelRegistry();
  models.registerProvider(provider.provider);
  const runtime = new AgentRuntime(
    store,
    models,
    undefined,
    readinessSandbox(),
  );
  try {
    return await executeHarnessExperiment({
      experiment,
      execute: async (request) => {
        const thread = await store.createThread({
          title: `${round} ${request.case.id} ${String(request.seed)} ${request.arm}`,
          agentId: store.listAgents()[0].id,
        });
        const run = await runtime.runPrompt({
          threadId: thread.id,
          text: caseInputs.get(request.case.id),
          model: request.modelRouteLock.servingModel,
          modelRoute: { role: request.modelRouteLock.role, fallbackModels: [] },
          harnessExperimentProfile: request.profile,
        });
        if (run.status !== "completed") {
          throw new Error(
            `Harness release Run failed: ${run.id}/${run.error ?? "unknown"}`,
          );
        }
        return {
          run,
          events: (await store.listEvents(thread.id)).filter(
            (event) => event.runId === run.id,
          ),
          metrics: { task_success: 1 },
        };
      },
    });
  } finally {
    store.close();
  }
}

function readinessSandbox() {
  return {
    id: "harness-release-evidence",
    async launch(request) {
      if (
        !request.args.some((argument) =>
          argument.includes("napier_shell_probe_v1"),
        )
      ) {
        throw new Error("Harness release fixture cannot launch commands");
      }
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      queueMicrotask(() => {
        stdout.end("napier_shell_probe_v1");
        stderr.end();
      });
      return {
        stdin,
        stdout,
        stderr,
        exit: Promise.resolve({ code: 0, signal: null }),
        terminate: async () => undefined,
      };
    },
  };
}
