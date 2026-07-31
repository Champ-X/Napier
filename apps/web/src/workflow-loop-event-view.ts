import type { JsonValue } from "@napier/contracts";

const HASH = /^[a-f0-9]{64}$/u;
const NODE_ID = /^[a-z][a-z0-9_-]{0,63}$/u;
const RUN_ID = /^run_[a-z0-9_-]{8,80}$/u;
const SAFE_TOKEN = /^[A-Za-z0-9_.:-]{1,128}$/u;

export function workflowLoopEventTraceParts(
  eventType: string,
  payload: Record<string, JsonValue>,
): string[] | undefined {
  const nodeId = token(payload["nodeId"], NODE_ID);
  const attempt = integer(payload["attempt"], 1, 3);
  const configuration = hash(payload["loopConfigurationSha256"]);
  const input = hash(payload["inputSha256"]);
  if (!nodeId || attempt === undefined || !configuration) return undefined;
  const parts = [
    `node ${nodeId}`,
    `attempt ${String(attempt)}`,
    `loop ${configuration.slice(0, 12)}`,
  ];
  if (eventType === "workflow.loop.checkpoint.reused") {
    const count = integer(payload["reusedIterationCount"], 1, 8);
    const checkpoint = hash(payload["checkpointSha256"]);
    const coordinators = hash(payload["sourceCoordinatorSetSha256"]);
    const output = hash(payload["lastOutputSha256"]);
    if (
      !input ||
      count === undefined ||
      !checkpoint ||
      !coordinators ||
      !output ||
      typeof payload["matched"] !== "boolean"
    ) {
      return undefined;
    }
    return [
      ...parts,
      `reused ${String(count)}`,
      `input ${input.slice(0, 12)}`,
      `output ${output.slice(0, 12)}`,
      `checkpoint ${checkpoint.slice(0, 12)}`,
      payload["matched"] ? "matched" : "continuing",
    ];
  }
  if (eventType === "workflow.loop.completed") {
    const output = hash(payload["outputSha256"]);
    const outputSchema = hash(payload["outputSchemaSha256"]);
    const checkpoint = hash(payload["checkpointSha256"]);
    const runSet = hash(payload["iterationRunSetSha256"]);
    const subject = hash(payload["untilSubjectSha256"]);
    const iterationCount = integer(payload["iterationCount"], 1, 8);
    const reusedCount = integer(payload["reusedIterationCount"], 0, 8);
    const maxIterations = integer(payload["maxIterations"], 1, 8);
    const outputBytes = integer(payload["outputBytes"], 0, 32 * 1024);
    if (
      !input ||
      !output ||
      !outputSchema ||
      !checkpoint ||
      !runSet ||
      !subject ||
      iterationCount === undefined ||
      reusedCount === undefined ||
      maxIterations === undefined ||
      outputBytes === undefined ||
      reusedCount > iterationCount ||
      iterationCount > maxIterations ||
      payload["termination"] !== "condition_matched"
    ) {
      return undefined;
    }
    return [
      ...parts,
      `iterations ${String(iterationCount)}/${String(maxIterations)}`,
      `reused ${String(reusedCount)}`,
      `input ${input.slice(0, 12)}`,
      `output ${output.slice(0, 12)}`,
      `bytes ${String(outputBytes)}`,
      `checkpoint ${checkpoint.slice(0, 12)}`,
    ];
  }
  const coordinator = token(payload["coordinatorRunId"], RUN_ID);
  const iterationIndex = integer(payload["iterationIndex"], 0, 7);
  const iterationInput = hash(payload["iterationInputSha256"]);
  if (!coordinator || iterationIndex === undefined || !iterationInput) {
    return undefined;
  }
  parts.push(
    `iteration ${String(iterationIndex + 1)}`,
    `input ${iterationInput.slice(0, 12)}`,
  );
  if (eventType === "workflow.loop.iteration.started") {
    const maxIterations = integer(payload["maxIterations"], 1, 8);
    const outputSchema = hash(payload["outputSchemaSha256"]);
    if (maxIterations === undefined || !outputSchema) return undefined;
    return [...parts, `max ${String(maxIterations)}`];
  }
  if (eventType === "workflow.loop.iteration.completed") {
    const output = hash(payload["outputSha256"]);
    const outputSchema = hash(payload["outputSchemaSha256"]);
    const subject = hash(payload["untilSubjectSha256"]);
    const bytes = integer(payload["outputBytes"], 0, 32 * 1024);
    if (
      !output ||
      !outputSchema ||
      !subject ||
      bytes === undefined ||
      typeof payload["matched"] !== "boolean"
    ) {
      return undefined;
    }
    return [
      ...parts,
      `output ${output.slice(0, 12)}`,
      `bytes ${String(bytes)}`,
      payload["matched"] ? "matched" : "continuing",
    ];
  }
  if (eventType === "workflow.loop.iteration.failed") {
    const error = token(payload["errorCode"], SAFE_TOKEN);
    const diagnostic = hash(payload["diagnosticSha256"]);
    if (!error || !diagnostic) return undefined;
    return [
      ...parts,
      `error ${error}`,
      `diagnostic ${diagnostic.slice(0, 12)}`,
    ];
  }
  return undefined;
}

function hash(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && HASH.test(value) ? value : undefined;
}

function token(
  value: JsonValue | undefined,
  pattern: RegExp,
): string | undefined {
  return typeof value === "string" && pattern.test(value) ? value : undefined;
}

function integer(
  value: JsonValue | undefined,
  minimum: number,
  maximum: number,
): number | undefined {
  return Number.isSafeInteger(value) &&
    Number(value) >= minimum &&
    Number(value) <= maximum
    ? Number(value)
    : undefined;
}
