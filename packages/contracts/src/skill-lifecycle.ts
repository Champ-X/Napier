import {
  STANDARD_SKILL_ROOT_KINDS,
  type StandardSkillRootKind,
  type StandardSkillSource,
} from "./skill-load-standard-types.js";
import {
  canonical,
  exact,
  hashed,
  hex,
  integer,
  name,
  object,
  sha256,
} from "./skill-load-validation.js";

export const SKILL_LIFECYCLE_STATES = [
  "selected",
  "loaded",
  "failed",
  "unavailable",
  "applied",
] as const;
export type SkillLifecycleProjectionState =
  (typeof SKILL_LIFECYCLE_STATES)[number];

export const SKILL_APPLICATION_MODES = [
  "research_evidence_cited",
  "data_analysis_transformed",
  "software_change_verified",
  "software_change_observed",
] as const;
export type SkillApplicationMode = (typeof SKILL_APPLICATION_MODES)[number];

export interface SkillLifecycleProjectionV1 {
  kind: "napier.skill-lifecycle-projection";
  schemaVersion: 1;
  operation: "skill.lifecycle.project";
  state: SkillLifecycleProjectionState;
  skillName: string;
  requestedNameSha256: string;
  source: StandardSkillSource | "composite";
  rootKind?: StandardSkillRootKind;
  candidateRootKinds: StandardSkillRootKind[];
  catalogSha256: string;
  availabilitySetSha256: string;
  snapshotManifestSha256: string;
  contextSeq: number;
  selectedSeq?: number;
  terminalSeq?: number;
  receiptContentSha256?: string;
  failureContentSha256?: string;
  applicationMode?: SkillApplicationMode;
  proofEventSeqs?: number[];
  proofEventSetSha256?: string;
  contentSha256: string;
}

export function skillProofEventSetSha256(
  applicationMode: SkillApplicationMode,
  proofEventSeqs: readonly number[],
): string {
  return sha256(canonical({ applicationMode, proofEventSeqs }));
}

export function isSkillLifecycleProjectionV1(
  value: unknown,
): value is SkillLifecycleProjectionV1 {
  if (
    !object(value) ||
    !exact(value, REQUIRED_KEYS, OPTIONAL_KEYS) ||
    value.kind !== "napier.skill-lifecycle-projection" ||
    value.schemaVersion !== 1 ||
    value.operation !== "skill.lifecycle.project" ||
    !SKILL_LIFECYCLE_STATES.includes(
      value.state as SkillLifecycleProjectionState,
    ) ||
    !name(value.skillName) ||
    value.requestedNameSha256 !== sha256(value.skillName) ||
    !sourceRoot(value.source, value.rootKind) ||
    !rootKinds(value.candidateRootKinds) ||
    (value.source !== "composite" && value.candidateRootKinds.length !== 0) ||
    !hex(value.catalogSha256) ||
    !hex(value.availabilitySetSha256) ||
    !hex(value.snapshotManifestSha256) ||
    !integer(value.contextSeq, 1, Number.MAX_SAFE_INTEGER) ||
    !optionalInteger(value.selectedSeq) ||
    !optionalInteger(value.terminalSeq) ||
    !optionalHex(value.receiptContentSha256) ||
    !optionalHex(value.failureContentSha256)
  ) {
    return false;
  }
  if (!stateRelations(value)) return false;
  return hashed(value, "contentSha256");
}

const REQUIRED_KEYS = [
  "kind",
  "schemaVersion",
  "operation",
  "state",
  "skillName",
  "requestedNameSha256",
  "source",
  "candidateRootKinds",
  "catalogSha256",
  "availabilitySetSha256",
  "snapshotManifestSha256",
  "contextSeq",
  "contentSha256",
];
const OPTIONAL_KEYS = [
  "rootKind",
  "selectedSeq",
  "terminalSeq",
  "receiptContentSha256",
  "failureContentSha256",
  "applicationMode",
  "proofEventSeqs",
  "proofEventSetSha256",
];

