import type {
  SubagentTask,
  Usage,
} from "@napier/contracts";

import { prepareSubagentRepair, runSingleResponseRepair, type SubagentRepairPorts } from "./subagent-single-response-repair.js";
import {
  createSubagentOutcomeRepairRequest,
  MAX_SUBAGENT_OUTCOME_REPAIR_ATTEMPTS,
  type SubagentOutcomeRepairRequest,
} from "./subagent-outcome-repair.js";

export interface SubagentOutcomeRepairRuntimeResult {
  task: SubagentTask;
  usage: Usage;
  request: SubagentOutcomeRepairRequest;
  resultText: string;
  error?: string;
}

export async function runSubagentOutcomeRepair(input: SubagentRepairPorts & {
  predecessorResult: string;
  diagnostic: string;
}): Promise<SubagentOutcomeRepairRuntimeResult> {
  const session = prepareSubagentRepair(input);
  const request = createSubagentOutcomeRepairRequest({
    taskId: input.task.id,
    role: input.task.role,
    model: input.task.model,
    taskPrompt: input.task.prompt,
    predecessorResult: input.predecessorResult,
    diagnostic: input.diagnostic,
    attempt: 1,
    maxAttempts: MAX_SUBAGENT_OUTCOME_REPAIR_ATTEMPTS,
  });
  await input.emit(
    "subagent.outcome.repair.requested",
    input.task,
    request.payload,
  );
  session.assertActive();
  const response = await runSingleResponseRepair({
    ...input, session, phase: "outcome_repair", instructions: request.instructions, prompt: request.prompt,
  });
  session.assertActive();
  return { ...response, request };
}
