import type { AgentProfile, AgentProfileRevision } from "@napier/contracts";
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

import { AgentRevisionCard } from "../src/AgentRevisionCard";
import { AgentRevisionHistory } from "../src/AgentRevisionHistory";
import { AgentRollbackTicket } from "../src/AgentRollbackTicket";
import { agentProfileDelta } from "../src/agent-profile-delta";
import { renderToStaticMarkup } from "./render-static-preact";

describe("Agent revision history", () => {
  it("normalizes equivalent default policies before computing profile drift", () => {
    const current = agent();
    const explicitDefaults = agent({
      automaticRecovery: { mode: "manual", maxAttempts: 2, backoffMs: 5_000 },
      modelAdvisor: {
        mode: "observe",
        enabledRules: [
          "destructive_command_reference",
          "unverified_verification_claim",
        ],
        maxCorrectionAttempts: 0,
      },
      toolLoopGuard: { enabled: true, threshold: 3, exemptTools: [] },
    });

    expect(agentProfileDelta(current, explicitDefaults)).toEqual([]);
  });

  it("reports only semantic fields that changed", () => {
    const current = agent();
    const target = agent({
      name: "Historical Napier",
      model: { provider: "openai", id: "gpt-5" },
      enabledTools: ["read_file", "search_files"],
      automaticRecovery: {
        mode: "safe_read_only",
        maxAttempts: 3,
        backoffMs: 8_000,
      },
    });

    expect(agentProfileDelta(current, target)).toEqual([
      "name",
      "model",
      "enabledTools",
      "automaticRecovery",
    ]);
  });

  it("keeps the current revision non-actionable and invokes rollback review for drift", () => {
    const current = agent();
    const review = vi.fn();
    const currentTree = AgentRevisionCard({
      current,
      revision: revision(current),
      busy: false,
      onReviewRollback: review,
    });
    const historical = revision(agent({ name: "Earlier" }), 1);
    const historicalTree = AgentRevisionCard({
      current,
      revision: historical,
      busy: false,
      onReviewRollback: review,
    });

    expect(renderToStaticMarkup(currentTree)).toContain("disabled");
    const reviewButton = findElement(historicalTree, "button");
    expect(reviewButton?.props["disabled"]).toBe(false);
    (reviewButton?.props["onClick"] as (() => void) | undefined)?.();
    expect(review).toHaveBeenCalledWith(historical);
  });

  it("renders loading, rollback, and settled states without overlapping them", () => {
    const current = agent();
    const target = revision(agent({ description: "Earlier description" }), 1);
    const loading = renderToStaticMarkup(
      AgentRevisionHistory({
        current,
        revisions: [],
        loading: true,
        busy: false,
        rollbackTarget: undefined,
        onReviewRollback: vi.fn(),
        onCancelRollback: vi.fn(),
        onConfirmRollback: vi.fn(),
      }),
    );
    const rollback = renderToStaticMarkup(
      AgentRollbackTicket({
        current,
        target,
        busy: false,
        onCancel: vi.fn(),
        onConfirm: vi.fn(),
      }),
    );

    expect(loading).toContain("Loading configuration history");
    expect(loading).not.toContain("Restore historical configuration");
    expect(rollback).toContain("Restore historical configuration");
    expect(rollback).toContain("Description");
    expect(rollback).not.toContain("Loading configuration history");
  });

  it("owns the complete interaction and accessibility state contract", async () => {
    const css = (
      await Promise.all(
        [
          "agent-revision-history.css",
          "agent-revision-shared.css",
          "agent-revision-card.css",
          "agent-rollback-ticket.css",
        ].map((file) =>
          readFile(new URL(`../src/${file}`, import.meta.url), "utf8"),
        ),
      )
    ).join("\n");

    expect(css).toContain(
      "min-height: calc(var(--control-target-primary) + var(--space-1))",
    );
    expect(css).toContain(":hover:not(:disabled)");
    expect(css).toContain(":active:not(:disabled)");
    expect(css).toContain(":focus-visible");
    expect(css).toContain(":disabled");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("@media (forced-colors: active)");
  });
});

function agent(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: "agent_napier",
    name: "Napier",
    description: "Fixture",
    systemPrompt: "Stay bounded.",
    model: { provider: "faux", id: "faux-1" },
    thinkingLevel: "minimal",
    toolPolicy: "observe",
    enabledTools: ["read_file"],
    enabledSkills: [],
    enabledSubagents: [],
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
    revision: 2,
    ...overrides,
  };
}

function revision(
  profile: AgentProfile,
  revisionNumber = profile.revision,
): AgentProfileRevision {
  return {
    agentId: profile.id,
    revision: revisionNumber,
    profile: { ...profile, revision: revisionNumber },
    changedFields: revisionNumber === profile.revision ? [] : ["name"],
    source: revisionNumber === profile.revision ? "updated" : "created",
    systemPromptSha256: "a".repeat(64),
    createdAt: "2026-08-11T00:00:00.000Z",
    contentSha256: "b".repeat(64),
  };
}

function findElement(
  value: unknown,
  type: string,
): { props: Record<string, unknown> } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const element = value as { type?: unknown; props?: Record<string, unknown> };
  if (element.type === type && element.props) return { props: element.props };
  const children = element.props?.["children"];
  const list = Array.isArray(children) ? children : [children];
  return list.flatMap((child) => findElement(child, type) ?? []).at(0);
}
