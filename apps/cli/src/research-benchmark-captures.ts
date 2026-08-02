import type {
  BrowserSessionOwner,
  BrowserSourceCaptureProvider,
} from "@napier/runtime";

import type { ResearchBenchmarkSources } from "./research-benchmark-types.js";

export interface ResearchBenchmarkCaptureProvider extends BrowserSourceCaptureProvider {
  captureCount(): number;
}

export function createResearchBenchmarkCaptureProvider(
  sources: ResearchBenchmarkSources,
): ResearchBenchmarkCaptureProvider {
  let next = 0;
  return {
    captureCount: () => next,
    async capturePage(
      _owner: BrowserSessionOwner,
      maxChars: number,
      signal?: AbortSignal,
    ) {
      signal?.throwIfAborted();
      const source = sources.sources[next];
      if (!source) {
        throw new Error("Research benchmark capture limit exceeded");
      }
      if (source.capture.textChars > maxChars) {
        throw new Error("Research benchmark capture exceeds maxChars");
      }
      next += 1;
      return structuredClone(source.capture);
    },
  };
}
