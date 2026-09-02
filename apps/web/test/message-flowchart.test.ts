import { describe, expect, it } from "vitest";

import { parseMessageFlowchart } from "../src/message-flowchart";

describe("message flowchart", () => {
  it("parses and lays out a bounded Mermaid flowchart subset", () => {
    const chart = parseMessageFlowchart(
      [
        "flowchart TD",
        "start(Start) --> gate{Ready?}",
        "gate -.->|retry| start",
        "gate ==> done((Done))",
      ].join("\n"),
    );

    expect(chart?.direction).toBe("TD");
    expect(
      chart?.nodes.map(({ id, label, shape }) => ({ id, label, shape })),
    ).toEqual(
      expect.arrayContaining([
        { id: "start", label: "Start", shape: "round" },
        { id: "gate", label: "Ready?", shape: "diamond" },
        { id: "done", label: "Done", shape: "circle" },
      ]),
    );
    expect(chart?.edges).toEqual([
      { from: "start", to: "gate", tone: "solid" },
      { from: "gate", to: "start", label: "retry", tone: "dashed" },
      { from: "gate", to: "done", tone: "strong" },
    ]);
    expect(chart?.width).toBeGreaterThanOrEqual(320);
    expect(chart?.height).toBeGreaterThanOrEqual(180);
  });

  it("rejects unsupported, executable, and oversized source", () => {
    expect(
      parseMessageFlowchart("sequenceDiagram\nA->>B: hello"),
    ).toBeUndefined();
    expect(
      parseMessageFlowchart("flowchart TD\nA[<script>alert(1)</script>]"),
    ).toBeUndefined();
    expect(
      parseMessageFlowchart(`flowchart TD\nA[${"x".repeat(8_100)}]`),
    ).toBeUndefined();
  });
});
