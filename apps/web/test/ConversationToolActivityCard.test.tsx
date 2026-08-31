import { parseHTML } from "linkedom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationToolActivityCard } from "../src/ConversationToolActivityCard";
import { ConversationBrowserActivityCard } from "../src/ConversationBrowserActivityCard";
import { ConversationNetworkActivityCard } from "../src/ConversationNetworkActivityCard";
import type { ConversationBrowserActivity } from "../src/conversation-browser-activity-view-model";
import type { ConversationNetworkActivity } from "../src/conversation-network-activity-view-model";
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
  it("renders complete redacted Shell input and output content", async () => {
    const container = installDom();
    await act(async () => {
      render(
        <ConversationToolActivityCard activity={shellActivity()} />,
        container,
      );
    });

    expect(container.textContent).toContain("Command Succeeded");
    expect(container.textContent).not.toContain("Shell · Completed");
    expect(container.querySelector('[aria-label="Completed"]')).not.toBeNull();
    expect(container.querySelector("details")?.hasAttribute("open")).toBe(
      false,
    );
    expect(container.textContent).toContain("Read only");
    expect(container.textContent).toContain("Denied");
    expect(container.textContent).toContain("30s");
    expect(container.textContent).not.toContain("TOP_SECRET");
    expect(container.textContent).toContain("Command");
    expect(container.textContent).toContain('"npm", "test"');
    expect(container.textContent).toContain("STDOUT");
    expect(container.textContent).toContain("12 tests passed");
  });

  it.each(["failed", "blocked"] as const)(
    "keeps %s tool evidence available but collapsed by default",
    async (status) => {
      const container = installDom();
      await act(async () => {
        render(
          <ConversationToolActivityCard
            activity={{ ...shellActivity(), status }}
          />,
          container,
        );
      });

      expect(container.textContent).toContain(
        status === "failed" ? "Command failed" : "Command was blocked safely",
      );
      expect(container.textContent).not.toContain(
        status === "failed" ? "Shell · Failed" : "Shell · Blocked",
      );
      expect(container.querySelector("details")?.hasAttribute("open")).toBe(
        false,
      );
    },
  );

  it("renders completed network evidence as one action phrase", async () => {
    const container = installDom();
    await act(async () => {
      render(
        <ConversationNetworkActivityCard activity={networkActivity()} />,
        container,
      );
    });

    expect(container.textContent).toContain("Found 3 results via brave");
    expect(container.textContent).not.toContain("Web search · Completed");
  });

  it("renders completed Browser evidence as one past-tense action phrase", async () => {
    const container = installDom();
    await act(async () => {
      render(
        <ConversationBrowserActivityCard activity={browserActivity()} />,
        container,
      );
    });

    expect(container.textContent).toContain("Read page");
    expect(container.textContent).not.toContain("Browser · Completed");
  });

  it("renders known workflow tools as natural completed actions", async () => {
    const container = installDom();
    await act(async () => {
      render(
        <ConversationToolActivityCard
          activity={{
            ...shellActivity(),
            kind: "tool",
            toolName: "update_plan_artifact",
          }}
        />,
        container,
      );
    });

    expect(container.textContent).toContain("Updated plan artifact");
    expect(container.textContent).not.toContain(
      "Update plan artifact completed",
    );
  });

  it("renders patch completion as an action instead of a raw tool label", async () => {
    const container = installDom();
    await act(async () => {
      render(
        <ConversationToolActivityCard
          activity={{
            ...shellActivity(),
            kind: "tool",
            toolName: "apply_patch",
          }}
        />,
        container,
      );
    });

    expect(container.textContent).toContain("Applied patch");
    expect(container.textContent).not.toContain("Apply patch completed");
  });
});

function networkActivity(): ConversationNetworkActivity {
  return {
    kind: "search",
    id: "event_search",
    callId: "call_search",
    seq: 3,
    createdAt: "2026-08-09T00:00:03.000Z",
    status: "completed",
    provider: "brave",
    resultCount: 3,
  };
}

function browserActivity(): ConversationBrowserActivity {
  return {
    id: "event_browser",
    callId: "call_browser",
    seq: 4,
    createdAt: "2026-08-09T00:00:04.000Z",
    status: "completed",
    action: "snapshot",
  };
}

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
    display: {
      input: '{\n  "args": ["npm", "test"]\n}',
      output: "12 tests passed",
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
