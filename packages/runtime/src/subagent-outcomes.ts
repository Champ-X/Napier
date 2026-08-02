import type {
  GroundedSubagentOutcome,
  ModelRef,
  SubagentOutcome,
  SubagentOutcomeEvidence,
  SubagentOutcomeItem,
  SubagentRole,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  buildSubagentOutcome,
  normalizeSubagentModel,
  parseSubagentResult,
} from "./subagent-outcome-model.js";
import { validateSubagentOutcome } from "./subagent-outcome-validation.js";
import { isSubagentRole } from "./subagent-role-instructions.js";
import { readWorkspaceTextEvidence } from "./tools.js";

const RESOURCE_ID = /^[a-z][a-z0-9_]{2,80}$/u;
const MAX_RESULT_BYTES = 64 * 1024;

export {
  subagentOutcomeContractInstructions,
  subagentRoleInstructions,
} from "./subagent-role-instructions.js";
export { verifySubagentOutcomeEvidence } from "./subagent-outcome-verification.js";
export { validateSubagentOutcome } from "./subagent-outcome-validation.js";

export interface CreateSubagentOutcomeInput {
  taskId: string;
  role: SubagentRole;
  model: ModelRef;
  prompt: string;
  resultText: string;
}

export interface RebindSubagentOutcomeInput {
  taskId: string;
  prompt: string;
}

export function isRepairableSubagentOutcomeResult(resultText: string): boolean {
  if (Buffer.byteLength(resultText, "utf8") > MAX_RESULT_BYTES) return false;
  try {
    parseSubagentResult(resultText);
    return false;
  } catch {
    return true;
  }
}

export function createSubagentOutcome(
  input: CreateSubagentOutcomeInput,
): SubagentOutcome {
  assertCreateInput(input);
  const parsed = parseSubagentResult(input.resultText);
  if (parsed.items.some((item) => item.evidence.length > 0)) {
    throw new Error("Subagent outcome evidence requires workspace grounding");
  }
  return buildSubagentOutcome(
    {
      taskId: input.taskId,
      role: input.role,
      model: normalizeSubagentModel(input.model),
      promptSha256: sha256(input.prompt),
      resultSha256: sha256(input.resultText),
      summary: parsed.summary,
      items: parsed.items,
      unknowns: parsed.unknowns,
    },
    1,
  );
}

export async function createGroundedSubagentOutcome(
  input: CreateSubagentOutcomeInput & { workspaceRoot: string },
): Promise<GroundedSubagentOutcome> {
  assertCreateInput(input);
  const parsed = parseSubagentResult(input.resultText);
  const items = await Promise.all(
    parsed.items.map(
      async (item): Promise<SubagentOutcomeItem> => ({
        ...item,
        evidence: await Promise.all(
          item.evidence.map(
            async (reference): Promise<SubagentOutcomeEvidence> => {
              const observed = await readWorkspaceTextEvidence(
                input.workspaceRoot,
                reference,
              );
              return {
                path: observed.path,
                ...(reference.lineStart === undefined
                  ? {}
                  : {
                      lineStart: observed.lineStart,
                      lineEnd: observed.lineEnd,
                    }),
                fileSha256: observed.fileSha256,
                rangeSha256: observed.rangeSha256,
                fileSizeBytes: observed.fileSizeBytes,
                observedLineCount: observed.observedLineCount,
              };
            },
          ),
        ),
      }),
    ),
  );
  return buildSubagentOutcome(
    {
      taskId: input.taskId,
      role: input.role,
      model: normalizeSubagentModel(input.model),
      promptSha256: sha256(input.prompt),
      resultSha256: sha256(input.resultText),
      summary: parsed.summary,
      items,
      unknowns: parsed.unknowns,
    },
    2,
  ) as GroundedSubagentOutcome;
}

export function assertSubagentOutcomeBinding(
  input: unknown,
  task: {
    id: string;
    role: SubagentRole;
    model: ModelRef;
    prompt: string;
  },
): SubagentOutcome {
  const outcome = validateSubagentOutcome(input);
  if (
    outcome.taskId !== task.id ||
    outcome.role !== task.role ||
    canonicalJson(outcome.model) !==
      canonicalJson(normalizeSubagentModel(task.model)) ||
    outcome.promptSha256 !== sha256(task.prompt)
  ) {
    throw new Error("Subagent outcome task binding is invalid");
  }
  return outcome;
}

export function rebindSubagentOutcome(
  input: unknown,
  binding: RebindSubagentOutcomeInput,
): SubagentOutcome {
  const outcome = validateSubagentOutcome(input);
  if (!RESOURCE_ID.test(binding.taskId) || !binding.prompt.trim()) {
    throw new Error("Subagent outcome import binding is invalid");
  }
  return buildSubagentOutcome(
    {
      taskId: binding.taskId,
      role: outcome.role,
      model: outcome.model,
      summary: outcome.summary,
      items: outcome.items,
      unknowns: outcome.unknowns,
      promptSha256: sha256(binding.prompt),
      resultSha256: outcome.resultSha256,
    },
    outcome.schemaVersion,
  );
}

export function formatSubagentOutcome(outcome: SubagentOutcome): string {
  const lines = [outcome.summary];
  for (const item of outcome.items) {
    const evidence = item.evidence
      .map((entry) =>
        entry.lineStart === undefined
          ? entry.path
          : `${entry.path}:${entry.lineStart}${
              entry.lineEnd === entry.lineStart ? "" : `-${entry.lineEnd}`
            }`,
      )
      .join(", ");
    lines.push(
      `[${item.severity}] ${item.title}: ${item.detail}${
        evidence ? ` (${evidence})` : ""
      }`,
    );
  }
  if (outcome.unknowns.length > 0) {
    lines.push(`Unknowns: ${outcome.unknowns.join("; ")}`);
  }
  return lines.join("\n");
}

function assertCreateInput(input: CreateSubagentOutcomeInput): void {
  if (
    !RESOURCE_ID.test(input.taskId) ||
    !isSubagentRole(input.role) ||
    !input.prompt.trim() ||
    Buffer.byteLength(input.resultText, "utf8") > MAX_RESULT_BYTES
  ) {
    throw new Error("Subagent outcome input is invalid");
  }
}
