import { EXECUTION_PLAN_WORKFLOW_REDUCE_OPERATIONS } from "@napier/contracts";

const WORKFLOW_REDUCE_OPERATIONS = new Set<string>(
  EXECUTION_PLAN_WORKFLOW_REDUCE_OPERATIONS,
);

export function workflowReduceEventTraceParts(
  payload: Record<string, unknown>,
): string[] | undefined {
  const nodeIdValue = nodeId(payload["nodeId"]);
  const attempt = boundedInteger(payload["attempt"], 1, 3);
  const operation = safeToken(payload["operation"]);
  const reduceConfigurationSha256 = hash(payload["reduceConfigurationSha256"]);
  const inputSha256 = hash(payload["inputSha256"]);
  const itemCount = boundedInteger(payload["itemCount"], 0, 256);
  const itemSetSha256 = hash(payload["itemSetSha256"]);
  const valueSetSha256 = hash(payload["valueSetSha256"]);
  const outputSha256 = hash(payload["outputSha256"]);
  const outputSchemaSha256 = hash(payload["outputSchemaSha256"]);
  const outputBytes = boundedInteger(payload["outputBytes"], 0, 32 * 1024);
  if (
    !nodeIdValue ||
    attempt === undefined ||
    !operation ||
    !WORKFLOW_REDUCE_OPERATIONS.has(operation) ||
    !reduceConfigurationSha256 ||
    !inputSha256 ||
    itemCount === undefined ||
    !itemSetSha256 ||
    !valueSetSha256 ||
    !outputSha256 ||
    !outputSchemaSha256 ||
    outputBytes === undefined
  ) {
    return undefined;
  }
  return [
    `node ${nodeIdValue}`,
    `attempt ${String(attempt)}`,
    `operation ${operation}`,
    `items ${String(itemCount)}`,
    `reduce ${reduceConfigurationSha256.slice(0, 12)}`,
    `input ${inputSha256.slice(0, 12)}`,
    `item-set ${itemSetSha256.slice(0, 12)}`,
    `value-set ${valueSetSha256.slice(0, 12)}`,
    `output ${outputSha256.slice(0, 12)}`,
    `bytes ${String(outputBytes)}`,
    `output-schema ${outputSchemaSha256.slice(0, 12)}`,
  ];
}

function nodeId(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-z][a-z0-9_-]{0,63}$/u.test(value)
    ? value
    : undefined;
}

function safeToken(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(value)
    ? value
    : undefined;
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  return Number.isSafeInteger(value) &&
    Number(value) >= minimum &&
    Number(value) <= maximum
    ? Number(value)
    : undefined;
}

function hash(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
    ? value
    : undefined;
}
