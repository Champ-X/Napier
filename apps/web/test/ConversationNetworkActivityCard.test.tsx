import { parseHTML } from "linkedom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConversationNetworkActivity } from "../src/conversation-network-activity-view-model";

vi.mock("lucide-react", () => {
  const Icon = (props: Record<string, unknown>) => <svg {...props} />;
  return {
    AlertTriangle: Icon,
    CheckCircle2: Icon,
    Globe2: Icon,
    LoaderCircle: Icon,
    Search: Icon,
  };
});

let container: HTMLElement;

afterEach(async () => {
  if (container) await act(async () => render(null, container));
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe.each(["en", "zh"] as const)(
  "network activity summaries (%s)",
  (locale) => {
    async function renderActivity(activity: ConversationNetworkActivity) {
      vi.resetModules();
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
      container = document.getElementById("app") as unknown as HTMLElement;
      const { ConversationNetworkActivityCard } =
        await import("../src/ConversationNetworkActivityCard");
      await act(async () =>
        render(
          <ConversationNetworkActivityCard activity={activity} />,
          container,
        ),
      );
      return container.querySelector("summary strong")?.textContent ?? "";
    }

    it("shows the result count for normal search and labels image page candidates", async () => {
      const summary = await renderActivity({
        ...search(),
        provider: "firecrawl",
        resultCount: 15,
        category: "images",
        resolutionMode: "image_page_candidates",
      });
      expect(summary).toBe(
        locale === "zh"
          ? "找到 15 个可能含图的网页 · 来源 firecrawl"
          : "Found 15 potential image pages via firecrawl",
      );
      expect(container.textContent).toContain(
        locale === "zh"
          ? "需打开网页获取图片"
          : "open them to obtain the images",
      );
    });

    it("shows image success without treating its description line as text content", async () => {
      const summary = await renderActivity({
        ...fetchActivity(),
        status: "completed",
        format: "image",
        lineCount: 1,
      });
      expect(summary).toBe(locale === "zh" ? "已读取图片" : "Fetched image");
      expect(container.querySelector("dl")?.textContent).not.toContain(
        locale === "zh" ? "行数" : "Lines",
      );
    });

    it.each([
      ["timeout", "请求超时", "Request timed out"],
      ["network", "网络连接失败", "Network connection failed"],
      ["circuit_open", "已暂缓该次请求", "This request was deferred"],
      ["policy", "请求已被访问策略阻止", "Request blocked by access policy"],
      ["session_state", "浏览器会话不可用", "Browser session unavailable"],
    ] as const)(
      "explains %s and retains the original diagnostic",
      async (failureClass, zh, en) => {
        const summary = await renderActivity({
          ...fetchActivity(),
          failureClass,
          display: { error: "original diagnostic" },
        });
        expect(summary).toContain(locale === "zh" ? zh : en);
        if (failureClass !== "session_state")
          expect(summary).not.toMatch(/浏览器|Browser/);
        expect(container.textContent).toContain("original diagnostic");
        expect(container.querySelector("details")?.className).toContain(
          "status-failed",
        );
      },
    );

    it("makes retained results available when summary metadata is missing", async () => {
      const summary = await renderActivity({
        ...search(),
        display: { output: "retained search results" },
      });
      expect(summary).toBe(
        locale === "zh"
          ? "搜索已完成 · 展开查看结果"
          : "Search completed · expand to view results",
      );
      expect(container.textContent).toContain("retained search results");
      expect(summary).not.toMatch(/证据不可用|evidence unavailable/);
    });

    it("does not confuse missing summary metadata with a failed operation", async () => {
      const summary = await renderActivity(search());
      expect(summary).toBe(
        locale === "zh"
          ? "搜索已完成 · 摘要信息暂不可用"
          : "Search completed · summary unavailable",
      );
      expect(container.querySelector("details")?.className).toContain(
        "status-completed",
      );
    });
  },
);

function search(): ConversationNetworkActivity {
  return {
    kind: "search",
    id: "event_search",
    callId: "call_search",
    seq: 1,
    createdAt: "2026-09-07T14:46:57.186Z",
    status: "completed",
  };
}

function fetchActivity(): ConversationNetworkActivity {
  return {
    kind: "fetch",
    id: "event_fetch",
    callId: "call_fetch",
    seq: 2,
    createdAt: "2026-09-07T14:47:48.000Z",
    status: "failed",
    action: "fetch",
  };
}
