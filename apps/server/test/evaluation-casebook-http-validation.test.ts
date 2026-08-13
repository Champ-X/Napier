import { describe, expect, it } from "vitest";

import {
  parseCreateEvaluationCasebookRequest,
  parseCurateEvaluationCaseRequest,
  parseExecuteEvaluationCasebookRequest,
  parseRemoveEvaluationCaseRequest,
  parseUpdateEvaluationCasebookRequest,
} from "../src/evaluation-casebook-http-validation.js";

describe("Evaluation Casebook HTTP validation", () => {
  it("parses exact create, update, curate, and remove requests", () => {
    expect(
      parseCreateEvaluationCasebookRequest({
        threadId: "thread_a",
        name: "Regression cases",
        description: "",
        templateId: "release-product-v1",
      }),
    ).toEqual({
      threadId: "thread_a",
      name: "Regression cases",
      description: "",
      templateId: "release-product-v1",
    });
    expect(
      parseUpdateEvaluationCasebookRequest({
        threadId: "thread_a",
        name: "Updated",
      }),
    ).toEqual({ threadId: "thread_a", name: "Updated" });
    expect(
      parseCurateEvaluationCaseRequest({
        threadId: "thread_a",
        evaluationId: "evaluation_a",
        templateCaseId: "coding-verification",
      }),
    ).toEqual({
      threadId: "thread_a",
      evaluationId: "evaluation_a",
      templateCaseId: "coding-verification",
    });
    expect(parseRemoveEvaluationCaseRequest({ threadId: "thread_a" })).toEqual({
      threadId: "thread_a",
    });
  });

  it("parses bounded qualification gates", () => {
    expect(
      parseExecuteEvaluationCasebookRequest({
        threadId: "thread_a",
        model: { provider: "deepseek", id: "deepseek-v4-flash" },
        gate: { minimumAgreementRate: 0.75, allowInconclusive: true },
      }),
    ).toEqual({
      threadId: "thread_a",
      model: { provider: "deepseek", id: "deepseek-v4-flash" },
      gate: { minimumAgreementRate: 0.75, allowInconclusive: true },
    });
  });

  it("rejects extra keys and malformed text or gates", () => {
    expect(
      parseCreateEvaluationCasebookRequest({
        threadId: "thread_a",
        name: "Valid",
        extra: true,
      }),
    ).toBeUndefined();
    expect(
      parseUpdateEvaluationCasebookRequest({
        threadId: " ",
      }),
    ).toBeUndefined();
    expect(
      parseCreateEvaluationCasebookRequest({
        threadId: "thread_a",
        name: "x".repeat(101),
      }),
    ).toBeUndefined();
    expect(
      parseCreateEvaluationCasebookRequest({
        threadId: "thread_a",
        name: "Valid",
        templateId: "unknown-template",
      }),
    ).toBeUndefined();
    expect(
      parseExecuteEvaluationCasebookRequest({
        threadId: "thread_a",
        model: { provider: "deepseek", id: "model" },
        gate: { minimumAgreementRate: 1.01 },
      }),
    ).toBeUndefined();
  });
});
