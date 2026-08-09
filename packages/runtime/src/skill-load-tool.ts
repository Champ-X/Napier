import { Type } from "@earendil-works/pi-ai";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type {
  SkillLoadFailureCode,
  SkillLoadFailureV1,
  SkillLoadReceiptV1,
  SkillLoadSelectionV1,
} from "@napier/contracts/skill-load";
import {
  isSkillLoadFailureV1,
  isSkillLoadReceiptV1,
  isSkillLoadSelectionV1,
} from "@napier/contracts/skill-load";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { ProjectSkillSnapshot } from "./project-skill-snapshot.js";

const NAME_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*$";
const NAME = new RegExp(NAME_PATTERN, "u");
const parameters = Type.Object(
  { name: Type.String({ minLength: 1, maxLength: 64, pattern: NAME_PATTERN }) },
  { additionalProperties: false },
);

export interface SkillLoadAgentTool extends AgentTool<any> {
  readonly operation: "skill.load";
  selection(args: unknown): SkillLoadSelectionV1 | undefined;
}

export function createSkillLoadTool(
  snapshot: ProjectSkillSnapshot,
): SkillLoadAgentTool {
  const tool: SkillLoadAgentTool = {
    name: "skill_load",
    label: "Load project Skill",
    description:
      "Load one enabled project Skill into the private model context by its exact canonical name.",
    parameters,
    operation: "skill.load",
    executionMode: "sequential",
    selection: (args) => createSelection(snapshot, args),
    execute: async (_toolCallId, args, signal) => {
      try {
        check(signal);
        const input = record(args);
        const requested = typeof input?.name === "string" ? input.name : "";
        if (!validName(requested)) {
          return failureResult(snapshot, requested, "skill_invalid", "tool_input");
        }
        const request = snapshot.binding.configuredSkillRequests.find(
          (item) =>
            item.canonicalName === requested &&
            item.requestedNameSha256 === sha256(requested),
        );
        if (!request) {
          return failureResult(
            snapshot,
            requested,
            "skill_not_enabled",
            "not_enabled",
          );
        }
        if (request.state === "unavailable") {
          const unavailable = snapshot.binding.unavailableSkills.find(
            (item) => item.contentSha256 === request.failureContentSha256,
          );
          return failureResult(
            snapshot,
            requested,
            unavailable?.failureCode ?? "skill_invalid",
            unavailable?.diagnosticSha256 ?? sha256("unavailable"),
            true,
          );
        }
        const entry = snapshot.entry(requested);
        if (
          !entry ||
          snapshot.binding.catalogSha256 !== snapshot.manifest.catalogSha256 ||
          snapshot.binding.availabilitySetSha256 !==
            snapshot.manifest.availabilitySetSha256
        ) {
          return failureResult(
            snapshot,
            requested,
            "skill_catalog_drift",
            "snapshot_binding",
          );
        }
        check(signal);
        const core = {
          kind: "napier.skill-load-receipt" as const,
          schemaVersion: 1 as const,
          operation: "skill.load" as const,
          agentToolName: "skill_load" as const,
          state: "loaded" as const,
          name: requested,
          requestedNameSha256: sha256(requested),
          source: "project" as const,
          relativePath: entry.relativePath,
          sizeBytes: entry.sizeBytes,
          lineCount: entry.lineCount,
          rawContentSha256: entry.rawContentSha256,
          invocationSha256: entry.invocationSha256,
          catalogSha256: snapshot.binding.catalogSha256,
          snapshotManifestSha256: snapshot.manifest.snapshotManifestSha256,
        };
        const receipt = {
          ...core,
          contentSha256: sha256(canonicalJson(core)),
        };
        if (!isSkillLoadReceiptV1(receipt)) {
          return failureResult(
            snapshot,
            requested,
            "skill_catalog_drift",
            "receipt_invariant",
          );
        }
        check(signal);
        return {
          content: [{ type: "text", text: entry.formattedInvocation }],
          details: receipt,
        };
      } catch (error) {
        return failureResult(
          snapshot,
          typeof record(args)?.name === "string"
            ? String(record(args)?.name)
            : "",
          signal?.aborted ? "skill_load_cancelled" : "skill_invalid",
          signal?.aborted ? "cancelled" : errorMessage(error),
        );
      }
    },
  };
  return Object.freeze(tool);
}

