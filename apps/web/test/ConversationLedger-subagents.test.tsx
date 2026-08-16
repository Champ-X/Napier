import { parseHTML } from "linkedom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WebThreadDetail } from "../src/api";
import { ConversationLedger } from "../src/ConversationLedger";

const containers: HTMLElement[] = [];

afterEach(async () => {
  await Promise.all(
    containers.splice(0).map(async (container) => {
      await act(async () => render(null, container));
    }),
  );
  vi.unstubAllGlobals();
});

describe("Conversation Ledger subagents", () => {
  it("renders projected task summaries without raw task or evidence details", async () => {
    const container = installDom();
    await act(async () => {
      render(
        <ConversationLedger
          messages={[]}
          detail={detail()}
          streamingText=""
          endRef={{ current: null }}
          onBranch={() => undefined}
          onLedgerChanged={async () => undefined}
        />,
        container,
      );
    });

    expect(container.textContent).toContain("Subagent · reviewer · completed");
    expect(container.textContent).toContain("Review release evidence");
    expect(container.textContent).toContain("One blocker remains.");
    expect(container.textContent).toContain("Missing release proof");
    expect(container.textContent).toContain("1 evidence · details hidden");
    expect(container.textContent).not.toContain("PRIVATE_");
  });
});

function detail(): WebThreadDetail {
  return {
    thread: {
      id: "thread_1",
      title: "Projected subagent",
      agentId: "agent_1",
      status: "idle",
      createdAt: "2026-08-16T00:00:00.000Z",
      updatedAt: "2026-08-16T00:00:01.000Z",
      lastMessage: "",
      eventCount: 0,
      runIds: [],
    },
    agent: {
      id: "agent_1",
      name: "Agent",
      description: "",
      systemPrompt: "",
      model: { provider: "napier", id: "demo" },
      thinkingLevel: "off",
      toolPolicy: "observe",
      enabledTools: [],
      enabledSkills: [],
      revision: 1,
      createdAt: "2026-08-16T00:00:00.000Z",
      updatedAt: "2026-08-16T00:00:00.000Z",
    },
    runs: [],
    plans: [],
    evaluations: [],
    evaluationAdjudications: [],
    evaluationReviewerBallots: [],
    evaluationConsensusResolutions: [],
    evaluationSuites: [],
    evaluationSuiteExecutions: [],
    automaticRecoveryAssessments: [],
    automaticRecoveryAttempts: [],
    subagents: [],
    runControlMessages: [],
    operatorDecisions: [],
    contextCheckpointCalibration:
      {} as WebThreadDetail["contextCheckpointCalibration"],
    subagentCards: [
      {
        id: "event_subagent",
        seq: 1,
        createdAt: "2026-08-16T00:00:01.000Z",
        task: {
          id: "task_fixture0001",
          role: "reviewer",
          description: "Review release evidence",
          status: "completed",
          model: { provider: "napier", id: "demo" },
          stepCount: 2,
          turnCount: 1,
          usage: { inputTokens: 100, outputTokens: 20 },
          stopReason: "completed",
          outcome: {
            summary: "One blocker remains.",
            items: [
              {
                kind: "risk",
                severity: "blocker",
                title: "Missing release proof",
                evidenceCount: 1,
              },
            ],
          },
        },
        itemCount: 1,
        evidenceCount: 1,
        unknownCount: 0,
        blockerCount: 1,
        warningCount: 0,
      },
    ],
    events: [],
  };
}

function installDom(): HTMLElement {
  const { document, window } = parseHTML(
    "<!doctype html><html><body><div id=app></div></body></html>",
  );
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", window.navigator);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("Event", window.Event);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.getElementById("app") as unknown as HTMLElement;
  containers.push(container);
  return container;
}
