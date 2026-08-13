import { parseHTML } from "linkedom";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  EvaluationCasebook,
  EvaluationCasebookCase,
} from "@napier/contracts";
import type { EvaluationCasebookTemplate } from "@napier/contracts/evaluation-casebook-template";

import {
  EvaluationCasebookTemplateCoverage,
  EvaluationCasebookTemplateCreateButton,
} from "../src/EvaluationCasebookTemplateControl";

const roots: ReturnType<typeof createRoot>[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await act(async () => root.unmount());
  }
  vi.unstubAllGlobals();
});

describe("Evaluation Casebook template controls", () => {
  it("creates the release template and exposes fixed coverage slots", async () => {
    const container = installDom();
    const onCreate = vi.fn();
    const onSelect = vi.fn();
    const onUseTaskPrompt = vi.fn();
    const root = createRoot(container);
    roots.push(root);
    await act(async () =>
      root.render(
        <>
          <EvaluationCasebookTemplateCreateButton
            template={template}
            disabled={false}
            creating={false}
            onCreate={onCreate}
          />
          <EvaluationCasebookTemplateCoverage
            casebook={
              {
                id: "casebook_release0001",
                templateId: template.id,
              } as EvaluationCasebook
            }
            cases={[
              {
                id: "evalcase_settings0001",
                templateCaseId: "settings",
              } as EvaluationCasebookCase,
            ]}
            template={template}
            selectedCaseId="browser"
            disabled={false}
            onSelect={onSelect}
            onUseTaskPrompt={onUseTaskPrompt}
          />
        </>,
      ),
    );

    expect(container.textContent).toContain("Release Product Casebook");
    expect(container.textContent).toContain("1/2");
    expect(container.textContent).toContain("Replace · Settings and setup");
    expect(container.textContent).toContain("Open · Dynamic Browser");
    const button = container.firstElementChild as HTMLElement;
    await act(async () =>
      button.dispatchEvent(new Event("click", { bubbles: true })),
    );
    expect(onCreate).toHaveBeenCalledOnce();

    const coverage = container.lastElementChild!;
    const select = coverage.children[2]!.children[1] as HTMLSelectElement;
    await act(async () => {
      select.children[1]?.removeAttribute("selected");
      select.children[0]?.setAttribute("selected", "");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledWith("settings");
    const coverageList = coverage.children[3]!;
    const details = coverageList.children[0]!.children[1]!;
    const useButton = details.children[3] as HTMLElement;
    await act(async () =>
      useButton.dispatchEvent(new Event("click", { bubbles: true })),
    );
    expect(onUseTaskPrompt).toHaveBeenCalledWith("Configure Napier.");
  });
});

const template: EvaluationCasebookTemplate = {
  id: "release-product-v1",
  version: 1,
  name: "Release Product Casebook",
  description: "Fixed product coverage.",
  cases: [
    {
      id: "settings",
      title: "Settings and setup",
      description: "Configure the product.",
      taskPrompt: "Configure Napier.",
      acceptanceCriteria: ["Setup works"],
      critical: true,
    },
    {
      id: "browser",
      title: "Dynamic Browser",
      description: "Use a dynamic page.",
      taskPrompt: "Navigate the page.",
      acceptanceCriteria: ["Navigation works"],
      critical: false,
    },
  ],
};

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
