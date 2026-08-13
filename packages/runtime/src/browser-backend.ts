export const BROWSER_BACKEND_IDS = [
  "native_playwright",
  "browser_use_local",
  "browser_use_cloud",
] as const;

export type BrowserBackendId = (typeof BROWSER_BACKEND_IDS)[number];

export const DEFAULT_BROWSER_BACKEND_ID: BrowserBackendId = "native_playwright";

export interface BrowserBackend<TRequest, TObservation, TResult> {
  readonly id: BrowserBackendId;
  run(
    request: TRequest,
    onObservation: (observation: TObservation) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<TResult>;
}

export function isBrowserBackendId(value: string): value is BrowserBackendId {
  return BROWSER_BACKEND_IDS.some((candidate) => candidate === value);
}
