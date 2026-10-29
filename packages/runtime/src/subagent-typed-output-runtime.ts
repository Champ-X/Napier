import type {
  JsonValue,
  SubagentTask,
  Usage,
  WorkflowValueSchema,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { prepareSubagentRepair, runSingleResponseRepair, type SubagentRepairPorts } from "./subagent-single-response-repair.js";
import {
  createSubagentTypedOutputRepairPrompt,
  parseSubagentTypedOutput,
  subagentOutputSchemaSha256,
} from "./subagent-output-schema.js";

export interface SubagentTypedOutputResult {
  task: SubagentTask;
  usage: Usage;
  resultText: string;
  output: JsonValue;
}

export async function settleSubagentTypedOutput(input: SubagentRepairPorts & {
  resultText: string;
  outputSchema: WorkflowValueSchema;
}): Promise<SubagentTypedOutputResult> {
  input.modelSession?.lifetime.assertActive();
  input.signal?.throwIfAborted();
  try {
    return {
      task: input.task,
      usage: input.usage,
      resultText: input.resultText,
      output: parseSubagentTypedOutput(input.resultText, input.outputSchema),
    };
  } catch (initialError) {
    if (input.task.turnCount >= input.limits.maxTurns) throw initialError;
    return repairTypedOutput(input, initialError);
  }
}

async function repairTypedOutput(
  input: Parameters<typeof settleSubagentTypedOutput>[0],
  initialError: unknown,
): Promise<SubagentTypedOutputResult> {
  const session = prepareSubagentRepair(input);
  const diagnostic =
    initialError instanceof Error ? initialError.message : String(initialError);
  const schemaSha256 = subagentOutputSchemaSha256(input.outputSchema);
  const prompt = createSubagentTypedOutputRepairPrompt({
    prompt: input.task.prompt,
    resultText: input.resultText,
    diagnostic,
    schema: input.outputSchema,
  });
  const requestContent = {
    kind: "napier.subagent-typed-output-repair-request" as const,
    schemaVersion: 1 as const,
    taskId: input.task.id,
    attempt: 1,
    maxAttempts: 1,
    outputSchemaSha256: schemaSha256,
    predecessorResultSha256: sha256(input.resultText),
    diagnosticSha256: sha256(diagnostic),
    repairPromptSha256: sha256(prompt),
  };
  const request = {
    ...requestContent,
    contentSha256: sha256(canonicalJson(requestContent)),
  };
  await input.emit("subagent.output.repair.requested", input.task, request);
  session.assertActive();
  const { task, usage, resultText, error: messageError } = await runSingleResponseRepair({
    ...input, session, phase: "typed_repair", instructions: "You repair typed JSON output. Never use tools.", prompt,
  });
  let output: JsonValue;
  try {
    if (messageError) throw new Error(messageError);
    output = parseSubagentTypedOutput(resultText, input.outputSchema);
  } catch (error) {
    await input.emit("subagent.output.repair.outcome", task, {
      taskId: task.id,
      status: "rejected",
      attempt: 1,
      maxAttempts: 1,
      requestContentSha256: request.contentSha256,
      outputSchemaSha256: schemaSha256,
      resultSha256: sha256(resultText),
      diagnosticSha256: sha256(
        error instanceof Error ? error.message : String(error),
      ),
    });
    throw error;
  }
  await input.emit("subagent.output.repair.outcome", task, {
    taskId: task.id,
    status: "accepted",
    attempt: 1,
    maxAttempts: 1,
    requestContentSha256: request.contentSha256,
    outputSchemaSha256: schemaSha256,
    resultSha256: sha256(resultText),
    outputSha256: sha256(canonicalJson(output)),
  });
  session.assertActive();
  return { task, usage, resultText, output };
}
