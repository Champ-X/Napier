import type { JsonValue } from "@napier/contracts";

import { sha256 } from "./ed25519.js";
import {
  decodeRunPlanProgressSnapshot,
  type RunPlanProgressSnapshotV1,
} from "./run-progress-plan-state.js";

export class RunProgressPlanSnapshotAccumulator {
  private readonly snapshots = new Map<string, RunPlanProgressSnapshotV1>();

  ingest(
    planId: string | undefined,
    payload: Record<string, JsonValue> | undefined,
  ): void {
    if (!payload || !("runProgressSnapshot" in payload)) return;
    const snapshot = decodeBoundSnapshot(planId, payload);
    const previous = this.snapshots.get(snapshot.planIdSha256);
    if (previous && snapshot.revision < previous.revision) {
      throw new Error("Run progress Plan snapshot revision regressed");
    }
    if (
      previous &&
      snapshot.revision === previous.revision &&
      snapshot.contentSha256 !== previous.contentSha256
    ) {
      throw new Error("Run progress Plan snapshot revision conflicts");
    }
    this.snapshots.set(snapshot.planIdSha256, snapshot);
  }

  current(): RunPlanProgressSnapshotV1[] {
    return [...this.snapshots.values()].sort((left, right) =>
      left.planIdSha256.localeCompare(right.planIdSha256),
    );
  }
}

function decodeBoundSnapshot(
  planId: string | undefined,
  payload: Record<string, JsonValue>,
): RunPlanProgressSnapshotV1 {
  if (!planId) {
    throw new Error("Run progress Plan snapshot requires planId binding");
  }
  const snapshot = decodeRunPlanProgressSnapshot(
    payload["runProgressSnapshot"],
  );
  if (!snapshot) throw new Error("Run progress Plan snapshot is malformed");
  if (snapshot.planIdSha256 !== sha256(planId)) {
    throw new Error("Run progress Plan snapshot binding mismatch");
  }
  return snapshot;
}
