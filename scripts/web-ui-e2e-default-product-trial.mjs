import { WEB_UI_START_TIMEOUT_MS } from "./web-ui-e2e-runtime.mjs";

export async function verifyDefaultProductTrialRecorder(page) {
  const openInspector = page.locator(".workspace-settings-surface");
  if (await openInspector.isVisible()) {
    await openInspector.locator('button[aria-label="Close Settings"]').click();
    await page.waitForFunction(
      () => document.querySelector(".workspace-settings-surface") === null,
      undefined,
      { timeout: WEB_UI_START_TIMEOUT_MS },
    );
  }
  const recorder = page.locator(".default-product-trial");
  await recorder.waitFor({
    state: "visible",
    timeout: WEB_UI_START_TIMEOUT_MS,
  });
  const summary = recorder.locator("> summary");
  const collapsedByDefault = !(await recorder.evaluate((element) =>
    element.hasAttribute("open"),
  ));
  await summary.click();
  const coreCase = page.getByLabel("Default product core case");
  await coreCase.waitFor({
    state: "visible",
    timeout: WEB_UI_START_TIMEOUT_MS,
  });
  await page.waitForFunction(
    () => {
      const version = document.querySelector(
        'input[aria-label="Release product version"]',
      );
      return version instanceof HTMLInputElement && version.value.length > 0;
    },
    undefined,
    { timeout: WEB_UI_START_TIMEOUT_MS },
  );
  const receipt = await page.evaluate(() => {
    const details = document.querySelector(".default-product-trial");
    const narrative = document.querySelector(".task-narrative");
    const coreCaseSelect = document.querySelector(
      'select[aria-label="Default product core case"]',
    );
    const runSelect = document.querySelector(
      'select[aria-label="Release product Run"]',
    );
    const version = document.querySelector(
      'input[aria-label="Release product version"]',
    );
    if (
      !(details instanceof HTMLDetailsElement) ||
      !(narrative instanceof HTMLElement) ||
      !(coreCaseSelect instanceof HTMLSelectElement) ||
      !(runSelect instanceof HTMLSelectElement) ||
      !(version instanceof HTMLInputElement)
    ) {
      throw new Error("Default Product Trial recorder is incomplete");
    }
    const detailsRect = details.getBoundingClientRect();
    const narrativeRect = narrative.getBoundingClientRect();
    const optionValues = [...coreCaseSelect.options].map(
      (option) => option.value,
    );
    return {
      trigger: details.querySelector("summary")?.textContent?.trim() ?? "",
      expanded: details.open,
      optionValues,
      selectedCaseId: coreCaseSelect.value,
      selectedRunId: runSelect.value,
      productVersion: version.value,
      releaseControlVisible:
        details.querySelector(".release-product-trial") instanceof HTMLElement,
      horizontalOverflowPx: Math.max(
        0,
        document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
      withinNarrative:
        detailsRect.left >= narrativeRect.left &&
        detailsRect.right <= narrativeRect.right &&
        detailsRect.width > 0,
    };
  });
  await summary.click();
  await page.waitForFunction(
    () =>
      document.querySelector(".default-product-trial")?.hasAttribute("open") ===
      false,
    undefined,
    { timeout: WEB_UI_START_TIMEOUT_MS },
  );
  return {
    collapsedByDefault,
    ...receipt,
    reCollapsed: true,
  };
}
