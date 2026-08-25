import { describe, expect, it } from "vitest";

import {
  COMPATIBILITY_METRIC_IDS,
  compatibilityTelemetrySnapshot,
  recordCompatibilityHit,
  resetCompatibilityTelemetryForTest,
} from "../src/compatibility-telemetry.js";

describe("compatibility telemetry", () => {
  it("exposes only fixed metric ids and aggregate counts", () => {
    resetCompatibilityTelemetryForTest();
    recordCompatibilityHit("compat.store.legacy_json_read");
    recordCompatibilityHit("compat.store.legacy_json_read");

    const snapshot = compatibilityTelemetrySnapshot();
    expect(snapshot).toEqual({
      schemaVersion: 1,
      privacy: "fixed_id_count_only",
      metrics: expect.arrayContaining([
        { id: "compat.store.legacy_json_read", count: 2 },
      ]),
    });
    expect(snapshot.metrics.map((metric) => metric.id)).toEqual([
      ...COMPATIBILITY_METRIC_IDS,
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("path");
    expect(JSON.stringify(snapshot)).not.toContain("thread");
    expect(JSON.stringify(snapshot)).not.toContain("token");
  });
});
