import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelRouteRequest } from "@napier/contracts/model-route";
import type { RunRecord } from "@napier/contracts";

import type { EventSink } from "./event-sink.js";
import type { ModelRouteSession, ModelRouter } from "./model-route.js";

export function createAgentRunModelRoute(
  router: ModelRouter,
  input: {
    run: RunRecord;
    model: Model<Api> | undefined;
    request?: ModelRouteRequest;
    onEvent?: EventSink;
  },
): Promise<ModelRouteSession | undefined> {
  if (!input.model) return Promise.resolve(undefined);
  return router.createSession({
    run: input.run,
    primary: input.model,
    ...(input.request ? { request: input.request } : {}),
    ...(input.onEvent ? { onEvent: input.onEvent } : {}),
  });
}
