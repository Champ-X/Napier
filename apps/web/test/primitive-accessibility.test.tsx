import { readFile } from "node:fs/promises";

import { parseHTML } from "linkedom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DisclosureRow } from "../src/ui/primitives/DisclosureRow";

// WEB-UI-012: shared accessibility contract for the primitives that actually
// ship today — DisclosureRow and the unified ContextInspector. These tests
// guard keyboard operability, native focus semantics, focus-visible tokens,
// focus return, and the forced-colors / reduced-motion CSS affordances that
// design §11.2 and §18.3 require. They touch only tests (design §10.4).

const containers: HTMLElement[] = [];

afterEach(async () => {
  await Promise.all(
    containers.splice(0).map(async (container) => {
      await act(async () => render(null, container));
    }),
  );
  vi.unstubAllGlobals();
  vi.resetModules();
});

const literalColor = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/iu;

describe("DisclosureRow accessibility", () => {
  it("exposes a native button so Enter and Space operate it via the platform", async () => {
    const container = installDom();
    await act(async () => {
      render(
        <DisclosureRow
          id="tool-1"
          title="run_command"
          status="running"
          open={false}
          onToggle={() => {}}
        >
          <p>detail</p>
        </DisclosureRow>,
        container,
      );
    });

    const button = container.querySelector(
      ".disclosure-row-summary",
    ) as HTMLButtonElement;
    // A real <button> is keyboard-operable without extra key handlers, and it is
    // never removed from the tab order while it can be activated.
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.hasAttribute("tabindex")).toBe(false);
    expect(button.disabled).toBe(false);
  });

  it("keeps decorative glyphs out of the accessibility tree", async () => {
    const container = installDom();
    await act(async () => {
      render(
        <DisclosureRow
          id="tool-2"
          title="web_fetch"
          summary="已完成"
          status="success"
          icon={<svg />}
          open={true}
          onToggle={() => {}}
        >
          <p>detail</p>
        </DisclosureRow>,
        container,
      );
    });

    const caret = container.querySelector(".disclosure-row-caret");
    const icon = container.querySelector(".disclosure-row-icon");
    expect(caret?.getAttribute("aria-hidden")).toBe("true");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
  });

  it("declares focus-visible, reduced-motion and forced-colors affordances via tokens", async () => {
    const css = await readFile(
      new URL(
        "../src/ui/primitives/DisclosureRow/DisclosureRow.css",
        import.meta.url,
      ),
      "utf8",
    );

    expect(css).toContain(".disclosure-row-summary:focus-visible");
    expect(css).toContain("var(--color-focus-ring)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("@media (forced-colors: active)");
    // Forced-colors mode must fall back to system keywords, not brand tokens.
    expect(css).toContain("outline: var(--control-focus-width) solid Highlight");
    expect(css).not.toMatch(literalColor);
  });
});

describe("ContextInspector accessibility", () => {
  it("marks the region as programmatically focusable and returns focus to the opener on close", async () => {
    const container = installDom();
    const { ContextInspector } = await import("../src/ContextInspector");
    const trigger = document.getElementById("opener") as HTMLElement;
    let openerFocused = 0;
    trigger.focus = () => {
      openerFocused += 1;
    };
    Object.defineProperty(document, "activeElement", {
      configurable: true,
      value: trigger,
    });

    await act(async () => {
      render(
        <ContextInspector
          object={{
            id: "evt-1",
            type: "event",
            title: "助手结果",
            content: <p>正文</p>,
          }}
          onClose={() => {}}
        />,
        container,
      );
    });

    const region = container.querySelector(".context-inspector") as HTMLElement;
    // The region is programmatically focusable but not a manual tab stop, so
    // opening it does not add a stray tab position (design §11.2).
    expect(region.tabIndex).toBe(-1);

    // Clearing the object restores focus to whatever opened the column (§18.3).
    await act(async () => {
      render(
        <ContextInspector object={undefined} onClose={() => {}} />,
        container,
      );
    });
    expect(openerFocused).toBe(1);
  });

  it("gives the pin and close controls discernible names and pressed state", async () => {
    const container = installChineseDom();
    const { ContextInspector } = await import("../src/ContextInspector");
    await act(async () => {
      render(
        <ContextInspector
          object={{
            id: "evt-1",
            type: "event",
            title: "事件",
            content: <p>正文</p>,
          }}
          pinned={false}
          onTogglePin={() => {}}
          onClose={() => {}}
        />,
        container,
      );
    });

    const pin = container.querySelector(
      ".context-inspector-pin",
    ) as HTMLButtonElement;
    const close = container.querySelector(
      ".context-inspector-close",
    ) as HTMLButtonElement;
    expect(pin.tagName).toBe("BUTTON");
    expect(pin.getAttribute("type")).toBe("button");
    expect(pin.getAttribute("aria-pressed")).toBe("false");
    expect(pin.getAttribute("aria-label")).toBe("固定该对象");
    expect(close.getAttribute("aria-label")).toBe("关闭检查器");
  });

  it("declares focus-visible and forced-colors affordances via tokens", async () => {
    const css = await readFile(
      new URL("../src/styles/context-inspector.css", import.meta.url),
      "utf8",
    );

    expect(css).toContain(".context-inspector:focus-visible");
    expect(css).toContain("var(--color-focus-ring)");
    expect(css).toContain("@media (forced-colors: active)");
    expect(css).toContain("solid Highlight");
    expect(css).not.toMatch(literalColor);
  });
});

function installDom(): HTMLElement {
  const { document, window } = parseHTML(
    "<!doctype html><html><body><button id=opener>Open</button><div id=app></div></body></html>",
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

function installChineseDom(): HTMLElement {
  vi.resetModules();
  const { document, window } = parseHTML(
    "<!doctype html><html><body><button id=opener>Open</button><div id=app></div></body></html>",
  );
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: { getItem: () => "zh" },
  });
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
