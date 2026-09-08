import type { RunEvent } from "@napier/contracts";
import { canonicalJson, sha256 } from "./ed25519.js";
import {
  contextEvidenceRecord,
  RUN_CONTEXT_COMPACTED_EVENT,
  RUN_CONTEXT_COMPACTION_FAILED_EVENT,
  RUN_CONTEXT_PROJECTED_EVENT,
} from "./run-context-checkpoint.js";

/** Imported Runs get new identities; retain source digests but rebind derived receipt chains. */
export function rebindImportedRunContextCompaction(events: RunEvent[]): void {
  const rebound = new Map<string, string>();
  for (const event of events) {
    const payload = contextEvidenceRecord(event.payload);
    if (event.type === RUN_CONTEXT_COMPACTED_EVENT) {
      payload["parentCheckpointSha256"] = mapped(
        payload["parentCheckpointSha256"],
      );
      payload["summarySha256"] = sha256(canonicalJson(payload["summary"]));
    } else if (event.type === RUN_CONTEXT_PROJECTED_EVENT) {
      payload["checkpointSha256"] = mapped(payload["checkpointSha256"]);
    } else if (
      event.type === "context.projected" &&
      payload["runCompactionReceiptSha256"] !== undefined
    ) {
      payload["runCompactionReceiptSha256"] = mapped(
        payload["runCompactionReceiptSha256"],
      );
    } else if (event.type !== RUN_CONTEXT_COMPACTION_FAILED_EVENT) continue;
    const { contentSha256: previousHash, ...content } = payload;
    const contentSha256 = sha256(canonicalJson(content));
    event.payload = JSON.parse(JSON.stringify({ ...content, contentSha256 }));
    if (typeof previousHash === "string")
      rebound.set(previousHash, contentSha256);
  }

  function mapped(value: unknown): unknown {
    return typeof value === "string" ? (rebound.get(value) ?? value) : value;
  }
}
