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

describe("Conversation Ledger citations", () => {
  it("uses projected citations and suppresses the matching generic Tool card", async () => {
    const container = installDom();
    await act(async () => {
      render(
        <ConversationLedger
          messages={[
            {
              id: "message_1",
              seq: 2,
              role: "assistant",
              text: "Supported. [citation:citation_fixture0001]",
              model: "napier/demo",
              createdAt: "2026-08-16T00:00:02.000Z",
            },
          ]}
          detail={detail()}
          streamingText=""
          endRef={{ current: null }}
          onBranch={() => undefined}
          onLedgerChanged={async () => undefined}
        />,
        container,
      );
    });

    expect(container.textContent).toContain("Citation 1");
    expect(container.textContent).toContain("Web source evidence");
    expect(container.textContent).not.toContain("Research source completed");
    const citationLink = findElementsByLocalName(container, "a").find(
      (link) => link.getAttribute("aria-label") === "Citation 1",
    );
    expect(citationLink?.getAttribute("href")).toBe(
      "#conversation-citation-citation_fixture0001-1",
    );
  });
});

function detail(): WebThreadDetail {
  return {
    thread: {
      id: "thread_1",
      title: "Projected citations",
      agentId: "agent_1",
      status: "idle",
      createdAt: "2026-08-16T00:00:00.000Z",
      updatedAt: "2026-08-16T00:00:02.000Z",
      lastMessage: "Supported.",
      eventCount: 1,
      runIds: ["run_1"],
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
    activityEvents: [
      {
        id: "event_citation",
        threadId: "thread_1",
        runId: "run_1",
        seq: 1,
        type: "tool.completed",
        category: "tool",
        visibility: "user",
        createdAt: "2026-08-16T00:00:01.000Z",
        payload: {
          callId: "call_research",
          toolName: "research_source",
          status: "completed",
        },
      },
    ],
    citations: [
      {
        id: "event_citation",
        seq: 1,
        createdAt: "2026-08-16T00:00:01.000Z",
        callId: "call_research",
        citationId: "citation_fixture0001",
        sourceId: "source_fixture0001",
        sourceKind: "web_fetch",
        startLine: 2,
        endLine: 4,
        sourceContentSha256: "1".repeat(64),
        sourceTitleSha256: "2".repeat(64),
        quoteSha256: "3".repeat(64),
        claimSha256: "4".repeat(64),
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

function findElementsByLocalName(root: Element, localName: string): Element[] {
  const matches: Element[] = [];
  for (const child of Array.from(root.children)) {
    if (typeof child.localName === "string" && child.localName === localName) {
      matches.push(child);
    }
    matches.push(...findElementsByLocalName(child, localName));
  }
  return matches;
}
