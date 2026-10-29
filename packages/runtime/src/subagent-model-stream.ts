import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { MutableModels } from "@earendil-works/pi-ai";

import type { ModelRouteSession } from "./model-route.js";
import { mergeRouteStreamOptions } from "./model-route-options.js";
import type { SubagentModelSession } from "./subagent-model-session.js";

export function createSubagentStream(
  models: MutableModels | SubagentModelSession,
  route?: ModelRouteSession,
): StreamFn {
  if ("open" in models) {
    return (model, context, options) => models.open("subagent_turn", model, context, options);
  }
  if (!route) return models.streamSimple.bind(models);
  return (_model, context, options) =>
    route.stream({
      signal: options?.signal ?? new AbortController().signal,
      invoke: async (candidate, attempt) => models.streamSimple(
        candidate, context, attempt ? mergeRouteStreamOptions(options ?? {}, attempt.streamOptions) : options,
      ),
    });
}
