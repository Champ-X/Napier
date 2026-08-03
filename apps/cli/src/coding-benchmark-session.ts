import type { ModelRef } from "@napier/contracts";
import type {
  LocalAgentRuntimeOptions,
  LocalAgentRuntimeServices,
} from "@napier/runtime";

import type { CodingBenchmarkCase } from "./coding-benchmark-contract.js";

const CREDENTIAL_ENV = /^[A-Z_][A-Z0-9_]{0,127}$/u;

export interface CodingBenchmarkRuntimeFactory {
  createRuntime(
    options: LocalAgentRuntimeOptions,
  ): Promise<LocalAgentRuntimeServices>;
}

export function validateCodingBenchmarkCredential(input: {
  env: Readonly<Record<string, string | undefined>>;
  credentialEnv?: string;
}): void {
  if (!input.credentialEnv) return;
  if (!CREDENTIAL_ENV.test(input.credentialEnv)) {
    throw new Error("Coding benchmark credential environment name is invalid");
  }
  if (!input.env[input.credentialEnv]?.trim()) {
    throw new Error(
      "Coding benchmark credential environment variable is unavailable",
    );
  }
}

export async function configureCodingBenchmarkAgent(input: {
  benchmarkCase: CodingBenchmarkCase;
  workspaceRoot: string;
  dataRoot: string;
  model: ModelRef;
  env: Readonly<Record<string, string | undefined>>;
  credentialEnv?: string;
  timeoutMs: number;
  runtimeFactory: CodingBenchmarkRuntimeFactory;
}): Promise<void> {
  const services = await input.runtimeFactory.createRuntime({
    workspaceRoot: input.workspaceRoot,
    dataRoot: input.dataRoot,
    env: input.env,
  });
  try {
    const agent = services.store.getAgent("agent_napier");
    await services.store.updateAgent(agent.id, {
      name: "Napier Coding Benchmark",
      description: "Executes one fixed, deterministically scored coding task.",
      systemPrompt:
        "Complete the fixed coding task using only the enabled workspace tools. Inspect before editing, make the smallest correct change, do not create unrelated files, and never treat your own summary as proof of success. After the required tool evidence and correct minimal edit are complete, stop calling tools and finish immediately with a concise summary.",
      model: input.model,
      thinkingLevel: "low",
      toolPolicy: "workspace",
      enabledTools: input.benchmarkCase.requiredTools,
      enabledSkills: [],
      enabledSubagents: [],
      runLimits: {
        maxTurns: 12,
        maxTotalTokens: 100_000,
        maxCostUsd: 5,
        timeoutMs: Math.max(10_000, input.timeoutMs),
      },
      automaticRecovery: {
        mode: "manual",
        maxAttempts: 1,
        backoffMs: 1_000,
      },
      modelAdvisor: {
        mode: "off",
        enabledRules: [],
        maxCorrectionAttempts: 0,
      },
      toolLoopGuard: {
        enabled: true,
        threshold: 3,
        exemptTools: [],
      },
    });
    if (input.credentialEnv) {
      await services.store.createCredentialReference({
        providerId: input.model.provider,
        label: "Coding benchmark environment reference",
        source: {
          type: "environment",
          variable: input.credentialEnv,
        },
      });
    }
  } finally {
    await services.shutdown();
  }
}
