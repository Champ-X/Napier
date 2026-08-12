import {
  isEffectiveAgentCapabilityProjectionV1,
  type EffectiveAgentCapabilityProjectionV1,
} from "@napier/contracts/agent-capability-contract";
import { describe, expect, it } from "vitest";

const digest = "a".repeat(64);
const validProjection: EffectiveAgentCapabilityProjectionV1 = {
  kind: "napier.effective-agent-capabilities",
  schemaVersion: 1,
  agentId: "agent_napier",
  agentRevision: 2,
  contractId: "napier.default-agent.capabilities",
  contractVersion: 2,
  recommendationSha256: digest,
  driftState: "current",
  ownership: "recommended",
  explicitOverrideFields: ["enabledSkills"],
  legacySignatureSha256: digest,
  toolPolicy: "observe",
  configuredTools: ["read_file"],
  runtimeExposedTools: ["read_file"],
  configuredSkills: ["software-delivery"],
  configuredSubagents: ["reviewer"],
  readiness: [
    {
      id: "tool:read_file",
      status: "ready",
      configured: true,
      allowedByPolicy: true,
      exposed: true,
      detail: "Tool is available",
    },
  ],
  upgradePreview: {
    schemaVersion: 1,
    contractId: "napier.default-agent.capabilities",
    sourceContractVersion: 1,
    targetContractVersion: 2,
    sourceRecommendationSha256: digest,
    targetRecommendationSha256: digest,
    agentId: "agent_napier",
    agentRevision: 2,
    explicitOverrideFields: ["enabledSkills"],
    currentManagedStateSha256: digest,
    targetManagedStateSha256: digest,
    operations: [
      {
        field: "enabledTools",
        operation: "add",
        value: "skill_load",
        effect: "read",
        risk: "low",
      },
    ],
    diffSha256: digest,
  },
  restorePreview: {
    schemaVersion: 1,
    contractId: "napier.default-agent.capabilities",
    contractVersion: 2,
    recommendationSha256: digest,
    agentId: "agent_napier",
    agentRevision: 2,
    currentManagedStateSha256: digest,
    targetManagedStateSha256: digest,
    operations: [
      {
        field: "enabledSkills",
        operation: "add",
        value: "software-delivery",
        effect: "skill_catalog",
        risk: "low",
      },
    ],
    diffSha256: digest,
  },
  projectionSha256: digest,
};

describe("effective Agent capability projection validator", () => {
  it("accepts a schema-V1 projection for the current contract version", () => {
    expect(isEffectiveAgentCapabilityProjectionV1(validProjection)).toBe(true);
    expect(
      isEffectiveAgentCapabilityProjectionV1({
        ...validProjection,
        contractVersion: 1,
        upgradePreview: undefined,
        restorePreview: {
          ...validProjection.restorePreview,
          contractVersion: 1,
        },
      }),
    ).toBe(true);
    expect(
      isEffectiveAgentCapabilityProjectionV1({
        ...validProjection,
        legacySignatureSha256: undefined,
      }),
    ).toBe(true);
    expect(
      isEffectiveAgentCapabilityProjectionV1({
        ...validProjection,
        capabilityPreset: "browser",
      }),
    ).toBe(true);
    expect(
      isEffectiveAgentCapabilityProjectionV1({
        ...validProjection,
        capabilityPreset: "unrestricted_everything",
      }),
    ).toBe(false);
    expect(
      isEffectiveAgentCapabilityProjectionV1({
        ...validProjection,
        upgradePreview: undefined,
      }),
    ).toBe(true);
  });

  it.each(invalidProjections)("rejects %s", (_name, value) => {
    expect(isEffectiveAgentCapabilityProjectionV1(value)).toBe(false);
  });
});

