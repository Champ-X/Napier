import type {
  PromptRequest,
  ResumeRunRequest,
  StreamFrame,
} from "@napier/contracts";

import {
  NapierStreamResponseContractError,
  sha256Text,
} from "./api-error";

const RUN_STREAM_ERROR_MESSAGE = "Run failed while streaming.";
const RUN_STREAM_ERROR_CODE = "run_failed";

export type StreamRunExpectation =
  | {
      kind: "prompt";
      threadId: string;
      model?: PromptRequest["model"];
      capabilityPreset?: PromptRequest["capabilityPreset"];
    }
  | {
      kind: "resume";
      threadId: string;
      runId?: string;
      model?: ResumeRunRequest["model"];
    }
  | {
      kind: "operator_decision";
      threadId: string;
      decisionId: string;
    };

export async function verifyStreamRunResponseContract(
  path: string,
  response: Response,
  expectation: StreamRunExpectation,
): Promise<void> {
  expectHeaderIncludes(path, response, "content-type", "text/event-stream");
  expectHeader(path, response, "cache-control", "no-cache");
  expectHeader(path, response, "x-napier-thread-id", expectation.threadId);
  expectHeader(
    path,
    response,
    expectation.kind === "operator_decision"
      ? "x-napier-operator-decision-id"
      : expectation.kind === "prompt"
        ? "x-napier-prompt-requested"
        : "x-napier-resume-requested",
    expectation.kind === "operator_decision" ? expectation.decisionId : "true",
  );
  if (expectation.kind === "resume") {
    expectOptionalHeader(path, response, "x-napier-run-id", expectation.runId);
  }
  const expectedModel =
    expectation.kind === "operator_decision" ? undefined : expectation.model;
  const expectedPreset =
    expectation.kind === "prompt" ? expectation.capabilityPreset : undefined;
  expectOptionalHeader(
    path,
    response,
    "x-napier-capability-preset",
    expectedPreset,
  );
  expectOptionalHeader(
    path,
    response,
    "x-napier-model-provider",
    expectedModel?.provider,
  );
  expectOptionalHeader(path, response, "x-napier-model-id", expectedModel?.id);
  expectHeader(
    path,
    response,
    "x-napier-stream-error-code",
    RUN_STREAM_ERROR_CODE,
  );
  expectHeader(path, response, "x-napier-stream-error-diagnostic", "sha256");
  expectHeader(
    path,
    response,
    "x-napier-stream-error-message-sha256",
    await sha256Text(RUN_STREAM_ERROR_MESSAGE),
  );
}

export function verifyStreamRunPresetEvidence(
  path: string,
  expectation: StreamRunExpectation,
  frame: StreamFrame,
): void {
  if (
    expectation.kind !== "prompt" ||
    frame.type !== "event" ||
    frame.event.type !== "run.started"
  ) {
    return;
  }
  const payload = frame.event.payload;
  const actual =
    payload && !Array.isArray(payload) && typeof payload === "object"
      ? payload["capabilityPreset"]
      : undefined;
  const expected = expectation.capabilityPreset;
  if (actual === expected) return;
  throw new NapierStreamResponseContractError(path, {
    status: 200,
    header: "run.started.capabilityPreset",
    expected: expected ?? "absent",
    ...(typeof actual === "string" ? { actual } : {}),
  });
}

function expectHeader(
  path: string,
  response: Response,
  header: string,
  expected: string,
): void {
  const actual = response.headers.get(header) ?? undefined;
  if (actual !== expected) {
    throw new NapierStreamResponseContractError(path, {
      status: response.status,
      header,
      expected,
      ...(actual !== undefined ? { actual } : {}),
    });
  }
}

function expectOptionalHeader(
  path: string,
  response: Response,
  header: string,
  expected: string | undefined,
): void {
  if (expected === undefined) {
    const actual = response.headers.get(header) ?? undefined;
    if (actual !== undefined) {
      throw new NapierStreamResponseContractError(path, {
        status: response.status,
        header,
        expected: "absent",
        actual,
      });
    }
    return;
  }
  expectHeader(path, response, header, expected);
}

function expectHeaderIncludes(
  path: string,
  response: Response,
  header: string,
  expected: string,
): void {
  const actual = response.headers.get(header) ?? undefined;
  if (!actual?.toLowerCase().includes(expected)) {
    throw new NapierStreamResponseContractError(path, {
      status: response.status,
      header,
      expected,
      ...(actual !== undefined ? { actual } : {}),
    });
  }
}
