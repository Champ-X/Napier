import { describe, expect, it } from "vitest";

import { BrowserLiveViewStreamAdmission } from "../src/browser-live-view-stream-admission.js";

describe("Browser Live stream admission", () => {
  it("allows one stream per Run and releases idempotently", () => {
    const admission = new BrowserLiveViewStreamAdmission();
    const release = admission.claim("thread_live", "run_live");

    expect(() => admission.claim("thread_live", "run_live")).toThrow(
      "already active",
    );
    release();
    release();
    expect(() => admission.claim("thread_live", "run_live")).not.toThrow();
  });

  it("caps global active streams", () => {
    const admission = new BrowserLiveViewStreamAdmission();
    const releases = Array.from({ length: 8 }, (_, index) =>
      admission.claim(`thread_${String(index)}`, `run_${String(index)}`),
    );

    expect(() => admission.claim("thread_overflow", "run_overflow")).toThrow(
      "capacity is unavailable",
    );
    releases[0]!();
    expect(() =>
      admission.claim("thread_replacement", "run_replacement"),
    ).not.toThrow();
  });
});
