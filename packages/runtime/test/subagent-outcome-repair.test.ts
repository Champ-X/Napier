import { describe, expect, it } from "vitest";

import {
  createSubagentOutcomeRepairOutcome,
  createSubagentOutcomeRepairRequest,
  MAX_SUBAGENT_OUTCOME_REPAIR_ATTEMPTS,
  rebindSubagentOutcomeRepairOutcome,
  rebindSubagentOutcomeRepairRequest,
  validateSubagentOutcomeRepairOutcome,
  validateSubagentOutcomeRepairRequest,
} from "../src/subagent-outcome-repair.js";

const REQUEST_INPUT = {
  taskId: "task_repairfixture",
  role: "reviewer" as const,
  model: { provider: "faux", id: "faux-1" },
  taskPrompt: "Review the workspace boundary.",
  predecessorResult: "Unstructured private candidate.",
  diagnostic: "Subagent result must be one valid JSON object",
  attempt: 1,
  maxAttempts: MAX_SUBAGENT_OUTCOME_REPAIR_ATTEMPTS,
};

describe("Subagent outcome repair receipts", () => {
  it("creates deterministic hash-only repair requests", () => {
    const request = createSubagentOutcomeRepairRequest(REQUEST_INPUT);

    expect(request).toEqual(
      expect.objectContaining({
        instructions: expect.stringContaining("tool-free"),
        prompt: expect.stringContaining(REQUEST_INPUT.predecessorResult),
        payload: expect.objectContaining({
          kind: "napier.subagent-outcome-repair-request",
          schemaVersion: 1,
          taskId: REQUEST_INPUT.taskId,
          role: REQUEST_INPUT.role,
          model: REQUEST_INPUT.model,
          attempt: 1,
          maxAttempts: 1,
          predecessorResultBytes: Buffer.byteLength(
            REQUEST_INPUT.predecessorResult,
            "utf8",
          ),
          taskPromptSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          outcomeInstructionsSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          predecessorResultSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          diagnosticSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          repairInstructionsSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          repairPromptSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    );
    expect(createSubagentOutcomeRepairRequest(REQUEST_INPUT)).toEqual(request);
    expect(validateSubagentOutcomeRepairRequest(request.payload)).toEqual(
      request.payload,
    );
    expect(JSON.stringify(request.payload)).not.toContain(
      REQUEST_INPUT.predecessorResult,
    );
    expect(JSON.stringify(request.payload)).not.toContain(
      REQUEST_INPUT.taskPrompt,
    );
    expect(JSON.stringify(request.payload)).not.toContain(
      REQUEST_INPUT.diagnostic,
    );
  });

  it("binds accepted and rejected repair outcomes to the request", () => {
    const request = createSubagentOutcomeRepairRequest(REQUEST_INPUT);
    const repairedResult = JSON.stringify({
      summary: "The boundary is explicit.",
      items: [],
      unknowns: [],
    });
    const accepted = createSubagentOutcomeRepairOutcome({
      request: request.payload,
      status: "accepted",
      resultText: repairedResult,
      outcomeSha256: "a".repeat(64),
    });
    expect(accepted).toEqual(
      expect.objectContaining({
        kind: "napier.subagent-outcome-repair-outcome",
        status: "accepted",
        requestContentSha256: request.payload.contentSha256,
        resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        outcomeSha256: "a".repeat(64),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(JSON.stringify(accepted)).not.toContain(repairedResult);
    expect(validateSubagentOutcomeRepairOutcome(accepted)).toEqual(accepted);

    const rejected = createSubagentOutcomeRepairOutcome({
      request: request.payload,
      status: "rejected",
      resultText: "Still malformed.",
      diagnostic: "Subagent result must be one valid JSON object",
    });
    expect(rejected).toEqual(
      expect.objectContaining({
        status: "rejected",
        requestContentSha256: request.payload.contentSha256,
        resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        diagnosticSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(rejected).not.toHaveProperty("outcomeSha256");
    expect(JSON.stringify(rejected)).not.toContain("Still malformed.");

    const reboundRequest = rebindSubagentOutcomeRepairRequest(
      request.payload,
      "task_importedrepair",
    );
    const reboundOutcome = rebindSubagentOutcomeRepairOutcome(accepted, {
      taskId: reboundRequest.taskId,
      requestContentSha256: reboundRequest.contentSha256,
      outcomeSha256: "b".repeat(64),
    });
    expect(reboundRequest).toEqual(
      expect.objectContaining({
        taskId: "task_importedrepair",
        predecessorResultSha256: request.payload.predecessorResultSha256,
        contentSha256: expect.not.stringMatching(request.payload.contentSha256),
      }),
    );
    expect(reboundOutcome).toEqual(
      expect.objectContaining({
        taskId: reboundRequest.taskId,
        requestContentSha256: reboundRequest.contentSha256,
        resultSha256: accepted.resultSha256,
        outcomeSha256: "b".repeat(64),
        contentSha256: expect.not.stringMatching(accepted.contentSha256),
      }),
    );
  });

  it("rejects tampered requests and inconsistent outcome states", () => {
    const request = createSubagentOutcomeRepairRequest(REQUEST_INPUT);
    const tampered = {
      ...request.payload,
      predecessorResultBytes: request.payload.predecessorResultBytes + 1,
    };

    expect(() =>
      createSubagentOutcomeRepairOutcome({
        request: tampered,
        status: "error",
        diagnostic: "Provider failed.",
      }),
    ).toThrow("binding is invalid");
    expect(() =>
      createSubagentOutcomeRepairOutcome({
        request: request.payload,
        status: "accepted",
        resultText: "{}",
        diagnostic: "Accepted cannot carry a diagnostic.",
      }),
    ).toThrow("outcome is invalid");
  });
});
