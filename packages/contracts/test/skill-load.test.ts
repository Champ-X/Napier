import { createHash } from "node:crypto";

import { AGENT_TOOL_NAMES } from "../src/agent-tool-names.js";
import {
  isProjectSkillSnapshotManifestV1,
  isSkillCatalogBindingV1,
  isSkillLoadFailureV1,
  isSkillLoadReceiptV1,
  isSkillLoadSelectionV1,
  projectSkillApplicationV1,
  SKILL_LOAD_FAILURE_CODES,
} from "../src/skill-load.js";
import { describe, expect, it } from "vitest";

const H = (value: string) => createHash("sha256").update(value).digest("hex");
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};
const seal = <T extends Record<string, unknown>>(value: T, field: string) => ({
  ...value,
  [field]: H(canonical(value)),
});
const reseal = <T extends Record<string, unknown>>(value: T, field: string) =>
  seal(
    Object.fromEntries(Object.entries(value).filter(([key]) => key !== field)),
    field,
  );
const name = "research-brief";
const requestedNameSha256 = H(name);

function receipt() {
  return seal(
    {
      kind: "napier.skill-load-receipt",
      schemaVersion: 1,
      operation: "skill.load",
      agentToolName: "skill_load",
      state: "loaded",
      name,
      requestedNameSha256,
      source: "project",
      relativePath: `skills/${name}/SKILL.md`,
      sizeBytes: 123,
      lineCount: 7,
      rawContentSha256: H("raw"),
      invocationSha256: H("invocation"),
      catalogSha256: H("catalog"),
      snapshotManifestSha256: H("manifest"),
    },
    "contentSha256",
  );
}

function selection(availabilitySetSha256 = binding().availabilitySetSha256) {
  return seal(
    {
      kind: "napier.skill-load-selection",
      schemaVersion: 1,
      operation: "skill.load",
      agentToolName: "skill_load",
      state: "selected",
      name,
      requestedNameSha256,
      source: "project",
      catalogSha256: H("catalog"),
      availabilitySetSha256,
      snapshotManifestSha256: H("manifest"),
      inputSha256: H(canonical({ name })),
    },
    "contentSha256",
  );
}

function unavailableFailure(raw = name) {
  const safeName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(raw) ? raw : undefined;
  return seal(
    {
      kind: "napier.skill-load-failure",
      schemaVersion: 1,
      operation: "skill.load",
      agentToolName: "skill_load",
      source: "project",
      subject: "skill_request",
      state: "unavailable",
      failureCode: "skill_not_found",
      requestedNameSha256: H(raw),
      ...(safeName ? { canonicalName: safeName } : {}),
      catalogSha256: H("catalog"),
      diagnosticSha256: H("not-found"),
    },
    "contentSha256",
  );
}

function binding(catalogSha256 = H("catalog")) {
  const configuredSkillRequests = [
    {
      position: 0,
      requestedNameSha256,
      state: "loadable",
      canonicalName: name,
    },
  ];
  const loadableSkillNames = [name];
  const unavailableFailureContentSha256s: string[] = [];
  const availabilitySetSha256 = H(
    canonical({
      configuredSkillRequests,
      loadableSkillNames,
      unavailableFailureContentSha256s,
      catalogSha256,
    }),
  );
  return seal(
    {
      kind: "napier.skill-catalog-binding",
      schemaVersion: 1,
      operation: "skill.load",
      agentToolName: "skill_load",
      configuredSkillRequests,
      loadableSkillNames,
      unavailableSkills: [],
      catalogSha256,
      availabilitySetSha256,
      snapshotManifestSha256: H("manifest"),
    },
    "contentSha256",
  );
}

