import { describe, expect, it } from "vitest";

import { browserNavigationStrategy } from "../src/browser-navigation-strategy.js";
import { BROWSER_NAVIGATION_TIMEOUT_MS } from "../src/browser-session-model.js";

describe("Browser navigation strategy", () => {
  it("does not wait for DOMContentLoaded on direct raster assets", () => {
    expect(
      browserNavigationStrategy(
        new URL(
          "https://web.archive.org/web/20221021065812id_/https://www.qatar2022.qa/official_poster3.jpg",
        ),
      ),
    ).toEqual({
      directMedia: true,
      timeout: 12_000,
      waitUntil: "commit",
    });
    expect(
      browserNavigationStrategy(
        new URL("https://cdn.example.com/poster%2EPNG?download=1"),
      ),
    ).toEqual({
      directMedia: true,
      timeout: 12_000,
      waitUntil: "commit",
    });
  });

  it("retains document readiness for ordinary pages", () => {
    expect(
      browserNavigationStrategy(new URL("https://example.com/poster")),
    ).toEqual({
      directMedia: false,
      timeout: BROWSER_NAVIGATION_TIMEOUT_MS,
      waitUntil: "domcontentloaded",
    });
  });
});
