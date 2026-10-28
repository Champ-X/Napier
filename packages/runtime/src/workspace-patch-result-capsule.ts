import type { AgentToolResult } from "@earendil-works/pi-agent-core";

import { canonicalJson } from "./ed25519.js";
import { LocalPrivateCapsuleStore } from "./local-private-capsule-store.js";
import { toolExecutionResultEffectSha256 } from "./tool-execution-result-effect.js";
import {
  normalizeReplayableToolResult,
  type ReplayableToolResult,
} from "./tool-invocation-result-normalization.js";

interface PatchResultCapsule {
  kind: "napier.workspace-patch-result";
  schemaVersion: 1;
  callId: string;
  result: Pick<ReplayableToolResult, "content" | "details">;
  effectSha256: string;
}

/** Addressed by the exact execution-effect digest already in the operation
 * journal. Reading a result confers no execution or tool-replay authority. */
export class WorkspacePatchResultCapsules {
  private readonly store: LocalPrivateCapsuleStore<PatchResultCapsule>;

  constructor(dataRoot: string) {
    this.store = new LocalPrivateCapsuleStore({
      dataRoot,
      directory: "workspace-patch-results",
      label: "Workspace patch result",
      maxObjectBytes: 512 * 1024,
      maxObjects: 512,
      maxStorageBytes: 32 * 1024 * 1024,
      parse: parseCapsule,
      contentSha256: (capsule) => capsule.effectSha256,
    });
  }

  async put(callId: string, result: AgentToolResult<unknown>): Promise<void> {
    const effectSha256 = toolExecutionResultEffectSha256(callId, result, false);
    await this.store.put(
      effectSha256,
      canonicalJson({
        kind: "napier.workspace-patch-result",
        schemaVersion: 1,
        callId,
        result: normalizeReplayableToolResult(result),
        effectSha256,
      }),
    );
  }

  read(effectSha256: string): Promise<PatchResultCapsule> {
    return this.store.read(effectSha256);
  }
}

function parseCapsule(serialized: string): PatchResultCapsule {
  const value = JSON.parse(serialized) as PatchResultCapsule;
  if (
    value.kind !== "napier.workspace-patch-result" ||
    value.schemaVersion !== 1 ||
    Object.keys(value).length !== 5 ||
    typeof value.callId !== "string" ||
    !value.callId ||
    value.callId.length > 256
  )
    throw new Error("Patch result capsule identity is invalid");
  const normalized = normalizeReplayableToolResult(value.result);
  if (
    normalized.usage !== undefined ||
    normalized.addedToolNames !== undefined
  ) {
    throw new Error("Patch result capsule has unexpected execution metadata");
  }
  const result = { content: normalized.content, details: normalized.details };
  if (
    toolExecutionResultEffectSha256(value.callId, result, false) !==
    value.effectSha256
  ) {
    throw new Error("Patch result capsule effect binding is invalid");
  }
  return { ...value, result };
}
