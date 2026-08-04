import type { Readable, Writable } from "node:stream";

import type {
  LocalAgentRuntimeOptions,
  LocalAgentRuntimeServices,
} from "@napier/runtime";

import type { DoctorProbeDependencies } from "./doctor-probes.js";

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
}
