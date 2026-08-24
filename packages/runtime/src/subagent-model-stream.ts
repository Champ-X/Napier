import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { MutableModels } from "@earendil-works/pi-ai";

import type { ModelRouteSession } from "./model-route.js";

export function createSubagentStream(
  models: MutableModels,
  route?: ModelRouteSession,
): StreamFn {
  if (!route) return models.streamSimple.bind(models);
  return (_model, context, options) =>
    route.stream({
      signal: options?.signal ?? new AbortController().signal,
      invoke: async (candidate) => models.streamSimple(candidate, context, options),
    });
}
