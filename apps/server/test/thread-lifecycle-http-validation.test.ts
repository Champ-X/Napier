import { describe, expect, it } from "vitest";

import {
  normalizeThreadTitle,
  parseCreateThreadRequest,
  parseImportThreadReplayBundleRequest,
  parseSetGoalRequest,
} from "../src/thread-lifecycle-http-validation.js";

describe("Thread lifecycle HTTP validation", () => {
  it("preserves normalized titles and legacy Agent ID syntax", () => {
    expect(normalizeThreadTitle()).toBe("新会话");
    expect(normalizeThreadTitle("  reviewed   thread  ")).toBe(
      "reviewed thread",
    );
    expect(
      parseCreateThreadRequest({
        title: "  reviewed   thread  ",
        agentId: "agent_a_b",
      }),
    ).toEqual({
      title: "reviewed thread",
      agentId: "agent_a_b",
    });
    expect(parseCreateThreadRequest({ unexpected: true })).toBeUndefined();
    expect(
      parseCreateThreadRequest({ agentId: "agent-invalid" }),
    ).toBeUndefined();
  });

  it("accepts only an exact replay bundle wrapper and optional title", () => {
    const bundle = { apiVersion: "napier.thread-replay/v1" };
    expect(
      parseImportThreadReplayBundleRequest({
        bundle,
        title: " Imported ",
      }),
    ).toEqual({ bundle, title: "Imported" });
    expect(
      parseImportThreadReplayBundleRequest({
        bundle,
        extra: true,
      }),
    ).toBeUndefined();
    expect(
      parseImportThreadReplayBundleRequest({ bundle, title: " " }),
    ).toBeUndefined();
  });

  it("keeps Goal bounds character-based and continuation-bounded", () => {
    const objective = "\u76ee".repeat(4_000);
    expect(parseSetGoalRequest({ objective, maxContinuations: 8 })).toEqual({
      objective,
      maxContinuations: 8,
    });
    expect(
      parseSetGoalRequest({ objective: `${objective}\u76ee` }),
    ).toBeUndefined();
    expect(
      parseSetGoalRequest({ objective: "valid", maxContinuations: 9 }),
    ).toBeUndefined();
  });
});
