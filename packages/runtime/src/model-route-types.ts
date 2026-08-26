import type {
  Api,
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

export interface ResolvedRouteCandidate {
  descriptor: ModelRouteCandidate;
  model: Model<Api>;
  streamOptions: ModelRouteAttemptContext["streamOptions"];
}
