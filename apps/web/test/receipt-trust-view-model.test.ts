import { describe, expect, it } from "vitest";

import {
  DISCOVERED_DIRECTORY_MAX_AGE_MS,
  qualifyReceiptTrustAnchorDirectoryDiscoveryRequest,
} from "../src/receipt-trust-view-model";

describe("receipt trust directory discovery ViewModel", () => {
  it("normalizes a qualified source and optional anchor-set pin", () => {
    expect(
      qualifyReceiptTrustAnchorDirectoryDiscoveryRequest(
        "  https://trust.example.test/anchors.json  ",
        "A".repeat(64),
      ),
    ).toEqual({
      sourceUrl: "https://trust.example.test/anchors.json",
      policy: {
        maxAgeMs: DISCOVERED_DIRECTORY_MAX_AGE_MS,
        minimumTrustedCount: 1,
        expectedAnchorSetSha256: "a".repeat(64),
      },
    });
  });

  it("qualifies an unpinned source with the bounded default policy", () => {
    expect(
      qualifyReceiptTrustAnchorDirectoryDiscoveryRequest(
        "https://trust.example.test/anchors.json",
        "",
      ),
    ).toEqual({
      sourceUrl: "https://trust.example.test/anchors.json",
      policy: {
        maxAgeMs: 86_400_000,
        minimumTrustedCount: 1,
      },
    });
  });

  it.each([
    ["http://trust.example.test/anchors.json", ""],
    ["https://user@trust.example.test/anchors.json", ""],
    ["https://trust.example.test/anchors.json?token=secret", ""],
    ["https://trust.example.test/anchors.json#latest", ""],
    ["not-a-url", ""],
    ["https://trust.example.test/anchors.json", "abc"],
  ])("rejects an unsafe or incomplete discovery form", (sourceUrl, pin) => {
    expect(
      qualifyReceiptTrustAnchorDirectoryDiscoveryRequest(sourceUrl, pin),
    ).toBeUndefined();
  });
});
