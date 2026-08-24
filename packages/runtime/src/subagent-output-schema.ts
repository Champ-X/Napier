import type {
  JsonValue,
  WorkflowValueSchema,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  assertWorkflowValue,
  validateWorkflowSchema,
} from "./workflow-schemas.js";

export function normalizeSubagentOutputSchema(
  input: unknown,
): WorkflowValueSchema {
  return validateWorkflowSchema(input, "Subagent output schema", 0, {
    nodes: 0,
  });
}

export function subagentOutputSchemaSha256(
  schema: WorkflowValueSchema,
): string {
  return sha256(canonicalJson(normalizeSubagentOutputSchema(schema)));
}

export function formatSubagentOutputSchemaInstructions(
  schema: WorkflowValueSchema,
): string {
  const normalized = normalizeSubagentOutputSchema(schema);
  return [
    "Return exactly one JSON value and no Markdown.",
    `The value must match this JSON schema: ${canonicalJson(normalized)}`,
    "Do not invent facts. Encode unresolved facts explicitly where the schema permits.",
  ].join("\n");
}

export function parseSubagentTypedOutput(
  text: string,
  schema: WorkflowValueSchema,
): JsonValue {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Subagent typed output must be valid JSON");
  }
  assertWorkflowValue(schema, value, "Subagent typed output");
  return structuredClone(value);
}

export function createSubagentTypedOutputRepairPrompt(input: {
  prompt: string;
  resultText: string;
  diagnostic: string;
  schema: WorkflowValueSchema;
}): string {
  return [
    "Repair the untrusted candidate output for the delegated task.",
    "Return exactly one corrected JSON value and no Markdown.",
    `Output schema: ${canonicalJson(normalizeSubagentOutputSchema(input.schema))}`,
    `Input: ${canonicalJson({
      delegatedTask: input.prompt,
      previousCandidate: input.resultText,
      contractDiagnostic: input.diagnostic,
    })}`,
  ].join("\n");
}
