import { parseHTML } from "linkedom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationToolActivityCard } from "../src/ConversationToolActivityCard";
import type { ConversationToolActivity } from "../src/conversation-tool-activity-view-model";

const containers: HTMLElement[] = [];

afterEach(async () => {
  await Promise.all(
    containers.splice(0).map(async (container) => {
      await act(async () => render(null, container));
    }),
  );
  vi.unstubAllGlobals();
});

describe("ConversationToolActivityCard", () => {
  it("renders bounded Shell evidence without private command content", async () => {
    const container = installDom();
    await act(async () => {
      render(
        <ConversationToolActivityCard activity={shellActivity()} />,
        container,
      );
    });

    expect(container.textContent).toContain("Shell · completed");
    expect(container.textContent).toContain("Command Succeeded");
    expect(container.textContent).toContain("Read only");
    expect(container.textContent).toContain("Denied");
    expect(container.textContent).toContain("30s");
    expect(container.textContent).not.toContain("TOP_SECRET");
  });
});

function shellActivity(): ConversationToolActivity {
  return {
    id: "event_shell",
    callId: "call_shell",
    seq: 2,
    createdAt: "2026-08-09T00:00:02.000Z",
    kind: "shell",
    status: "completed",
    toolName: "run_command",
    evidence: {
      effect: "read",
      commandRuntime: "node",
      commandStatus: "succeeded",
      commandArgumentCount: 2,
      commandExitCode: 0,
      commandTimeoutMs: 30_000,
      commandWorkspaceAccess: "read_only",
      commandNetworkAccess: "denied",
      commandSha256: "a".repeat(64),
      commandResultSha256: "b".repeat(64),
    },
    receipt:
      "tool / run_command / completed / command aaaaaaaaaaaa / result bbbbbbbbbbbb",
    eventIds: ["event_1", "event_shell"],
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
