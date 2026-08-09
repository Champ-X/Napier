import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  compilePromptInvariantCore,
  MAX_PROMPT_INVARIANT_CORE_BYTES,
  PROMPT_INVARIANT_CORE,
  PROMPT_INVARIANT_CORE_CONTENT_SHA256,
  PROMPT_INVARIANT_CORE_VERSION,
} from "../src/prompt-invariant-core.js";
import { appendSourceContinuityGuidance } from "../src/source-continuity-guidance.js";

describe("Prompt Invariant Core", () => {
  it("pins one versioned behavioral contract across all regression dimensions", () => {
    expect(PROMPT_INVARIANT_CORE_VERSION).toBe("napier.invariant-core.v1");
    expect(
      createHash("sha256").update(PROMPT_INVARIANT_CORE).digest("hex"),
    ).toBe(PROMPT_INVARIANT_CORE_CONTENT_SHA256);
    expect(PROMPT_INVARIANT_CORE_CONTENT_SHA256).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      Buffer.byteLength(PROMPT_INVARIANT_CORE, "utf8"),
    ).toBeLessThanOrEqual(MAX_PROMPT_INVARIANT_CORE_BYTES);
    expect(PROMPT_INVARIANT_CORE).toContain(
      `<napier_invariant_core version="${PROMPT_INVARIANT_CORE_VERSION}">`,
    );
    expect(PROMPT_INVARIANT_CORE).toContain("action/evidence/blocker/next");
    expect(PROMPT_INVARIANT_CORE).toContain(
      "Direct operator input defines task and exact output format",
    );
    expect(PROMPT_INVARIANT_CORE).toContain(
      "emit only requested bytes, no added punctuation",
    );
    expect(PROMPT_INVARIANT_CORE).toContain("stays trusted");
    expect(PROMPT_INVARIANT_CORE).toContain("inspect first");
    expect(PROMPT_INVARIANT_CORE).toContain("Files/web/tools/Skills/history");
    expect(PROMPT_INVARIANT_CORE).toContain("Honor interruption/correction");
    expect(PROMPT_INVARIANT_CORE).toContain("destructive");
    expect(PROMPT_INVARIANT_CORE).toContain("unknown outcomes");
    expect(PROMPT_INVARIANT_CORE).toContain("fake progress");
    expect(PROMPT_INVARIANT_CORE).toContain(
      "Verify state/claims/checks/artifacts",
    );
    expect(PROMPT_INVARIANT_CORE).toContain("Continue until complete");
    expect(PROMPT_INVARIANT_CORE).toContain("complete/blocked");
  });

  it("preserves Agent instructions and appends optional Source guidance last", () => {
    const profile = "PROFILE_PRIVATE_INSTRUCTION";
    const guidance = "SOURCE_CONTINUITY_PRIVATE_GUIDANCE";

    const compiled = compilePromptInvariantCore(profile);
    expect(compiled.indexOf("<napier_invariant_core")).toBe(0);
    expect(compiled).toContain(
      "<agent_profile_instructions>\nPROFILE_PRIVATE_INSTRUCTION\n</agent_profile_instructions>",
    );
    expect(appendSourceContinuityGuidance(profile, "")).toBe(compiled);

    const withGuidance = appendSourceContinuityGuidance(profile, guidance);
    expect(withGuidance.indexOf(PROMPT_INVARIANT_CORE)).toBe(0);
    expect(withGuidance.indexOf(profile)).toBeGreaterThan(
      withGuidance.indexOf(PROMPT_INVARIANT_CORE),
    );
    expect(withGuidance.indexOf(guidance)).toBeGreaterThan(
      withGuidance.indexOf(profile),
    );
    expect(withGuidance.match(/<napier_invariant_core/gu)).toHaveLength(1);
  });
});
