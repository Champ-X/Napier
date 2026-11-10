import type { RunEvent, RunRecord } from "@napier/contracts";
import { expect, it } from "vitest";
import {
  findRunByPromptRequestId,
  isPromptRequestId,
  promptRequestFingerprint,
} from "../src/prompt-request-admission.js";

it("validates prompt request identities", () => {
  expect(isPromptRequestId("prompt-abc_1")).toBe(true);
  expect(isPromptRequestId("has spaces")).toBe(false);
});

it("fingerprints prompt content, images and model settings but excludes transport callbacks", () => {
  const input = {
    threadId: "thread_1",
    text: "Request",
    requestId: "request_1",
  };
  const fingerprint = promptRequestFingerprint(input);
  expect(
    promptRequestFingerprint({
      ...input,
      text: " Request ",
      onEvent: () => undefined,
      signal: new AbortController().signal,
    }),
  ).toBe(fingerprint);
  expect(
    promptRequestFingerprint({
      ...input,
      model: { provider: "faux", id: "faux-1" },
    }),
  ).not.toBe(fingerprint);
  expect(
    promptRequestFingerprint({ ...input, sourceContinuityRunId: "run_other" }),
  ).not.toBe(fingerprint);
  expect(
    promptRequestFingerprint({
      ...input,
      images: [{ mimeType: "image/png", data: "AA==" }],
    }),
  ).not.toBe(fingerprint);
});

it("finds the Run admitted under a durable prompt requestId", () => {
  const run = {
    id: "run_1",
    threadId: "thread_1",
    status: "completed",
  } as RunRecord;
  const events = [
    {
      id: "event_1",
      runId: "run_1",
      threadId: "thread_1",
      seq: 1,
      type: "run.started",
      category: "lifecycle",
      visibility: "debug",
      createdAt: "2026-11-04T00:00:00.000Z",
      payload: { requestId: "prompt-same-intent" },
    },
  ] as RunEvent[];
  expect(
    findRunByPromptRequestId([run], events, "prompt-same-intent")?.id,
  ).toBe("run_1");
  expect(
    findRunByPromptRequestId([run], events, "prompt-other"),
  ).toBeUndefined();
});
