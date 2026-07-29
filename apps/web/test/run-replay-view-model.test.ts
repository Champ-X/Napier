import type { RunReplaySnapshot } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { runReplaySnapshotFilename } from "../src/run-replay-view-model";

describe("run replay view model", () => {
  it("builds content-addressed replay snapshot filenames", () => {
    expect(
      runReplaySnapshotFilename(
        replaySnapshot("run:bad/path", "abcdef1234567890".padEnd(64, "0")),
      ),
    ).toBe("napier-run_bad_path-replay-abcdef123456.json");
  });
});

function replaySnapshot(
  runId: string,
  contentSha256: string,
): Pick<RunReplaySnapshot, "contentSha256" | "run"> {
  return {
    contentSha256,
    run: { id: runId } as RunReplaySnapshot["run"],
  };
}
