import type { MemoryFact } from "@napier/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MemoryCard } from "../src/MemoryCards";

describe("MemoryCard provenance", () => {
  it("renders task, source-message, reason, difference, and repository evidence", () => {
    const markup = renderToStaticMarkup(
      <MemoryCard memory={memory()} actions={[]} onReview={vi.fn()} />,
    );

    expect(markup).toContain("Ship verified changes");
    expect(markup).toContain("2 messages");
    expect(markup).toContain("Useful across future release work.");
    expect(markup).toContain("Adds a new release constraint.");
    expect(markup).toContain("Verified workspace snapshot");
    expect(markup).toContain("aaaaaaaaaa");
  });

  it("keeps legacy memories readable without inventing provenance", () => {
    const legacy = memory();
    legacy.source = { type: "manual", threadId: "thread_example" };
    const markup = renderToStaticMarkup(
      <MemoryCard memory={legacy} actions={[]} onReview={vi.fn()} />,
    );

    expect(markup.match(/Not recorded/g)?.length).toBeGreaterThanOrEqual(3);
    expect(markup).toContain("No verified workspace snapshot linked");
  });
});

function memory(): MemoryFact {
  return {
    id: "memory_example1",
    content: "Release checks must pass before deployment.",
    category: "constraint",
    scope: "workspace",
    status: "proposed",
    confidence: 0.95,
    source: {
      type: "conversation",
      threadId: "thread_example",
      runId: "run_example",
      taskTitle: "Ship verified changes",
      messageIds: ["event_1", "event_2"],
      persistenceReason: "Useful across future release work.",
      differenceSummary: "Adds a new release constraint.",
      repositoryEvidence: {
        status: "linked",
        eventId: "event_3",
        eventSeq: 3,
        workspaceSnapshotSha256: "a".repeat(64),
        capturedAt: "2026-08-27T00:00:03.000Z",
      },
    },
    reviewIntervalDays: 90,
    useCount: 0,
    revision: 1,
    createdAt: "2026-08-27T00:00:04.000Z",
    updatedAt: "2026-08-27T00:00:04.000Z",
  };
}
