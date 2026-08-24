import { describe, expect, it } from "vitest";

import {
  motionScrollBehavior,
  prefersReducedMotion,
} from "../src/reduced-motion";

describe("reduced-motion helper", () => {
  it("reports reduced motion when the media query matches", () => {
    expect(prefersReducedMotion(matchMedia(true))).toBe(true);
    expect(prefersReducedMotion(matchMedia(false))).toBe(false);
  });

  it("degrades scroll behavior to auto under reduced motion", () => {
    expect(motionScrollBehavior(matchMedia(true))).toBe("auto");
  });

  it("keeps smooth scroll when reduced motion is not requested", () => {
    expect(motionScrollBehavior(matchMedia(false))).toBe("smooth");
  });

  it("falls back to smooth when detection throws", () => {
    const throwing = () => {
      throw new Error("no matchMedia");
    };
    expect(prefersReducedMotion(throwing)).toBe(false);
    expect(motionScrollBehavior(throwing)).toBe("smooth");
  });

  it("queries the canonical reduced-motion media feature", () => {
    let observed = "";
    motionScrollBehavior((query) => {
      observed = query;
      return { matches: false };
    });
    expect(observed).toBe("(prefers-reduced-motion: reduce)");
  });
});

function matchMedia(matches: boolean) {
  return () => ({ matches });
}
