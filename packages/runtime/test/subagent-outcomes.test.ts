import { describe, expect, it } from "vitest";

import {
  assertSubagentOutcomeBinding,
  createSubagentOutcome,
  formatSubagentOutcome,
  rebindSubagentOutcome,
  validateSubagentOutcome,
} from "../src/subagent-outcomes.js";

const TASK = {
  taskId: "task_outcome_fixture",
  role: "reviewer" as const,
  model: { provider: "faux", id: "faux-1" },
  prompt: "Review the runtime boundary.",
};

const RESULT = JSON.stringify({
  summary: "The boundary is enforced, with one remaining test gap.",
  items: [
    {
      kind: "risk",
      severity: "warning",
      title: "Missing restart coverage",
      detail: "The terminal receipt should be checked after restart.",
      evidence: [
        {
          path: "packages/runtime/src/store.ts",
          lineStart: 6470,
          lineEnd: 6500,
        },
      ],
    },
  ],
  unknowns: ["External provider retry behavior was not exercised."],
});

describe("Subagent outcomes", () => {
  it("normalizes typed results into hash-bound task receipts", () => {
    const outcome = createSubagentOutcome({
      ...TASK,
      resultText: RESULT,
    });

    expect(outcome).toEqual(
      expect.objectContaining({
        kind: "napier.subagent-outcome",
        schemaVersion: 1,
        taskId: TASK.taskId,
        role: "reviewer",
        model: TASK.model,
        itemCount: 1,
        unknownCount: 1,
        promptSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        instructionsSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        itemSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(validateSubagentOutcome(outcome)).toEqual(outcome);
    expect(
      assertSubagentOutcomeBinding(outcome, {
        id: TASK.taskId,
        role: TASK.role,
        model: TASK.model,
        prompt: TASK.prompt,
      }),
    ).toEqual(outcome);
    expect(formatSubagentOutcome(outcome)).toContain(
      "[warning] Missing restart coverage",
    );
    expect(formatSubagentOutcome(outcome)).toContain(
      "packages/runtime/src/store.ts:6470-6500",
    );
  });

  it("rejects unknown fields, unsafe paths, and incomplete line evidence", () => {
    expect(() =>
      createSubagentOutcome({
        ...TASK,
        resultText: JSON.stringify({
          summary: "Invalid extra field.",
          items: [],
          unknowns: [],
          extra: true,
        }),
      }),
    ).toThrow("unsupported field");
    expect(() =>
      createSubagentOutcome({
        ...TASK,
        resultText: JSON.stringify({
          summary: "Unsafe evidence.",
          items: [
            {
              kind: "finding",
              severity: "info",
              title: "Unsafe path",
              detail: "Absolute paths are not portable.",
              evidence: [{ path: "/tmp/private", lineStart: 1, lineEnd: 1 }],
            },
          ],
          unknowns: [],
        }),
      }),
    ).toThrow("workspace-relative");
    expect(() =>
      createSubagentOutcome({
        ...TASK,
        resultText: JSON.stringify({
          summary: "Incomplete evidence.",
          items: [
            {
              kind: "finding",
              severity: "info",
              title: "Incomplete range",
              detail: "Both line bounds are required.",
              evidence: [{ path: "README.md", lineStart: 1 }],
            },
          ],
          unknowns: [],
        }),
      }),
    ).toThrow("line range is incomplete");
  });

  it("detects tampering and rebinds imported task identities", () => {
    const outcome = createSubagentOutcome({
      ...TASK,
      resultText: RESULT,
    });
    const tampered = structuredClone(outcome);
    tampered.items[0]!.detail = "Tampered";
    expect(() => validateSubagentOutcome(tampered)).toThrow("hash evidence");

    const rebound = rebindSubagentOutcome(outcome, {
      taskId: "task_imported_fixture",
      prompt: TASK.prompt,
    });
    expect(rebound).toEqual(
      expect.objectContaining({
        taskId: "task_imported_fixture",
        resultSha256: outcome.resultSha256,
        itemSetSha256: outcome.itemSetSha256,
        contentSha256: expect.not.stringMatching(outcome.contentSha256),
      }),
    );
    expect(
      assertSubagentOutcomeBinding(rebound, {
        id: "task_imported_fixture",
        role: TASK.role,
        model: TASK.model,
        prompt: TASK.prompt,
      }),
    ).toEqual(rebound);
  });
});
