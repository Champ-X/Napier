import { performance } from "node:perf_hooks";

import type {
  StorePersistenceMetrics,
  StorePersistenceSample,
} from "@napier/contracts";

export interface StorePersistenceObservation {
  status: StorePersistenceSample["status"];
  revision: number;
  stateBytes: number;
  eventCount: number;
  eventBytes: number;
  touchedThreadCount: number;
  stateProjectionBytes: number;
  eventProjectionBytes: number;
  serializationDurationMs: number;
  ledgerCommitDurationMs: number;
  projectionDurationMs: number;
  totalDurationMs: number;
  projectionFailureCount: number;
}

export class StorePersistenceMonitor {
  private readonly startedAt = new Date().toISOString();
  private commitCount = 0;
  private failedCommitCount = 0;
  private projectionFailureCount = 0;
  private stateBytesWritten = 0;
  private eventBytesWritten = 0;
  private projectionBytesWritten = 0;
  private maxCommitDurationMs = 0;
  private last: StorePersistenceSample | undefined;

  record(observation: StorePersistenceObservation): void {
    const sample: StorePersistenceSample = {
      ...observation,
      recordedAt: new Date().toISOString(),
      serializationDurationMs: roundDuration(
        observation.serializationDurationMs,
      ),
      ledgerCommitDurationMs: roundDuration(observation.ledgerCommitDurationMs),
      projectionDurationMs: roundDuration(observation.projectionDurationMs),
      totalDurationMs: roundDuration(observation.totalDurationMs),
    };
    this.last = sample;
    this.projectionFailureCount += observation.projectionFailureCount;
    this.maxCommitDurationMs = Math.max(
      this.maxCommitDurationMs,
      sample.ledgerCommitDurationMs,
    );
    if (observation.status === "failed") {
      this.failedCommitCount += 1;
      return;
    }
    this.commitCount += 1;
    this.stateBytesWritten += observation.stateBytes;
    this.eventBytesWritten += observation.eventBytes;
    this.projectionBytesWritten +=
      observation.stateProjectionBytes + observation.eventProjectionBytes;
  }

  snapshot(): StorePersistenceMetrics {
    return {
      schemaVersion: 1,
      startedAt: this.startedAt,
      commitCount: this.commitCount,
      failedCommitCount: this.failedCommitCount,
      projectionFailureCount: this.projectionFailureCount,
      stateBytesWritten: this.stateBytesWritten,
      eventBytesWritten: this.eventBytesWritten,
      projectionBytesWritten: this.projectionBytesWritten,
      maxCommitDurationMs: this.maxCommitDurationMs,
      ...(this.last ? { last: structuredClone(this.last) } : {}),
    };
  }
}

export function monotonicNow(): number {
  return performance.now();
}

function roundDuration(value: number): number {
  return Math.round(Math.max(0, value) * 1_000) / 1_000;
}
