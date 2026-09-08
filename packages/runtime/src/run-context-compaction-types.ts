import type {
  Api,
  Context,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { CompiledPromptArtifact } from "./prompt-compiler.js";
import type { TokenMeterRegistry } from "./token-meter-provider.js";

export interface RunContextCompactionInput {
  /** Stable transcript before request-local tool-result pruning. */
  sourceContext: Context;
  prunedContext: Context;
  context: Context;
  model: Model<Api>;
  options: SimpleStreamOptions;
  compiledPrompt: CompiledPromptArtifact;
  tokenMeters: TokenMeterRegistry;
  modelAttempt: number;
  recoveryAttempt: 0 | 1;
}

export interface RunContextCompactionProjection {
  context: Context;
  receiptSha256?: string;
  /** A checkpoint's pinned user intent must survive the final token governor. */
  preserveUserMessages?: boolean;
  /** True only when this recovery request is smaller than the failed request. */
  recoveryReduced: boolean;
}

export interface RunContextCompactionPort {
  project(
    input: RunContextCompactionInput,
  ): Promise<RunContextCompactionProjection>;
}
