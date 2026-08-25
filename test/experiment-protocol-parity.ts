import { readFileSync } from "node:fs";

import { expect } from "vitest";

type RequestValidator = (input: unknown) => unknown;

type ExperimentProtocolValidators = {
  validateCreateAgentMessageExperimentRequest: RequestValidator;
  validateCreateModelInvocationExperimentRequest: RequestValidator;
  validateCreateToolInvocationExperimentRequest: RequestValidator;
};

type ParityCase = {
  input: unknown;
  expected: unknown;
};

type ExperimentProtocolParityFixture = {
  kind: "napier.experiment-protocol-parity-fixture";
  schemaVersion: 1;
  agentMessage: ParityCase;
  modelInvocation: ParityCase;
  toolInvocation: ParityCase;
};

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/experiment-protocol-parity-v1.json", import.meta.url),
    "utf8",
  ),
) as ExperimentProtocolParityFixture;

export function assertExperimentProtocolRequestParity(
  validators: ExperimentProtocolValidators,
): void {
  expect(fixture).toEqual(
    expect.objectContaining({
      kind: "napier.experiment-protocol-parity-fixture",
      schemaVersion: 1,
    }),
  );
  expect(
    validators.validateCreateAgentMessageExperimentRequest(
      fixture.agentMessage.input,
    ),
  ).toStrictEqual(fixture.agentMessage.expected);
  expect(
    validators.validateCreateModelInvocationExperimentRequest(
      fixture.modelInvocation.input,
    ),
  ).toStrictEqual(fixture.modelInvocation.expected);
  expect(
    validators.validateCreateToolInvocationExperimentRequest(
      fixture.toolInvocation.input,
    ),
  ).toStrictEqual(fixture.toolInvocation.expected);
}
