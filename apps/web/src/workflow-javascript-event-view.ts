export function workflowJavascriptEventTraceParts(
  payload: Record<string, unknown>,
): string[] | undefined {
  const nodeId = resourceId(payload["nodeId"]);
  const attempt = boundedInteger(payload["attempt"], 1, 3);
  const cellCount = boundedInteger(payload["cellCount"], 1, 8);
  const durationMs = boundedInteger(payload["durationMs"], 0, 120_000);
  const outputBytes = boundedInteger(payload["outputBytes"], 0, 32 * 1024);
  const configurationSha256 = hash(payload["javascriptConfigurationSha256"]);
  const workerSha256 = hash(payload["workerSha256"]);
  const inputSha256 = hash(payload["inputSha256"]);
  const inputBindingRequestSha256 = hash(payload["inputBindingRequestSha256"]);
  const inputBindingResultSha256 = hash(payload["inputBindingResultSha256"]);
  const cellRequestSetSha256 = hash(payload["cellRequestSetSha256"]);
  const cellResultSetSha256 = hash(payload["cellResultSetSha256"]);
  const outputSha256 = hash(payload["outputSha256"]);
  const outputSchemaSha256 = hash(payload["outputSchemaSha256"]);
  if (
    !nodeId ||
    attempt === undefined ||
    cellCount === undefined ||
    durationMs === undefined ||
    outputBytes === undefined ||
    !configurationSha256 ||
    !workerSha256 ||
    !inputSha256 ||
    !inputBindingRequestSha256 ||
    !inputBindingResultSha256 ||
    !cellRequestSetSha256 ||
    !cellResultSetSha256 ||
    !outputSha256 ||
    !outputSchemaSha256
  ) {
    return undefined;
  }
  return [
    `node ${nodeId}`,
    `attempt ${String(attempt)}`,
    `cells ${String(cellCount)}`,
    `duration ${String(durationMs)}ms`,
    `input ${inputSha256.slice(0, 12)}`,
    `output ${outputSha256.slice(0, 12)}`,
    `bytes ${String(outputBytes)}`,
    `configuration ${configurationSha256.slice(0, 12)}`,
    `worker ${workerSha256.slice(0, 12)}`,
    `requests ${cellRequestSetSha256.slice(0, 12)}`,
    `results ${cellResultSetSha256.slice(0, 12)}`,
  ];
}

function resourceId(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-z][a-z0-9_-]{0,63}$/u.test(value)
    ? value
    : undefined;
}

function hash(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
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