function stateRelations(value: Record<string, unknown>): boolean {
  const state = value.state as SkillLifecycleProjectionState;
  const context = Number(value.contextSeq);
  const selected = value.selectedSeq as number | undefined;
  const terminal = value.terminalSeq as number | undefined;
  if (selected !== undefined && selected <= context) return false;
  if (
    terminal !== undefined &&
    terminal <= (selected === undefined ? context : selected)
  ) {
    return false;
  }
  if (state === "selected") {
    return (
      selected !== undefined &&
      terminal === undefined &&
      noTerminalEvidence(value) &&
      noApplicationEvidence(value)
    );
  }
  if (state === "unavailable") {
    return (
      selected === undefined &&
      terminal === undefined &&
      value.receiptContentSha256 === undefined &&
      hex(value.failureContentSha256) &&
      noApplicationEvidence(value)
    );
  }
  if (state === "failed") {
    return (
      terminal !== undefined &&
      value.receiptContentSha256 === undefined &&
      hex(value.failureContentSha256) &&
      noApplicationEvidence(value)
    );
  }
  if (
    selected === undefined ||
    terminal === undefined ||
    !hex(value.receiptContentSha256) ||
    value.failureContentSha256 !== undefined
  ) {
    return false;
  }
  if (state === "loaded") return noApplicationEvidence(value);
  return applicationEvidence(value, terminal);
}

function applicationEvidence(
  value: Record<string, unknown>,
  terminal: number,
): boolean {
  if (
    !SKILL_APPLICATION_MODES.includes(
      value.applicationMode as SkillApplicationMode,
    ) ||
    !Array.isArray(value.proofEventSeqs) ||
    value.proofEventSeqs.length < 1 ||
    value.proofEventSeqs.length > 8 ||
    !value.proofEventSeqs.every((seq) =>
      integer(seq, terminal + 1, Number.MAX_SAFE_INTEGER),
    ) ||
    !strictlyIncreasing(value.proofEventSeqs) ||
    !hex(value.proofEventSetSha256)
  ) {
    return false;
  }
  return (
    value.proofEventSetSha256 ===
    skillProofEventSetSha256(
      value.applicationMode as SkillApplicationMode,
      value.proofEventSeqs as number[],
    )
  );
}

function noTerminalEvidence(value: Record<string, unknown>): boolean {
  return (
    value.receiptContentSha256 === undefined &&
    value.failureContentSha256 === undefined
  );
}

function noApplicationEvidence(value: Record<string, unknown>): boolean {
  return (
    value.applicationMode === undefined &&
    value.proofEventSeqs === undefined &&
    value.proofEventSetSha256 === undefined
  );
}

function sourceRoot(source: unknown, root: unknown): boolean {
  if (source === "composite") return root === undefined;
  if (!STANDARD_SKILL_ROOT_KINDS.includes(root as StandardSkillRootKind)) {
    return false;
  }
  return (
    source ===
    (root === "user_standard"
      ? "user"
      : root === "bundled_standard"
        ? "bundled"
        : "project")
  );
}

function rootKinds(value: unknown): value is StandardSkillRootKind[] {
  if (
    !Array.isArray(value) ||
    value.length > STANDARD_SKILL_ROOT_KINDS.length
  ) {
    return false;
  }
  const indexes = value.map((root) =>
    STANDARD_SKILL_ROOT_KINDS.indexOf(root as StandardSkillRootKind),
  );
  return indexes.every(
    (index, position) =>
      index >= 0 && (position === 0 || index > indexes[position - 1]!),
  );
}

function optionalHex(value: unknown): boolean {
  return value === undefined || hex(value);
}

function optionalInteger(value: unknown): boolean {
  return value === undefined || integer(value, 1, Number.MAX_SAFE_INTEGER);
}

function strictlyIncreasing(values: readonly number[]): boolean {
  return values.every(
    (value, index) => index === 0 || value > values[index - 1]!,
  );
}
