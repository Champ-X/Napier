import type {
  Api,
  AssistantMessageEventStream,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { ModelRouteCandidate } from "@napier/contracts/model-route";

export interface ModelRouteAttemptContext {
  descriptor: ModelRouteCandidate;
  streamOptions: Pick<
    SimpleStreamOptions,
    "apiKey" | "headers" | "env" | "onResponse"
  >;
}

export interface ModelRouteStreamInput {
  signal: AbortSignal;
  /** Per invocation cap, including all route retry and fallback dispatches. */
  physicalAttemptLimit?: number;
  invoke(model: Model<Api>, context?: ModelRouteAttemptContext): Promise<AssistantMessageEventStream>;
}

export interface ModelRouteStreamPort {
  stream(input: ModelRouteStreamInput): AssistantMessageEventStream;
}

export interface ResolvedRouteCandidate {
  descriptor: ModelRouteCandidate;
  model: Model<Api>;
  streamOptions: ModelRouteAttemptContext["streamOptions"];
}