const topLevelKeys = [
  "kind",
  "schemaVersion",
  "agentId",
  "agentRevision",
  "contractId",
  "contractVersion",
  "recommendationSha256",
  "driftState",
  "ownership",
  "explicitOverrideFields",
  "toolPolicy",
  "configuredTools",
  "runtimeExposedTools",
  "configuredSkills",
  "configuredSubagents",
  "readiness",
  "restorePreview",
  "projectionSha256",
] as const;
const readinessKeys = [
  "id",
  "status",
  "configured",
  "allowedByPolicy",
  "exposed",
  "detail",
] as const;
const restoreKeys = [
  "schemaVersion",
  "contractId",
  "contractVersion",
  "recommendationSha256",
  "agentId",
  "agentRevision",
  "currentManagedStateSha256",
  "targetManagedStateSha256",
  "operations",
  "diffSha256",
] as const;
const operationKeys = [
  "field",
  "operation",
  "value",
  "effect",
  "risk",
] as const;

const invalidProjections: ReadonlyArray<readonly [string, unknown]> = [
  ...topLevelKeys.map((key) => missingAt(`missing top-level ${key}`, [key])),
  invalidAt("wrong kind discriminant", ["kind"], "other"),
  invalidAt("wrong schema version", ["schemaVersion"], 2),
  invalidAt("empty Agent identity", ["agentId"], ""),
  invalidAt("zero Agent revision", ["agentRevision"], 0),
  invalidAt("fractional Agent revision", ["agentRevision"], 1.5),
  invalidAt(
    "unsafe Agent revision",
    ["agentRevision"],
    Number.MAX_SAFE_INTEGER + 1,
  ),
  invalidAt("wrong contract identity", ["contractId"], "other"),
  invalidAt("zero contract version", ["contractVersion"], 0),
  invalidAt("fractional contract version", ["contractVersion"], 1.5),
  invalidAt(
    "mismatched restore contract version",
    ["restorePreview", "contractVersion"],
    1,
  ),
  invalidAt(
    "mismatched upgrade Agent revision",
    ["upgradePreview", "agentRevision"],
    3,
  ),
  invalidAt(
    "mismatched upgrade overrides",
    ["upgradePreview", "explicitOverrideFields"],
    [],
  ),
  invalidAt(
    "non-advancing upgrade version",
    ["upgradePreview", "sourceContractVersion"],
    2,
  ),
  invalidAt(
    "uppercase recommendation digest",
    ["recommendationSha256"],
    "A".repeat(64),
  ),
  invalidAt("unknown drift state", ["driftState"], "future"),
  invalidAt("unknown ownership", ["ownership"], "private"),
  invalidAt(
    "unknown explicit override field",
    ["explicitOverrideFields"],
    ["model"],
  ),
  invalidAt(
    "sparse explicit override fields",
    ["explicitOverrideFields"],
    new Array(1),
  ),
  invalidAt("malformed legacy digest", ["legacySignatureSha256"], "ABC"),
  invalidAt("unknown tool policy", ["toolPolicy"], "future"),
  ...[
    "configuredTools",
    "runtimeExposedTools",
    "configuredSkills",
    "configuredSubagents",
  ].flatMap((key) => [
    invalidAt(`non-string ${key}`, [key], [1]),
    invalidAt(`sparse ${key}`, [key], new Array(1)),
  ]),
  invalidAt("non-array readiness", ["readiness"], {}),
  invalidAt("sparse readiness", ["readiness"], new Array(1)),
  ...readinessKeys.map((key) =>
    missingAt(`missing readiness ${key}`, ["readiness", 0, key]),
  ),
  invalidAt("empty readiness identity", ["readiness", 0, "id"], ""),
  invalidAt("unknown readiness status", ["readiness", 0, "status"], "future"),
  invalidAt(
    "non-boolean readiness configured",
    ["readiness", 0, "configured"],
    1,
  ),
  invalidAt(
    "non-boolean readiness policy",
    ["readiness", 0, "allowedByPolicy"],
    "yes",
  ),
  invalidAt("non-boolean readiness exposed", ["readiness", 0, "exposed"], null),
  invalidAt("empty readiness detail", ["readiness", 0, "detail"], ""),
  withMutation("extra readiness key", (value) => {
    recordAt(value, ["readiness", 0]).private = true;
  }),
  invalidAt("non-object restore preview", ["restorePreview"], []),
  ...restoreKeys.map((key) =>
    missingAt(`missing restore ${key}`, ["restorePreview", key]),
  ),
  invalidAt(
    "wrong restore schema version",
    ["restorePreview", "schemaVersion"],
    2,
  ),
  invalidAt(
    "wrong restore contract identity",
    ["restorePreview", "contractId"],
    "other",
  ),
  invalidAt(
    "zero restore contract version",
    ["restorePreview", "contractVersion"],
    0,
  ),
  invalidAt(
    "malformed restore recommendation digest",
    ["restorePreview", "recommendationSha256"],
    "ABC",
  ),
  invalidAt("empty restore Agent identity", ["restorePreview", "agentId"], ""),
  invalidAt(
    "zero restore Agent revision",
    ["restorePreview", "agentRevision"],
    0,
  ),
  invalidAt(
    "unsafe restore Agent revision",
    ["restorePreview", "agentRevision"],
    Number.MAX_SAFE_INTEGER + 1,
  ),
  ...[
    "currentManagedStateSha256",
    "targetManagedStateSha256",
    "diffSha256",
  ].map((key) =>
    invalidAt(`malformed restore ${key}`, ["restorePreview", key], "ABC"),
  ),
  invalidAt(
    "non-array restore operations",
    ["restorePreview", "operations"],
    {},
  ),
  invalidAt(
    "sparse restore operations",
    ["restorePreview", "operations"],
    new Array(1),
  ),
  withMutation("extra restore key", (value) => {
    recordAt(value, ["restorePreview"]).private = true;
  }),
  ...operationKeys.map((key) =>
    missingAt(`missing operation ${key}`, [
      "restorePreview",
      "operations",
      0,
      key,
    ]),
  ),
  invalidAt(
    "unknown operation field",
    ["restorePreview", "operations", 0, "field"],
    "model",
  ),
  invalidAt(
    "unknown operation discriminant",
    ["restorePreview", "operations", 0, "operation"],
    "copy",
  ),
  invalidAt(
    "non-string operation value",
    ["restorePreview", "operations", 0, "value"],
    1,
  ),
  invalidAt(
    "unknown operation effect",
    ["restorePreview", "operations", 0, "effect"],
    "future",
  ),
  invalidAt(
    "unknown operation risk",
    ["restorePreview", "operations", 0, "risk"],
    "critical",
  ),
  withMutation("extra operation key", (value) => {
    recordAt(value, ["restorePreview", "operations", 0]).private = true;
  }),
  withMutation("extra top-level key", (value) => {
    value.private = true;
  }),
];

function invalidAt(
  name: string,
  path: readonly PropertyKey[],
  replacement: unknown,
): readonly [string, unknown] {
  return withMutation(name, (value) => {
    const parent = recordAt(value, path.slice(0, -1));
    parent[path.at(-1)!] = replacement;
  });
}

function missingAt(
  name: string,
  path: readonly PropertyKey[],
): readonly [string, unknown] {
  return withMutation(name, (value) => {
    const parent = recordAt(value, path.slice(0, -1));
    delete parent[path.at(-1)!];
  });
}

function withMutation(
  name: string,
  mutate: (value: Record<PropertyKey, unknown>) => void,
): readonly [string, unknown] {
  const value = structuredClone(validProjection) as unknown as Record<
    PropertyKey,
    unknown
  >;
  mutate(value);
  return [name, value];
}

function recordAt(
  value: Record<PropertyKey, unknown>,
  path: readonly PropertyKey[],
): Record<PropertyKey, unknown> {
  let current: unknown = value;
  for (const key of path) {
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return current as Record<PropertyKey, unknown>;
}
