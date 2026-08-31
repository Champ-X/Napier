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
        />,
      );
    });

    const trigger = findByAttribute(container, "aria-label", "Agent & Model")!;
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      trigger.dispatchEvent(new Event("click", { bubbles: true }));
    });
    expect(container.textContent).toContain("DeepSeek V4 Flash");
    expect(container.textContent).not.toContain("GPT-4.1");
    const search = findElements(container, "input").find(
      (input) => input.getAttribute("type") === "search",
    )!;
    expect(search.getAttribute("role")).toBe("combobox");
    const activeOptionId = search.getAttribute("aria-activedescendant");
    expect(activeOptionId).toBeTruthy();
    expect(container.querySelector(`[id="${activeOptionId}"]`)).toBeTruthy();
    const option = findElements(container, "button").find((button) =>
      button.textContent?.includes("DeepSeek V4 Flash"),
    )!;
    await act(async () => {
      option.dispatchEvent(new Event("click", { bubbles: true }));
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
        />,
      );
    });

    expect(
      findByAttribute(container, "aria-label", "Agent & Model")?.hasAttribute(
        "disabled",
      ),
    ).toBe(true);
  });

  it("reveals unavailable models explicitly and filters by search", async () => {
    const container = installDom();
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        <WorkbenchHeader
          isRunning={false}
          model={{
            configured: true,
            id: "gpt-5",
            key: "openai/gpt-5",
            provider: "openai",
          }}
          models={[
            model("openai", "gpt-5", "GPT-5", true),
            model("openai", "gpt-4.1", "GPT-4.1", false),
            model("deepseek", "deepseek-v4-flash", "DeepSeek V4 Flash", true),
          ]}
          status="idle"
          title="Thread"
          contextLabel="Conversation"
          onModel={() => undefined}
        />,
      );
    });
    await act(async () => {
      findByAttribute(container, "aria-label", "Agent & Model")?.dispatchEvent(
        new Event("click", { bubbles: true }),
      );
    });

    expect(container.textContent).not.toContain("GPT-4.1");
    const checkbox = findElements(container, "input").find(
      (input) => input.getAttribute("type") === "checkbox",
    ) as HTMLInputElement;
    await act(async () => {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.textContent).toContain("GPT-4.1");

    const search = findElements(container, "input").find(
      (input) => input.getAttribute("type") === "search",
    ) as HTMLInputElement;
    await act(async () => {
      search.value = "deepseek";
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const results = findByAttribute(container, "role", "listbox")!;
    expect(results.textContent).toContain("DeepSeek V4 Flash");
    expect(results.textContent).not.toContain("GPT-5");
    expect(results.textContent).not.toContain("GPT-4.1");
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

function findByAttribute(
  root: Element,
  name: string,
  value: string,
): Element | undefined {
  return allElements(root).find(
    (element) => element.getAttribute(name) === value,
  );
}

function findElements(root: Element, tagName: string): Element[] {
  return allElements(root).filter(
    (element) => String(element.localName).toLowerCase() === tagName,
  );
}

function allElements(root: Element): Element[] {
  const matches: Element[] = [];
  const pending = Array.from(root.childNodes);
  while (pending.length > 0) {
    const node = pending.shift();
    if (!node) continue;
    if (node.nodeType === 1) {
      const element = node as Element;
      matches.push(element);
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