describe("Skill load contracts", () => {
  it("locks provider-safe naming and the exact failure vocabulary", () => {
    expect(AGENT_TOOL_NAMES).toContain("skill_load");
    expect("skill_load").toMatch(/^[a-zA-Z0-9_-]{1,64}$/u);
    expect(SKILL_LOAD_FAILURE_CODES).toEqual([
      "skill_not_enabled",
      "skill_not_found",
      "skill_ambiguous",
      "skill_disabled",
      "skill_invalid",
      "skill_untrusted",
      "skill_catalog_drift",
      "skill_limit_exceeded",
      "skill_load_cancelled",
    ]);
  });

  it("uses Node-compatible code-unit canonical SHA-256 guards", () => {
    const value = receipt();
    expect(isSkillLoadReceiptV1(value)).toBe(true);
    expect(value.contentSha256).toBe(
      H(
        canonical(
          Object.fromEntries(
            Object.entries(value).filter(([key]) => key !== "contentSha256"),
          ),
        ),
      ),
    );
    expect(isSkillLoadReceiptV1({ ...value, extra: true })).toBe(false);
    expect(
      isSkillLoadReceiptV1({ ...value, relativePath: "/private/SKILL.md" }),
    ).toBe(false);
  });

  it("accepts only exact request and bounded catalog failures", () => {
    expect(isSkillLoadFailureV1(unavailableFailure())).toBe(true);
    expect(isSkillLoadFailureV1(unavailableFailure("bad_name"))).toBe(true);
    const overflow = seal(
      {
        kind: "napier.skill-load-failure",
        schemaVersion: 1,
        operation: "skill.load",
        agentToolName: "skill_load",
        source: "project",
        subject: "project_catalog",
        state: "unavailable",
        failureCode: "skill_limit_exceeded",
        observedDirectoryCount: 65,
        directoryIdentitySetSha256: H("first-65"),
        catalogSha256: H(
          canonical({
            directDirectoryCount: 65,
            directoryIdentitySetSha256: H("first-65"),
          }),
        ),
        diagnosticSha256: H("overflow"),
      },
      "contentSha256",
    );
    expect(isSkillLoadFailureV1(overflow)).toBe(true);
    expect(
      isSkillLoadFailureV1({ ...overflow, observedDirectoryCount: 66 }),
    ).toBe(false);
  });

  it("binds ordered requests, availability and the immutable manifest", () => {
    const entry = {
      canonicalName: name,
      requestedNameSha256,
      relativePath: `skills/${name}/SKILL.md`,
      virtualPath: `/project/skills/${name}/SKILL.md`,
      directoryKind: "directory",
      fileKind: "regular_file",
      symlinkFree: true,
      sizeBytes: 123,
      lineCount: 7,
      rawContentSha256: H("raw"),
      metadataSha256: H("metadata"),
      invocationSha256: H("invocation"),
    };
    const directoryIdentitySetSha256 = H("directories");
    const catalog = binding(
      H(
        canonical({
          directDirectoryCount: 1,
          directoryIdentitySetSha256,
          entries: [entry],
        }),
      ),
    );
    expect(isSkillCatalogBindingV1(catalog)).toBe(true);
    expect(isSkillLoadSelectionV1(selection())).toBe(true);
    const manifest = seal(
      {
        kind: "napier.project-skill-snapshot-manifest",
        schemaVersion: 1,
        source: "project",
        trustOrigin: "active_user_selected_project",
        workspaceIdentitySha256: H("workspace"),
        trustPolicySha256: H("policy"),
        configuredSkillRequests: catalog.configuredSkillRequests,
        selectionSha256: H(canonical(catalog.configuredSkillRequests)),
        directDirectoryCount: 1,
        directoryIdentitySetSha256,
        catalogSha256: catalog.catalogSha256,
        availabilitySetSha256: catalog.availabilitySetSha256,
        entryCount: 1,
        aggregateRawBytes: 123,
        entries: [entry],
        unavailableFailureContentSha256s: [],
        snapshotContentSha256: H("private"),
      },
      "snapshotManifestSha256",
    );
    expect(isProjectSkillSnapshotManifestV1(manifest)).toBe(true);
    expect(
      isProjectSkillSnapshotManifestV1({ ...manifest, aggregateRawBytes: 124 }),
    ).toBe(false);
  });

  it("rejects adversarially resealed relational catalog and manifest drift", () => {
    const catalog = binding();
    const wrongNames = ["data-analysis"];
    const wrongAvailability = H(
      canonical({
        configuredSkillRequests: catalog.configuredSkillRequests,
        loadableSkillNames: wrongNames,
        unavailableFailureContentSha256s: [],
        catalogSha256: catalog.catalogSha256,
      }),
    );
    expect(
      isSkillCatalogBindingV1(
        reseal(
          {
            ...catalog,
            loadableSkillNames: wrongNames,
            availabilitySetSha256: wrongAvailability,
          },
          "contentSha256",
        ),
      ),
    ).toBe(false);

    const failure = unavailableFailure("data-analysis");
    const configuredSkillRequests = [
      {
        position: 0,
        requestedNameSha256,
        canonicalName: name,
        state: "unavailable",
        failureContentSha256: failure.contentSha256,
      },
    ];
    const unavailableAvailability = H(
      canonical({
        configuredSkillRequests,
        loadableSkillNames: [],
        unavailableFailureContentSha256s: [failure.contentSha256],
        catalogSha256: catalog.catalogSha256,
      }),
    );
    expect(
      isSkillCatalogBindingV1(
        seal(
          {
            kind: catalog.kind,
            schemaVersion: catalog.schemaVersion,
            operation: catalog.operation,
            agentToolName: catalog.agentToolName,
            configuredSkillRequests,
            loadableSkillNames: [],
            unavailableSkills: [failure],
            catalogSha256: catalog.catalogSha256,
            availabilitySetSha256: unavailableAvailability,
            snapshotManifestSha256: catalog.snapshotManifestSha256,
          },
          "contentSha256",
        ),
      ),
    ).toBe(false);
  });

  it("projects selected and loaded only from a hash-bound same-Run chain", () => {
    const catalog = binding();
    const selected = selection();
    const loaded = receipt();
    const events = [
      {
        runId: "run_12345678",
        seq: 1,
        type: "context.skills",
        payload: catalog,
      },
      {
        runId: "run_12345678",
        seq: 2,
        type: "tool.started",
        payload: {
          callId: "call_1",
          toolName: "skill_load",
          details: selected,
        },
      },
      {
        runId: "run_12345678",
        seq: 3,
        type: "tool.completed",
        payload: { callId: "call_1", toolName: "skill_load", details: loaded },
      },
    ];
    expect(
      projectSkillApplicationV1(events.slice(0, 2), "run_12345678", {
        canonicalName: name,
      }),
    ).toEqual(expect.objectContaining({ state: "selected", selectedSeq: 2 }));
    expect(
      projectSkillApplicationV1(events, "run_12345678", {
        canonicalName: name,
      }),
    ).toEqual(
      expect.objectContaining({
        state: "loaded",
        terminalSeq: 3,
        receiptContentSha256: loaded.contentSha256,
      }),
    );
    expect(
      projectSkillApplicationV1(events, "run_crossrun", {
        canonicalName: name,
      }),
    ).toBeUndefined();
  });

  it("rejects crossed Skill load lifecycles instead of borrowing a later terminal", () => {
    const catalog = binding();
    const selected = selection();
    const loaded = receipt();
    const events = [
      {
        runId: "run_12345678",
        seq: 1,
        type: "context.skills",
        payload: catalog,
      },
      {
        runId: "run_12345678",
        seq: 2,
        type: "tool.started",
        payload: {
          callId: "call_1",
          toolName: "skill_load",
          details: selected,
        },
      },
      {
        runId: "run_12345678",
        seq: 3,
        type: "tool.started",
        payload: {
          callId: "call_2",
          toolName: "skill_load",
          details: selected,
        },
      },
      {
        runId: "run_12345678",
        seq: 4,
        type: "tool.completed",
        payload: { callId: "call_1", toolName: "skill_load", details: loaded },
      },
      {
        runId: "run_12345678",
        seq: 5,
        type: "tool.completed",
        payload: { callId: "call_2", toolName: "skill_load", details: loaded },
      },
    ];
    expect(
      projectSkillApplicationV1(events, "run_12345678", {
        canonicalName: name,
      }),
    ).toBeUndefined();
  });
});
