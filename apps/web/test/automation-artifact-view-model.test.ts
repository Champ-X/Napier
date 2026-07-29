import type {
  InboundDeadLetterExport,
  InboundDeadLetterRetryHistory,
} from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  deadLetterExportFilename,
  deadLetterRetryHistoryFilename,
} from "../src/automation-artifact-view-model";

describe("automation artifact view model", () => {
  it("builds safe dead-letter export filenames", () => {
    expect(
      deadLetterExportFilename(
        deadLetterExport(
          "channel:bad/path",
          "abcdef1234567890".padEnd(64, "0"),
        ),
      ),
    ).toBe("napier-dead-letters-channel_bad_path-abcdef123456.json");
  });

  it("builds safe dead-letter retry history filenames", () => {
    expect(
      deadLetterRetryHistoryFilename(
        deadLetterRetryHistory(
          "channel:bad/path",
          "123456abcdef7890".padEnd(64, "0"),
        ),
      ),
    ).toBe(
      "napier-dead-letter-retry-history-channel_bad_path-123456abcdef.json",
    );
  });
});

function deadLetterExport(
  channelId: string,
  contentSha256: string,
): Pick<InboundDeadLetterExport, "channel" | "contentSha256"> {
  return {
    contentSha256,
    channel: { id: channelId } as InboundDeadLetterExport["channel"],
  };
}

function deadLetterRetryHistory(
  channelId: string,
  contentSha256: string,
): Pick<InboundDeadLetterRetryHistory, "channelId" | "contentSha256"> {
  return {
    channelId,
    contentSha256,
  };
}