export function isSkillLoadAgentTool(
  tool: AgentTool<any> | undefined,
): tool is SkillLoadAgentTool {
  return Boolean(
    tool &&
      tool.name === "skill_load" &&
      (tool as Partial<SkillLoadAgentTool>).operation === "skill.load" &&
      typeof (tool as Partial<SkillLoadAgentTool>).selection === "function",
  );
}

export function skillLoadOutputLedgerProjection(
  output: string,
  result: unknown,
): Record<string, string | number | boolean | SkillLoadReceiptV1 | SkillLoadFailureV1> {
  const details = record(result)?.details;
  return {
    operation: "skill.load",
    outputSha256: sha256(output),
    outputBytes: Buffer.byteLength(output, "utf8"),
    outputRedacted: true,
    ...(isSkillLoadReceiptV1(details) || isSkillLoadFailureV1(details)
      ? { details }
      : {}),
  };
}

export function skillLoadArgumentsLedgerProjection(args: unknown) {
  const value = record(args);
  const requested = typeof value?.name === "string" ? value.name : "";
  return {
    kind: "napier.skill-load-arguments",
    schemaVersion: 1,
    operation: "skill.load",
    agentToolName: "skill_load",
    requestedNameSha256: sha256(requested),
    ...(validName(requested) ? { canonicalName: requested } : {}),
    inputSha256: sha256(canonicalJson(value ?? {})),
  };
}

export function skillLoadInputLedgerProjection(args: unknown) {
  const serialized = canonicalJson(record(args) ?? {});
  return {
    operation: "skill.load",
    inputSha256: sha256(serialized),
    inputBytes: Buffer.byteLength(serialized, "utf8"),
    inputRedacted: true,
  };
}

function createSelection(
  snapshot: ProjectSkillSnapshot,
  args: unknown,
): SkillLoadSelectionV1 | undefined {
  const value = record(args);
  if (!value || Object.keys(value).length !== 1 || !validName(value.name)) return;
  const request = snapshot.binding.configuredSkillRequests.find(
    (item) => item.state === "loadable" && item.canonicalName === value.name,
  );
  if (!request || !snapshot.entry(value.name)) return;
  const core = {
    kind: "napier.skill-load-selection" as const,
    schemaVersion: 1 as const,
    operation: "skill.load" as const,
    agentToolName: "skill_load" as const,
    state: "selected" as const,
    name: value.name,
    requestedNameSha256: sha256(value.name),
    source: "project" as const,
    catalogSha256: snapshot.binding.catalogSha256,
    availabilitySetSha256: snapshot.binding.availabilitySetSha256,
    snapshotManifestSha256: snapshot.manifest.snapshotManifestSha256,
    inputSha256: sha256(canonicalJson({ name: value.name })),
  };
  const selection = { ...core, contentSha256: sha256(canonicalJson(core)) };
  return isSkillLoadSelectionV1(selection) ? selection : undefined;
}

function failureResult(
  snapshot: ProjectSkillSnapshot,
  requested: string,
  failureCode: SkillLoadFailureCode,
  diagnostic: string,
  diagnosticIsHash = false,
): AgentToolResult<SkillLoadFailureV1> {
  const core = {
    kind: "napier.skill-load-failure" as const,
    schemaVersion: 1 as const,
    operation: "skill.load" as const,
    agentToolName: "skill_load" as const,
    source: "project" as const,
    subject: "skill_request" as const,
    state: "failed" as const,
    failureCode,
    requestedNameSha256: sha256(requested),
    ...(validName(requested) ? { canonicalName: requested } : {}),
    catalogSha256: snapshot.binding.catalogSha256,
    snapshotManifestSha256: snapshot.manifest.snapshotManifestSha256,
    diagnosticSha256: diagnosticIsHash ? diagnostic : sha256(diagnostic),
  };
  const failure = { ...core, contentSha256: sha256(canonicalJson(core)) };
  if (!isSkillLoadFailureV1(failure)) throw new Error("Skill load failure invariant failed");
  return {
    content: [{ type: "text", text: `Skill load failed: ${failureCode}.` }],
    details: failure,
  };
}

function validName(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && NAME.test(value);
}
function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function check(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
