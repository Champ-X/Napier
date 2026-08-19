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

describe("Conversation Ledger plans", () => {
  it("renders projected Plan cards and excludes their generic candidates", async () => {
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

    expect(container.textContent).toContain("Current Plan · Active · r2");
    expect(container.textContent).toContain("Current · Run verification");
    expect(container.textContent).toContain("Deliver a verified handoff");
    expect(container.textContent).not.toContain("Plan created");
    expect(container.textContent).not.toContain("PRIVATE_");
  });
});

function detail(): WebThreadDetail {
  return {
    thread: {
      id: "thread_1",
      title: "Projected Plan",
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
    conversationPlans: [
      {
        id: "event_plan",
        seq: 1,
        createdAt: "2026-08-16T00:00:01.000Z",
        attemptScope: "current",
        plan: {
          id: "plan_fixture0001",
          status: "active",
          revision: 2,
          objective: "Deliver a verified handoff",
          steps: [
            {
              id: "step_inspect",
              title: "Inspect workspace",
              status: "completed",
              evidenceRecorded: true,
            },
            {
              id: "step_verify",
              title: "Run verification",
              status: "running",
              evidenceRecorded: false,
            },
          ],
          activePhaseIndex: 0,
          phaseCount: 1,
        },
        completedStepCount: 1,
        settledStepCount: 1,
        runningStep: {
          id: "step_verify",
          title: "Run verification",
          status: "running",
          evidenceRecorded: false,
        },
        verifiedArtifactCount: 0,
        producedArtifactCount: 0,
        missingArtifactCount: 0,
      },
    ],
    activityCandidates: [
      {
        id: "event_plan",
        seq: 1,
        type: "plan.created",
        label: "Plan",
        summary: "Plan created",
        tone: "info",
        createdAt: "2026-08-16T00:00:01.000Z",
        planId: "plan_fixture0001",
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
