import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import { qualificationTrialRequest } from "./web-ui-e2e-casebook.mjs";

describe("Web UI Casebook qualification route", () => {
  it("seeds assistant messages with the registered v1 role", async () => {
    const source = await readFile("scripts/web-ui-e2e-casebook.mjs", "utf8");

    expect(source).toContain('payload: { role: "assistant", text }');
    expect(source).not.toContain("payload: { text },");
  });

  it("lets non-POST requests continue without parsing a body", () => {
    const postDataJSON = vi.fn();
    expect(
      qualificationTrialRequest({
        method: () => "GET",
        postDataJSON,
      }),
    ).toBeUndefined();
    expect(postDataJSON).not.toHaveBeenCalled();
  });

  it("accepts an object body for qualification POST requests", () => {
    const body = {
      threadId: "thread_qualification",
      model: { provider: "openai", id: "gpt-4" },
      gate: { minimumAgreementRate: 0.8 },
    };
    expect(
      qualificationTrialRequest({
        method: () => "POST",
        postDataJSON: () => body,
      }),
    ).toBe(body);
  });

  it("fails closed when a qualification POST body is absent", () => {
    expect(() =>
      qualificationTrialRequest({
        method: () => "POST",
        postDataJSON: () => null,
      }),
    ).toThrow("Qualification trial request body is invalid");
  });
});
