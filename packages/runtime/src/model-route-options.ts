import type { SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { ModelRouteAttemptContext } from "./model-route-types.js";

export function mergeRouteStreamOptions(
  base: SimpleStreamOptions,
  route: ModelRouteAttemptContext["streamOptions"],
): SimpleStreamOptions {
  const onResponse =
    base.onResponse || route.onResponse
      ? async (
          ...args: Parameters<NonNullable<SimpleStreamOptions["onResponse"]>>
        ) => {
          await base.onResponse?.(...args);
          await route.onResponse?.(...args);
        }
      : undefined;
  return {
    ...base,
    ...route,
    ...(base.headers || route.headers
      ? { headers: { ...base.headers, ...route.headers } }
      : {}),
    ...(base.env || route.env ? { env: { ...base.env, ...route.env } } : {}),
    ...(onResponse ? { onResponse } : {}),
  };
}
