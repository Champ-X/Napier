import { describe, expect, it } from "vitest";

import { ModelThinkingLoopDetector } from "../src/model-thinking-loop-detector.js";

describe("Model thinking-loop detector", () => {
  it("detects literal repetition and near-paragraph clusters", () => {
    const literal = new ModelThinkingLoopDetector();
    const unit =
      "We should keep analyzing the same general plan without acting. ".repeat(
        12,
      );
    expect(literal.observe(unit.repeat(3), 1)).toEqual(
      expect.objectContaining({
        reason: "literal_repetition",
        attempt: 1,
        repeatedUnitSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );

    const cluster = new ModelThinkingLoopDetector();
    const common = [
      "I will continue reviewing options before taking concrete action.",
      "The implementation strategy remains broad and deliberately unresolved.",
      "More comparison and reconsideration appears useful before execution.",
      "Potential tradeoffs remain abstract because no workspace operation has started.",
      "The discussion continues at a general level without a file or symbol anchor.",
    ].join(" ");
    expect(
      cluster.observe(
        [
          `${common} The first ending discusses amber choices.`,
          `${common.replace("broad", "overall")} The second ending discusses cobalt choices.`,
          `${common} The third ending discusses violet choices.`,
        ].join("\n\n"),
        2,
      ),
    ).toEqual(
      expect.objectContaining({
        reason: "near_paragraph_cluster",
        attempt: 2,
      }),
    );
  });

  it("detects low novelty and overplanning without anchors", () => {
    const novelty = new ModelThinkingLoopDetector();
    expect(
      novelty.observe(
        "consider review think plan maybe approach continue ".repeat(140),
        1,
      ),
    ).toEqual(
      expect.objectContaining({ reason: "low_novelty_without_anchor" }),
    );

    const planning = new ModelThinkingLoopDetector();
    expect(
      planning.observe(
        Array.from(
          { length: 12 },
          (_, index) =>
            `## Step ${String(index + 1)}\nWe should further analyze choices before acting. ${"More planning. ".repeat(8)}`,
        ).join("\n"),
        1,
      ),
    ).toEqual(expect.objectContaining({ reason: "overplanning_headings" }));
  });

  it("does not flag anchored implementation reasoning", () => {
    const detector = new ModelThinkingLoopDetector();
    expect(
      detector.observe(
        [
          "I will edit packages/runtime/src/model-thinking-loop-detector.ts.",
          "The target function is ModelThinkingLoopDetector.observe at line 14.",
          "The current SHA is a".concat("a".repeat(63), "."),
          "Next I will apply the bounded change and run the focused test.",
          "Implementation details remain concrete and tied to this symbol.",
        ]
          .join("\n")
          .repeat(24),
        1,
      ),
    ).toBeUndefined();
  });
});
