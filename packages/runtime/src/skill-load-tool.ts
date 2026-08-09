import { Type } from "@earendil-works/pi-ai";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { SkillLoadFailureCode } from "@napier/contracts/skill-load";
import type { StandardSkillRootKind } from "@napier/contracts/skill-load-standard";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  isSkillLoadFailure,
  isSkillLoadReceipt,
  isSkillLoadSelection,
  type SkillLoadFailure,
  type SkillLoadReceipt,
  type SkillLoadSelection,
} from "./skill-load-contracts.js";
import type { SkillSnapshot } from "./standard-skill-snapshot.js";

const NAME_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*$";
const NAME = new RegExp(NAME_PATTERN, "u");
const parameters = Type.Object(
  { name: Type.String({ minLength: 1, maxLength: 64, pattern: NAME_PATTERN }) },
  { additionalProperties: false },
);

export interface SkillLoadAgentTool extends AgentTool<any> {
  readonly operation: "skill.load";
  selection(args: unknown): SkillLoadSelection | undefined;
}

export function createSkillLoadTool(
  snapshot: SkillSnapshot,
): SkillLoadAgentTool {
  const tool: SkillLoadAgentTool = {
    name: "skill_load",
    label: "Load Skill",
    description:
      "Load one enabled project or user Skill into the private model context by its exact canonical name.",
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
          return failureResult(
            snapshot,
            requested,
            "skill_invalid",
            "tool_input",
          );
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
            unavailable && "candidateRootKinds" in unavailable
              ? unavailable.candidateRootKinds
              : [],
          );
        }
        const entry = snapshot.entry(requested);
        const origin = skillEntryOrigin(entry);
        if (
          !entry ||
          (snapshot.binding.schemaVersion === 2 && !origin) ||
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
        const common = {
          kind: "napier.skill-load-receipt" as const,
          operation: "skill.load" as const,
          agentToolName: "skill_load" as const,
          state: "loaded" as const,
          name: requested,
          requestedNameSha256: sha256(requested),
          relativePath: entry.relativePath,
          sizeBytes: entry.sizeBytes,
          lineCount: entry.lineCount,
          rawContentSha256: entry.rawContentSha256,
          invocationSha256: entry.invocationSha256,
          catalogSha256: snapshot.binding.catalogSha256,
          snapshotManifestSha256: snapshot.manifest.snapshotManifestSha256,
        };
        const core =
          snapshot.binding.schemaVersion === 1
            ? {
                ...common,
                schemaVersion: 1 as const,
                source: "project" as const,
              }
            : {
                ...common,
                schemaVersion: 2 as const,
                source: origin!.source,
                rootKind: origin!.rootKind,
              };
        const receipt = {
          ...core,
          contentSha256: sha256(canonicalJson(core)),
        };
        if (!isSkillLoadReceipt(receipt)) {
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
): Record<
  string,
  string | number | boolean | SkillLoadReceipt | SkillLoadFailure
> {
  const details = record(result)?.details;
  return {
    operation: "skill.load",
    outputSha256: sha256(output),
    outputBytes: Buffer.byteLength(output, "utf8"),
    outputRedacted: true,
    ...(isSkillLoadReceipt(details) || isSkillLoadFailure(details)
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
  snapshot: SkillSnapshot,
  args: unknown,
): SkillLoadSelection | undefined {
  const value = record(args);
  if (!value || Object.keys(value).length !== 1 || !validName(value.name))
    return;
  const request = snapshot.binding.configuredSkillRequests.find(
    (item) => item.state === "loadable" && item.canonicalName === value.name,
  );
  if (!request || !snapshot.entry(value.name)) return;
  const entry = snapshot.entry(value.name);
  if (!entry) return;
  const origin = skillEntryOrigin(entry);
  if (snapshot.binding.schemaVersion === 2 && !origin) return;
  const common = {
    kind: "napier.skill-load-selection" as const,
    operation: "skill.load" as const,
    agentToolName: "skill_load" as const,
    state: "selected" as const,
    name: value.name,
    requestedNameSha256: sha256(value.name),
    catalogSha256: snapshot.binding.catalogSha256,
    availabilitySetSha256: snapshot.binding.availabilitySetSha256,
    snapshotManifestSha256: snapshot.manifest.snapshotManifestSha256,
    inputSha256: sha256(canonicalJson({ name: value.name })),
  };
  const core =
    snapshot.binding.schemaVersion === 1
      ? { ...common, schemaVersion: 1 as const, source: "project" as const }
      : {
          ...common,
          schemaVersion: 2 as const,
          source: origin!.source,
          rootKind: origin!.rootKind,
        };
  const selection = { ...core, contentSha256: sha256(canonicalJson(core)) };
  return isSkillLoadSelection(selection) ? selection : undefined;
}

function failureResult(
  snapshot: SkillSnapshot,
  requested: string,
  failureCode: SkillLoadFailureCode,
  diagnostic: string,
  diagnosticIsHash = false,
  candidateRootKinds: StandardSkillRootKind[] = [],
): AgentToolResult<SkillLoadFailure> {
  const common = {
    kind: "napier.skill-load-failure" as const,
    operation: "skill.load" as const,
    agentToolName: "skill_load" as const,
    subject: "skill_request" as const,
    state: "failed" as const,
    failureCode,
    requestedNameSha256: sha256(requested),
    ...(validName(requested) ? { canonicalName: requested } : {}),
    catalogSha256: snapshot.binding.catalogSha256,
    snapshotManifestSha256: snapshot.manifest.snapshotManifestSha256,
    diagnosticSha256: diagnosticIsHash ? diagnostic : sha256(diagnostic),
  };
  const core =
    snapshot.binding.schemaVersion === 1
      ? { ...common, schemaVersion: 1 as const, source: "project" as const }
      : {
          ...common,
          schemaVersion: 2 as const,
          source: "composite" as const,
          candidateRootKinds,
        };
  const failure = { ...core, contentSha256: sha256(canonicalJson(core)) };
  if (!isSkillLoadFailure(failure))
    throw new Error("Skill load failure invariant failed");
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
  if (signal?.aborted)
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function skillEntryOrigin(value: unknown):
  | {
      source: "project" | "user";
      rootKind: StandardSkillRootKind;
    }
  | undefined {
  const entry = record(value);
  if (
    (entry?.source === "project" || entry?.source === "user") &&
    (entry.rootKind === "project_legacy" ||
      entry.rootKind === "project_standard" ||
      entry.rootKind === "user_standard")
  ) {
    return {
      source: entry.source,
      rootKind: entry.rootKind,
    };
  }
}
