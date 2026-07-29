import type { RunReplaySnapshot, ThreadReplayBundle } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  runReplaySnapshotFilename,
  threadReplayBundleFilename,
} from "../src/run-replay-view-model";

describe("run replay view model", () => {
  it("builds content-addressed replay snapshot filenames", () => {
    expect(
      runReplaySnapshotFilename(
        replaySnapshot("run:bad/path", "abcdef1234567890".padEnd(64, "0")),
      ),
    ).toBe("napier-run_bad_path-replay-abcdef123456.json");
  });

  it("builds content-addressed thread fixture filenames", () => {
    expect(
      threadReplayBundleFilename(
        threadReplayBundle(
          "thread:bad/path",
          "123456abcdef7890".padEnd(64, "0"),
        ),
      ),
    ).toBe("napier-thread-thread_bad_path-123456abcdef.json");
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

function threadReplayBundle(
  threadId: string,
  contentSha256: string,
): Pick<ThreadReplayBundle, "contentSha256" | "thread"> {
  return {
    contentSha256,
    thread: { id: threadId } as ThreadReplayBundle["thread"],
  };
}
