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

describe("Conversation Ledger activity candidates", () => {
  it("renders bounded generic activity without rescanning raw events", async () => {
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

    expect(container.textContent).toContain("Run no progress");
    expect(container.textContent).not.toContain("PRIVATE_EVENT");
  });
});

function detail(): WebThreadDetail {
  return {
    thread: {
      id: "thread_1",
      title: "Projected activity",
      agentId: "agent_1",
      status: "idle",
      createdAt: "2026-08-16T00:00:00.000Z",
      updatedAt: "2026-08-16T00:00:02.000Z",
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
    activityCandidates: [
      {
        id: "event_activity",
        seq: 1,
        type: "run.no_progress",
        label: "Run",
        summary: "Run no progress",
        tone: "info",
        createdAt: "2026-08-16T00:00:01.000Z",
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
