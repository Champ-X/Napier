import { parseHTML } from "linkedom";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EvaluationCasebookQualificationExecution } from "@napier/contracts";

import { CasebookQualificationTrialControl } from "../src/CasebookQualificationTrialControl";

const roots: ReturnType<typeof createRoot>[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await act(async () => root.unmount());
  }
  vi.unstubAllGlobals();
});

describe("Casebook qualification trial control", () => {
  it("runs independent trials sequentially and summarizes the batch", async () => {
    const container = installDom();
    const runTrial = vi
      .fn<() => Promise<EvaluationCasebookQualificationExecution>>()
      .mockResolvedValueOnce(execution("trial-1", "passed", 1))
      .mockResolvedValueOnce(execution("trial-2", "failed", 0.5))
      .mockResolvedValueOnce(execution("trial-3", "passed", 0.75));
    const onExecution = vi.fn();
    const onBusyChange = vi.fn();
    const onSettled = vi.fn(async () => undefined);
    const root = createRoot(container);
    roots.push(root);
    await act(async () =>
      root.render(
        <CasebookQualificationTrialControl
          disabled={false}
          runTrial={runTrial}
          onExecution={onExecution}
          onBusyChange={onBusyChange}
          onSettled={onSettled}
          onError={vi.fn()}
        />,
      ),
    );

    const select = container.querySelector("select")!;
    await act(async () => {
      select.querySelector('option[value="1"]')?.removeAttribute("selected");
      select.querySelector('option[value="3"]')?.setAttribute("selected", "");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const button = container.querySelector("button")!;
    expect(button.textContent).toContain("Run 3 trials");
    await act(async () =>
      button.dispatchEvent(new Event("click", { bubbles: true })),
    );
    await waitFor(() => onSettled.mock.calls.length === 1);

    expect(runTrial).toHaveBeenCalledTimes(3);
    expect(onExecution).toHaveBeenCalledTimes(3);
    expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
    expect(onSettled).toHaveBeenCalledOnce();
    expect(container.textContent).toContain(
      "3/3 completed · 2 passed · 75% mean agreement",
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
  return document.getElementById("app") as HTMLElement;
}

function execution(
  id: string,
  status: "passed" | "failed",
  agreementRate: number,
): EvaluationCasebookQualificationExecution {
  return {
    id,
    status,
    agreementRate,
  } as EvaluationCasebookQualificationExecution;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  }
  throw new Error("Timed out waiting for qualification trials");
}
