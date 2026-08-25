import { parseHTML } from "linkedom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DisclosureRow } from "../src/ui/primitives/DisclosureRow";

const containers: HTMLElement[] = [];

afterEach(async () => {
  await Promise.all(
    containers.splice(0).map(async (container) => {
      await act(async () => render(null, container));
    }),
  );
  vi.unstubAllGlobals();
});

describe("DisclosureRow", () => {
  it("wires the summary control to a labelled region and reflects open state", async () => {
    const container = installDom();
    await act(async () => {
      render(
        <DisclosureRow
          id="tool-1"
          title="run_command"
          summary="Command 已完成"
          status="success"
          statusLabel="已完成"
          meta="30s"
          open={true}
          onToggle={() => {}}
        >
          <p>evidence</p>
        </DisclosureRow>,
        container,
      );
    });

    const button = container.querySelector(
      ".disclosure-row-summary",
    ) as HTMLButtonElement;
    const region = container.querySelector(
      ".disclosure-row-region",
    ) as HTMLElement;
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.getAttribute("aria-controls")).toBe("tool-1-region");
    expect(region.getAttribute("aria-labelledby")).toBe("tool-1-summary");
    expect(region.hasAttribute("hidden")).toBe(false);
    expect(container.querySelector(".disclosure-row")?.getAttribute("data-open")).toBe(
      "true",
    );
    expect(container.textContent).toContain("run_command");
    expect(container.textContent).toContain("已完成");
    expect(container.textContent).toContain("30s");
  });

  it("hides the region and requests the next open state on activation", async () => {
    const container = installDom();
    const toggled: boolean[] = [];
    await act(async () => {
      render(
        <DisclosureRow
          id="tool-2"
          title="web_fetch"
          status="running"
          open={false}
          onToggle={(next) => toggled.push(next)}
        >
          <p>detail</p>
        </DisclosureRow>,
        container,
      );
    });

    const button = container.querySelector(
      ".disclosure-row-summary",
    ) as HTMLButtonElement;
    const region = container.querySelector(
      ".disclosure-row-region",
    ) as HTMLElement;
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(region.hasAttribute("hidden")).toBe(true);

    await act(async () => {
      button.click();
    });
    expect(toggled).toEqual([true]);
  });

  it("renders a static, non-expandable summary when no children are provided", async () => {
    const container = installDom();
    await act(async () => {
      render(
        <DisclosureRow
          id="tool-3"
          title="plan"
          open={false}
          onToggle={() => {}}
        />,
        container,
      );
    });

    const button = container.querySelector(
      ".disclosure-row-summary",
    ) as HTMLButtonElement;
    expect(button.hasAttribute("aria-expanded")).toBe(false);
    expect(button.disabled).toBe(true);
    expect(container.querySelector(".disclosure-row-region")).toBeNull();
  });

  it("disables the control and keeps the region hidden when disabled", async () => {
    const container = installDom();
    await act(async () => {
      render(
        <DisclosureRow
          id="tool-4"
          title="shell"
          open={true}
          disabled={true}
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
    const region = container.querySelector(
      ".disclosure-row-region",
    ) as HTMLElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(region.hasAttribute("hidden")).toBe(true);
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
  const container = document.getElementById("app") as unknown as HTMLElement;
  containers.push(container);
  return container;
}
