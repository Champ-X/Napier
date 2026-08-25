import type { ModelSummary } from "@napier/contracts";
import { parseHTML } from "linkedom";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkbenchHeader } from "../src/WorkbenchHeader";

const roots: ReturnType<typeof createRoot>[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await act(async () => root.unmount());
  }
  vi.unstubAllGlobals();
});

describe("Workbench header model selection", () => {
  it("selects configured live models without exposing unavailable options", async () => {
    const container = installDom();
    const onModel = vi.fn();
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        <WorkbenchHeader
          isRunning={false}
          model={{
            configured: true,
            id: "demo",
            key: "napier/demo",
            provider: "napier",
          }}
          models={[
            model("napier", "demo", "Deterministic demo", true),
            model("deepseek", "deepseek-v4-flash", "DeepSeek V4 Flash", true),
            model("openai", "gpt-4.1", "GPT-4.1", false),
          ]}
          status="idle"
          title="Thread"
          contextLabel="Conversation"
          onModel={onModel}
          onOpenSettings={() => undefined}
        />,
      );
    });

    const select = findElement(container, "select")!;
    expect(select.getAttribute("aria-label")).toBe("Agent & Model");
    expect(optionValues(select)).toEqual([
      "napier/demo",
      "deepseek/deepseek-v4-flash",
    ]);
    await act(async () => {
      const options = findElements(select, "option");
      options
        .find((option) => option.getAttribute("value") === "napier/demo")
        ?.removeAttribute("selected");
      options
        .find(
          (option) =>
            option.getAttribute("value") === "deepseek/deepseek-v4-flash",
        )
        ?.setAttribute("selected", "");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onModel).toHaveBeenCalledWith("deepseek/deepseek-v4-flash");
  });

  it("locks the selector while a run is active", async () => {
    const container = installDom();
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        <WorkbenchHeader
          isRunning
          model={{
            configured: true,
            id: "deepseek-v4-flash",
            key: "deepseek/deepseek-v4-flash",
            provider: "deepseek",
          }}
          models={[
            model("deepseek", "deepseek-v4-flash", "DeepSeek V4 Flash", true),
          ]}
          status="running"
          title="Thread"
          contextLabel="Conversation"
          onModel={() => undefined}
          onOpenSettings={() => undefined}
        />,
      );
    });

    expect(findElement(container, "select")?.hasAttribute("disabled")).toBe(
      true,
    );
  });
});

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
  return document.getElementById("app") as unknown as HTMLElement;
}

function optionValues(select: Element): string[] {
  return findElements(select, "option").map(
    (option) => option.getAttribute("value") ?? "",
  );
}

function findElement(root: Element, tagName: string): Element | undefined {
  return findElements(root, tagName)[0];
}

function findElements(root: Element, tagName: string): Element[] {
  const matches: Element[] = [];
  const pending = Array.from(root.childNodes);
  while (pending.length > 0) {
    const node = pending.shift();
    if (!node) continue;
    if (node.nodeType === 1) {
      const element = node as Element;
      if (String(element.localName).toLowerCase() === tagName) {
        matches.push(element);
      }
    }
    pending.push(...Array.from(node.childNodes));
  }
  return matches;
}

function model(
  provider: string,
  id: string,
  name: string,
  configured: boolean,
): ModelSummary {
  return {
    provider,
    providerName: provider,
    id,
    name,
    contextWindow: 100_000,
    reasoning: true,
    vision: false,
    configured,
  };
}
