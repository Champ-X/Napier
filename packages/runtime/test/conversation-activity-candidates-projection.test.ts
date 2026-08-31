import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  applyConversationActivityCandidate,
  createConversationActivityCandidate,
  projectConversationActivityCandidates,
} from "../src/conversation-activity-candidates-projection.js";

describe("Conversation Activity Candidates projection", () => {
  it("projects bounded display fields without private payload content", () => {
    const candidate = createConversationActivityCandidate(
      event(1, "operator.decision.requested", {
        decisionId: "decision_fixture0001",
        header: "Choose scope",
        privateQuestion: "PRIVATE_QUESTION",
      }),
    );

    expect(candidate).toEqual(
      expect.objectContaining({
        type: "operator.decision.requested",
        label: "Approval",
        summary: "Choose scope",
        tone: "waiting",
        decisionId: "decision_fixture0001",
      }),
    );
    expect(JSON.stringify(candidate)).not.toContain("PRIVATE_QUESTION");
  });

  it("retains only the latest 256 candidates and applies one event tail", () => {
    const events = Array.from({ length: 258 }, (_value, index) =>
      event(index + 1, "run.no_progress", { private: `PRIVATE_${index}` }),
    );
    const projected = projectConversationActivityCandidates(events);
    let incremental = events
      .slice(0, -1)
      .reduce(applyConversationActivityCandidate, []);
    incremental = applyConversationActivityCandidate(
      incremental,
      events.at(-1)!,
    );

    expect(projected).toEqual(incremental);
    expect(projected).toHaveLength(256);
    expect(projected[0]?.seq).toBe(3);
    expect(projected.at(-1)?.seq).toBe(258);
    expect(JSON.stringify(projected)).not.toContain("PRIVATE_");
  });

  it("leaves progress narration to the dedicated conversation projection", () => {
    expect(
      createConversationActivityCandidate(
        event(1, "run.progress.message", {
          sourceEventId: "event_model_response",
          model: "faux/faux-1",
          toolNames: ["read_file"],
          text: "Inspecting the project.",
        }),
      ),
    ).toBeUndefined();
  });
});

function event(
  seq: number,
  type: string,
  payload: RunEvent["payload"],
): RunEvent {
  return {
    id: `event_${String(seq)}`,
    threadId: "thread_activity",
    runId: "run_activity",
    seq,
    type,
    category: "system",
    visibility: "user",
    createdAt: new Date(1_700_000_000_000 + seq * 1_000).toISOString(),
    payload,
  };
}
