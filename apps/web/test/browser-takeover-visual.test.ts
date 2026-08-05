import { describe, expect, it } from "vitest";

import {
  browserTakeoverLiveMatchesSnapshot,
  browserViewportCoordinates,
} from "../src/browser-takeover-visual";

describe("Browser takeover visual controls", () => {
  it("maps rendered pixels into the fixed Browser viewport", () => {
    expect(
      browserViewportCoordinates(
        60,
        70,
        { left: 10, top: 20, width: 100, height: 100 },
        { viewportWidth: 1_280, viewportHeight: 900 },
      ),
    ).toEqual({ x: 640, y: 450 });
    expect(
      browserViewportCoordinates(
        -10,
        999,
        { left: 0, top: 0, width: 100, height: 100 },
        { viewportWidth: 1_280, viewportHeight: 900 },
      ),
    ).toBeUndefined();
    expect(
      browserViewportCoordinates(
        1,
        1,
        { left: 0, top: 0, width: 0, height: 100 },
        { viewportWidth: 1_280, viewportHeight: 900 },
      ),
    ).toBeUndefined();
  });

  it("requires the displayed Live receipt to match the takeover snapshot", () => {
    const shared = {
      sessionIdSha256: "a".repeat(64),
      sessionOperation: 2,
      activeTabId: "tab_1",
      tabCount: 1,
      tabSetSha256: "b".repeat(64),
      currentUrlSha256: "c".repeat(64),
      currentOriginSha256: "d".repeat(64),
      titleSha256: "e".repeat(64),
    };
    expect(
      browserTakeoverLiveMatchesSnapshot(shared as never, shared as never),
    ).toBe(true);
    expect(
      browserTakeoverLiveMatchesSnapshot(
        { ...shared, sessionOperation: 3 } as never,
        shared as never,
      ),
    ).toBe(false);
  });
});
