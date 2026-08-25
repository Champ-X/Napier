import type { Readable, Writable } from "node:stream";

import type {
  LocalAgentRuntimeOptions,
  LocalAgentRuntimeServices,
} from "@napier/runtime/agent";

import type { DoctorProbeDependencies } from "./doctor-probes.js";
import type { BrowserRuntimeSetupDependencies } from "./browser-runtime-setup-model.js";
import type { BrowserUseLocalSetupDependencies } from "@napier/runtime/browser";
import type { CliSandboxRuntimeSetupDependencies } from "./sandbox-runtime-setup-model.js";
import type { CliRunReadinessDependencies } from "./cli-run-readiness.js";

export interface CliIo {
  cwd: string;
  env: Readonly<Record<string, string | undefined>>;
  stdin?: Readable;
  stdout: Writable;
  stderr: Writable;
  subscribeInterrupt?(listener: () => void): () => void;
}

export interface RunCliDependencies {
  createRuntime(
    options: LocalAgentRuntimeOptions,
  ): Promise<LocalAgentRuntimeServices>;
  doctor?: DoctorProbeDependencies;
  browserSetup?: BrowserRuntimeSetupDependencies;
  browserUseLocalSetup?: BrowserUseLocalSetupDependencies;
  sandboxSetup?: CliSandboxRuntimeSetupDependencies;
  runReadiness?: CliRunReadinessDependencies;
}
