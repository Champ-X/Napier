import { readFileSync } from "node:fs";

export const CURRENT_HARNESS_CORPUS_REVISION = 1;

/** Retained versions are selected by code, never by caller-provided filesystem paths. */
export function readKnownHarnessCorpus(revision: number = CURRENT_HARNESS_CORPUS_REVISION): unknown {
  if (revision !== 1) throw new Error("Unknown Harness corpus baseline revision");
  return JSON.parse(readFileSync(new URL("../../../benchmarks/harness-corpus-catalog-v1.json", import.meta.url), "utf8"));
}
