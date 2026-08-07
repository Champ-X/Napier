import { describe, expect, it } from "vitest";

import { runFourStateCapabilityParity } from "./agent-capability-parity-harness.mjs";

describe("Agent capability projection parity", () => {
  it("returns identical immutable CLI, Web and SDK projections for four authentic states on one Store", async () => {
    const receipt = await runFourStateCapabilityParity();
    expect(
      receipt.states.map((state) => [
        state.name,
        state.agentRevision,
        state.driftState,
        state.ownership,
      ]),
    ).toEqual([
      ["stale", 1, "stale", "unknown_legacy"],
      ["current", 2, "current", "recommended"],
      ["custom_unmanaged", 3, "custom_unmanaged", "unmanaged"],
      ["broken", 3, "broken", "unmanaged"],
    ]);
    expect(receipt.states.every((state) => state.entriesDeepEqual)).toBe(true);
    expect(
      receipt.states.every((state) =>
        Object.values(state.reads).every((read) => read.unchanged),
      ),
    ).toBe(true);
    expect(receipt.setupBoundaries.map((setup) => setup.restartCount)).toEqual([
      1, 1, 1, 2,
    ]);
    expect(receipt.cleanup).toEqual({ removed: true });
  }, 30_000);
});
