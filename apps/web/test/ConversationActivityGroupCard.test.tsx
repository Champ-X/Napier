import { parseHTML } from "linkedom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConversationActivityGroup } from "../src/conversation-feed-grouping";
import type { ConversationToolActivity } from "../src/conversation-tool-activity-view-model";

vi.mock("lucide-react", () => {
  const Icon = (props: Record<string, unknown>) => <svg {...props} />;
  return {
    Activity: Icon,
    AlertTriangle: Icon,
    Brain: Icon,
    CheckCircle2: Icon,
    ChevronRight: Icon,
    Clock3: Icon,
    Copy: Icon,
    Globe2: Icon,
    LoaderCircle: Icon,
    MonitorSmartphone: Icon,
    Search: Icon,
    TerminalSquare: Icon,
    Wrench: Icon,
  };
});

let container: HTMLElement | undefined;

afterEach(async () => {
  if (container) await act(async () => render(null, container!));
  container = undefined;
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("ConversationActivityGroupCard disclosure", () => {
  it.each([
    {
      locale: "en",
      label: "Execution",
      summary: "4 steps",
      show: "Show evidence",
      hide: "Hide evidence",
    },
    {
      locale: "zh",
      label: "执行过程",
      summary: "4 步",
      show: "显示证据",
      hide: "隐藏证据",
    },
  ])(
    "opens and closes completed evidence in $locale without remounting it",
    async (copy) => {
      const target = installDom(copy.locale);
      const { ConversationActivityGroupCard } =
        await import("../src/ConversationActivityGroupCard");
      const group = {
        ...activityGroup(),
        label: copy.label,
        summary: copy.summary,
      };
      await act(async () =>
        render(<ConversationActivityGroupCard group={group} />, target),
      );

      const button = target.querySelector("button")!;
      const items = target.querySelector<HTMLElement>(
        ".conversation-activity-group-items",
      )!;
      expect(button.type).toBe("button");
      expect(button.textContent).toContain(copy.label);
      expect(button.textContent).toContain(copy.summary);
      expect(button.textContent).toContain(copy.show);
      expect(button.getAttribute("aria-controls")).toBe(items.id);
      expect(button.getAttribute("aria-expanded")).toBe("false");
      expect(items.hidden).toBe(true);

      await act(async () => button.click());
      expect(button.getAttribute("aria-expanded")).toBe("true");
      expect(button.textContent).toContain(copy.hide);
      expect(items.hidden).toBe(false);
      expect(items.children).toHaveLength(4);
      const firstEvidence = items.querySelector("details")!;
      firstEvidence.setAttribute("open", "");

      await act(async () => button.click());
      expect(items.hidden).toBe(true);
      await act(async () => button.click());
      expect(items.hidden).toBe(false);
      expect(items.querySelector("details")).toBe(firstEvidence);
      expect(firstEvidence.hasAttribute("open")).toBe(true);
    },
  );

  it("keeps a small completed group visible", async () => {
    const target = installDom();
    const { ConversationActivityGroupCard } =
      await import("../src/ConversationActivityGroupCard");
    await act(async () =>
      render(
        <ConversationActivityGroupCard group={activityGroup(3)} />,
        target,
      ),
    );
    expect(target.querySelector("button")).toBeNull();
    expect(
      target.querySelector<HTMLElement>(".conversation-activity-group-items")
        ?.hidden,
    ).toBe(false);
    expect(target.querySelectorAll("details")).toHaveLength(3);
  });

  it.each(["waiting", "takeover"] as const)(
    "keeps a %s interaction visible even when the group has no failed steps",
    async (kind) => {
      const target = installDom();
      const { ConversationActivityGroupCard } =
        await import("../src/ConversationActivityGroupCard");
      const group = activityGroup(3);
      group.items.push(
        kind === "waiting"
          ? {
              kind: "activity",
              seq: 4,
              activity: {
                id: "waiting-4",
                seq: 4,
                type: "operator.input.requested",
                label: "Operator input",
                summary: "Choose how to continue",
                tone: "waiting",
                createdAt: group.createdAt,
                count: 1,
              },
            }
          : {
              kind: "browser",
              seq: 4,
              activity: {
                id: "browser-4",
                callId: "browser-call-4",
                seq: 4,
                createdAt: group.createdAt,
                status: "completed",
                action: "snapshot",
                takeoverRecommended: true,
              },
            },
      );
      await act(async () =>
        render(<ConversationActivityGroupCard group={group} />, target),
      );
      expect(target.querySelector("button")).toBeNull();
      expect(
        target.querySelector<HTMLElement>(".conversation-activity-group-items")
          ?.hidden,
      ).toBe(false);
      expect(target.querySelectorAll("details")).toHaveLength(4);
    },
  );

  it.each(["working", "failed", "blocked"] as const)(
    "reveals a %s update even when the completed group was collapsed",
    async (status) => {
      const target = installDom();
      const { ConversationActivityGroupCard } =
        await import("../src/ConversationActivityGroupCard");
      await act(async () =>
        render(
          <ConversationActivityGroupCard group={activityGroup()} />,
          target,
        ),
      );
      const items = target.querySelector<HTMLElement>(
        ".conversation-activity-group-items",
      )!;
      expect(items.hidden).toBe(true);

      await act(async () =>
        render(
          <ConversationActivityGroupCard group={activityGroup(4, status)} />,
          target,
        ),
      );
      expect(items.hidden).toBe(false);
      expect(target.querySelector("button")).toBeNull();
      expect(target.querySelector("section")?.getAttribute("data-state")).toBe(
        status === "working" ? "running" : "attention",
      );
      expect(items.querySelector(`.status-${status}`)).not.toBeNull();
    },
  );

  it("keeps focused evidence visible when a running group completes", async () => {
    const target = installDom();
    const { ConversationActivityGroupCard } =
      await import("../src/ConversationActivityGroupCard");
    await act(async () =>
      render(
        <ConversationActivityGroupCard group={activityGroup(4, "working")} />,
        target,
      ),
    );
    const items = target.querySelector<HTMLElement>(
      ".conversation-activity-group-items",
    )!;
    const summary = items.querySelector<HTMLElement>("summary")!;
    // Model browser focus: Linkedom omits activeElement and the capture path.
    summary.focus = () => {
      Object.defineProperty(document, "activeElement", {
        configurable: true,
        value: summary,
      });
      items.dispatchEvent(new Event("focus"));
    };
    await act(async () => summary.focus());
    expect(document.activeElement).toBe(summary);

    await act(async () =>
      render(<ConversationActivityGroupCard group={activityGroup()} />, target),
    );
    expect(items.hidden).toBe(false);
    expect(items.querySelector("summary")).toBe(summary);
    expect(document.activeElement).toBe(summary);
    expect(target.querySelector("button")?.getAttribute("aria-expanded")).toBe(
      "true",
    );

    // Safari may leave focus in the evidence when the disclosure is clicked.
    const button = target.querySelector<HTMLButtonElement>("button")!;
    const focusDisclosure = vi.fn(() => {
      Object.defineProperty(document, "activeElement", {
        configurable: true,
        value: button,
      });
    });
    button.focus = focusDisclosure;
    await act(async () => button.click());
    expect(focusDisclosure).toHaveBeenCalledOnce();
    expect(items.hidden).toBe(true);
    expect(document.activeElement).toBe(button);
  });

  it("preserves the chosen expanded state while the same group streams and completes", async () => {
    const target = installDom();
    const { ConversationActivityGroupCard } =
      await import("../src/ConversationActivityGroupCard");
    await act(async () =>
      render(<ConversationActivityGroupCard group={activityGroup()} />, target),
    );
    await act(async () =>
      target.querySelector<HTMLButtonElement>("button")!.click(),
    );
    await act(async () =>
      render(
        <ConversationActivityGroupCard group={activityGroup(5, "working")} />,
        target,
      ),
    );
    const items = target.querySelector<HTMLElement>(
      ".conversation-activity-group-items",
    )!;
    expect(items.hidden).toBe(false);
    expect(items.children).toHaveLength(5);

    await act(async () =>
      render(
        <ConversationActivityGroupCard group={activityGroup(5)} />,
        target,
      ),
    );
    expect(target.querySelector("button")?.getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(items.hidden).toBe(false);

    await act(async () =>
      target.querySelector<HTMLButtonElement>("button")!.click(),
    );
    await act(async () =>
      render(
        <ConversationActivityGroupCard group={activityGroup(6, "working")} />,
        target,
      ),
    );
    expect(items.hidden).toBe(false);
    await act(async () =>
      render(
        <ConversationActivityGroupCard group={activityGroup(6)} />,
        target,
      ),
    );
    expect(target.querySelector("button")?.getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(items.hidden).toBe(true);
  });

  it("reveals live thinking and its transcript when a completed group resumes", async () => {
    const target = installDom();
    const { ConversationActivityGroupCard } =
      await import("../src/ConversationActivityGroupCard");
    const group = activityGroup(3);
    group.items.push({
      kind: "thinking",
      seq: 4,
      activity: {
        id: "thinking-4",
        runId: "run-1",
        seq: 4,
        lastSeq: 4,
        turnSeq: 1,
        createdAt: "2026-10-25T00:00:04.000Z",
        startedAt: "2026-10-25T00:00:04.000Z",
        summaryKind: "continue",
        transcript: "Inspect the retained evidence before continuing.",
      },
    });
    await act(async () =>
      render(<ConversationActivityGroupCard group={group} />, target),
    );
    const items = target.querySelector<HTMLElement>(
      ".conversation-activity-group-items",
    )!;
    expect(items.hidden).toBe(true);

    await act(async () =>
      render(
        <ConversationActivityGroupCard
          group={group}
          activeThinkingId="thinking-4"
        />,
        target,
      ),
    );
    expect(items.hidden).toBe(false);
    expect(target.querySelector("button")).toBeNull();
    expect(target.querySelector("section")?.getAttribute("aria-busy")).toBe(
      "true",
    );
    expect(
      items.querySelector(".conversation-thinking")?.hasAttribute("open"),
    ).toBe(true);
    expect(
      items.querySelector(".conversation-thinking-transcript")?.textContent,
    ).toBe("Inspect the retained evidence before continuing.");
  });
});

function activityGroup(
  count = 4,
  lastStatus: ConversationToolActivity["status"] = "completed",
): ConversationActivityGroup {
  return {
    kind: "activity-group",
    id: "execution:1",
    seq: 1,
    label: "Execution",
    summary: `${count} steps`,
    createdAt: "2026-10-25T00:00:00.000Z",
    attentionCount: lastStatus === "failed" || lastStatus === "blocked" ? 1 : 0,
    items: Array.from({ length: count }, (_, index) => ({
      kind: "tool",
      seq: index + 1,
      activity: {
        id: `tool-${index}`,
        callId: `call-${index}`,
        seq: index + 1,
        createdAt: "2026-10-25T00:00:00.000Z",
        kind: "tool",
        status: index === count - 1 ? lastStatus : "completed",
        toolName: "read_file",
        evidence: {},
        receipt: `Retained tool evidence ${index + 1}`,
        eventIds: [`event-${index}`],
      },
    })),
  };
}

function installDom(locale = "en"): HTMLElement {
  const { document, window } = parseHTML(
    "<!doctype html><html><body><div id=app></div></body></html>",
  );
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: { getItem: () => locale },
  });
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", window.navigator);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("Event", window.Event);
  container = document.getElementById("app") as unknown as HTMLElement;
  return container;
}
