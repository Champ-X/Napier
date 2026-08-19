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

describe("Conversation Ledger recoveries", () => {
  it("renders projected recovery cards without rescanning raw events", async () => {
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

    expect(container.textContent).toContain("Retry · Blocked");
    expect(container.textContent).toContain(
      "Automatic recovery stopped safely",
    );
    expect(container.textContent).toContain(
      "A write or delegated side effect was observed.",
    );
    expect(container.textContent).not.toContain("PRIVATE_RECOVERY_ERROR");
  });
});

function detail(): WebThreadDetail {
  return {
    thread: {
      id: "thread_1",
      title: "Projected recovery",
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
    recoveries: [
      {
        id: "run_interrupted0001",
        seq: 1,
        createdAt: "2026-08-16T00:00:01.000Z",
        status: "skipped",
        assessment: {
          contentSha256: "1".repeat(64),
          interruptedRunId: "run_interrupted0001",
          rootRunId: "run_interrupted0001",
          eligible: false,
          blockReasons: ["unsafe_tool_effect"],
          policy: {
            mode: "safe_read_only",
            maxAttempts: 2,
            backoffMs: 1_000,
          },
          toolCalls: {
            total: 1,
            readOnly: 0,
            unsafe: 1,
            unknownEffect: 0,
            unresolved: 0,
          },
          eventRange: {
            fromSeq: 1,
            toSeq: 1,
            eventCount: 1,
            eventStreamSha256: "2".repeat(64),
          },
          priorAttempts: 0,
          assessedAt: "2026-08-16T00:00:01.000Z",
        },
        eventIds: ["event_recovery"],
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
