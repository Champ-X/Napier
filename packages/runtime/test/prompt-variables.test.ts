import type { PromptVariableDefinition, RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { canonicalJson, sha256 } from "../src/ed25519.js";
import {
  createPromptVariableCatalog,
  formatCurrentDateVariable,
  normalizePromptVariableDefinitions,
  projectPromptVariableSnapshots,
  PROMPT_VARIABLES_RESOLVED_EVENT,
  resolvePromptVariables,
} from "../src/prompt-variables.js";

describe("Prompt variables", () => {
  it("normalizes a strict canonical definition catalog", () => {
    const definitions: PromptVariableDefinition[] = [
      { name: "skills", type: "skill_catalog" },
      { name: "context", type: "literal", value: "  first\r\nsecond  " },
      { name: "today", type: "current_date", format: "iso-date" },
    ];

    expect(normalizePromptVariableDefinitions(definitions)).toEqual([
      { name: "context", type: "literal", value: "first\nsecond" },
      { name: "skills", type: "skill_catalog" },
      { name: "today", type: "current_date", format: "iso-date" },
    ]);
    expect(createPromptVariableCatalog(definitions).contentSha256).toBe(
      createPromptVariableCatalog([...definitions].reverse()).contentSha256,
    );
    expect(() =>
      normalizePromptVariableDefinitions([
        {
          name: "context",
          type: "literal",
          value: "value",
          unexpected: true,
        } as PromptVariableDefinition,
      ]),
    ).toThrow("fields are invalid");
    expect(() =>
      normalizePromptVariableDefinitions([
        { name: "same", type: "literal", value: "one" },
        { name: "same", type: "literal", value: "two" },
      ]),
    ).toThrow("distinct");
    expect(() =>
      normalizePromptVariableDefinitions([
        { name: "oversized", type: "literal", value: "x".repeat(4_097) },
      ]),
    ).toThrow("literal value is invalid");
  });

  it("resolves declared tokens once and freezes only hash evidence", () => {
    const resolvedAt = new Date(2026, 6, 28, 12, 30, 15);
    const result = resolvePromptVariables({
      systemPrompt:
        "Today {{ today }}.\n{{skills}}\nContext: {{context}}\nKeep {{missing}}.",
      definitions: [
        { name: "today", type: "current_date", format: "iso-date" },
        { name: "skills", type: "skill_catalog" },
        { name: "context", type: "literal", value: "{{today}}" },
      ],
      skillCatalogText: "<available_skills>catalog</available_skills>",
      resolvedAt,
    });

    expect(result.renderedSystemPrompt).toBe(
      "Today 2026-07-28.\n<available_skills>catalog</available_skills>\nContext: {{today}}\nKeep {{missing}}.",
    );
    expect(result.snapshot).toEqual(
      expect.objectContaining({
        resolvedAt: resolvedAt.toISOString(),
        definitionCount: 3,
        referencedVariableCount: 3,
        referenceCount: 4,
        unresolvedReferenceCount: 1,
        skillCatalogInjected: true,
      }),
    );
    expect(result.snapshot.entries).toEqual([
      expect.objectContaining({
        name: "context",
        type: "literal",
        referenceCount: 1,
      }),
      expect.objectContaining({
        name: "skills",
        type: "skill_catalog",
        referenceCount: 1,
      }),
      expect.objectContaining({
        name: "today",
        type: "current_date",
        referenceCount: 1,
      }),
    ]);
    const receipt = JSON.stringify(result.snapshot);
    expect(receipt).not.toContain("<available_skills>");
    expect(receipt).not.toContain("{{today}}");
    expect(receipt).not.toContain("{{missing}}");
    expect(result.snapshot.contentSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.snapshot.renderedSystemPromptSha256).toMatch(
      /^[a-f0-9]{64}$/u,
    );
  });

  it("validates snapshot hashes and canonical timestamps during projection", () => {
    const snapshot = resolvePromptVariables({
      systemPrompt: "Date: {{today}}",
      definitions: [
        { name: "today", type: "current_date", format: "readable-date" },
      ],
      skillCatalogText: "",
      resolvedAt: new Date(2026, 6, 28, 12),
    }).snapshot;
    const event: RunEvent = {
      id: "event_prompt_variables",
      threadId: "thread_prompt_variables",
      runId: "run_prompt_variables",
      seq: 1,
      type: PROMPT_VARIABLES_RESOLVED_EVENT,
      category: "system",
      visibility: "debug",
      payload: snapshot,
      createdAt: "2026-07-28T12:00:00.000Z",
    };

    expect(projectPromptVariableSnapshots([event])).toEqual([snapshot]);
    expect(
      projectPromptVariableSnapshots([
        {
          ...event,
          payload: { ...snapshot, contentSha256: "0".repeat(64) },
        },
      ]),
    ).toEqual([]);
    const { contentSha256: _contentSha256, ...snapshotContent } = snapshot;
    const impossibleContent = {
      ...snapshotContent,
      skillCatalogInjected: !snapshot.skillCatalogInjected,
    };
    expect(
      projectPromptVariableSnapshots([
        {
          ...event,
          payload: {
            ...impossibleContent,
            contentSha256: sha256(canonicalJson(impossibleContent)),
          },
        },
      ]),
    ).toEqual([]);
    expect(
      projectPromptVariableSnapshots([
        {
          ...event,
          payload: {
            ...snapshot,
            resolvedAt: snapshot.resolvedAt.replace(".000Z", "Z"),
          },
        },
      ]),
    ).toEqual([]);
  });

  it("renders bounded local date formats", () => {
    const date = new Date(2026, 6, 28, 9, 8, 7);
    expect(formatCurrentDateVariable("iso-date", date)).toBe("2026-07-28");
    expect(formatCurrentDateVariable("readable-date", date)).toContain(
      "2026-07-28",
    );
    expect(formatCurrentDateVariable("local-date-time", date)).toMatch(
      /^2026-07-28 09:08:07 [+-]\d{2}:\d{2} \(.+\)$/u,
    );
  });
});
