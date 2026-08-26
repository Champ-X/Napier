import assert from "node:assert/strict";

import {
  startProductionWebServer,
  WEB_UI_START_TIMEOUT_MS,
} from "./web-ui-e2e-runtime.mjs";

export async function readWebUiNarrative(page, expected) {
  await page.waitForFunction(
    (target) => {
      const text = (selector) =>
        document.querySelector(selector)?.textContent?.trim() ?? "";
      return (
        text(".thread-heading h1") === target.title &&
        text(".task-narrative-current > span") === target.phase &&
        text(".task-narrative-current strong") === target.currentAction
      );
    },
    expected,
    {
      timeout: WEB_UI_START_TIMEOUT_MS,
    },
  );
  const narrative = await page.evaluate(() => {
    const text = (selector) =>
      document.querySelector(selector)?.textContent?.trim() ?? "";
    return {
      title: text(".thread-heading h1"),
      phase: text(".task-narrative-current > span"),
      currentAction: text(".task-narrative-current strong"),
      metrics: text(".task-narrative-current small"),
      blocker: text(".task-narrative-blocker p"),
      nextStep: text(".task-narrative-next p"),
      harness: text(".task-narrative-harness p"),
      detailsControlVisible: Boolean(
        document.querySelector(".task-status-details > summary"),
      ),
    };
  });
  for (const key of ["title", "phase", "currentAction"]) {
    assert.equal(narrative[key], expected[key]);
  }
  if (typeof expected.blocker === "string") {
    assert.equal(narrative.blocker, expected.blocker);
  }
  if (typeof expected.nextStep === "string") {
    assert.equal(narrative.nextStep, expected.nextStep);
  }
  if (typeof expected.harness === "string") {
    assert.equal(narrative.harness, expected.harness);
  }
  return narrative;
}

export async function openWebUiPage(context, url, viewport, setup = () => {}) {
  let firstError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const page = await context.newPage();
    try {
      setup(page);
      await page.setViewportSize(viewport);
      await page.goto(url, { waitUntil: "commit", timeout: 30_000 });
      return page;
    } catch (error) {
      firstError ??= error;
      await page.close().catch(() => undefined);
    }
  }
  throw firstError;
}

export async function refreshPreservesWebUiNarrative(
  page,
  origin,
  expected,
  before,
) {
  await page.reload({
    waitUntil: "commit",
    timeout: WEB_UI_START_TIMEOUT_MS,
  });
  const after = await readWebUiNarrative(page, expected);
  assert.deepEqual(after, before);
  assert.equal(new URL(page.url()).origin, origin);
  assert.equal(
    new URL(page.url()).searchParams.get("thread"),
    expected.threadId,
  );
  return true;
}

export async function verifyWebUiServerRestart(
  browser,
  runtime,
  root,
  expected,
) {
  const origin = runtime.origin;
  const port = Number(new URL(origin).port);
  const page = await openWebUiPage(
    browserContext(browser),
    `${origin}/?thread=${encodeURIComponent(expected.threadId)}`,
    { width: 1_440, height: 900 },
  );
  let restarted;
  try {
    const before = await readWebUiNarrative(page, expected);
    await runtime.close();
    const disconnected = await page.evaluate(async () => {
      try {
        await fetch("/api/health", { cache: "no-store" });
        return false;
      } catch {
        return true;
      }
    });
    restarted = await startProductionWebServer(root, port);
    assert.equal(restarted.origin, origin);
    await page.reload({
      waitUntil: "commit",
      timeout: WEB_UI_START_TIMEOUT_MS,
    });
    assert.deepEqual(await readWebUiNarrative(page, expected), before);
    return {
      disconnected,
      samePort: restarted.origin === origin,
      narrativePreserved: true,
      restartStartupDurationMs: restarted.receipt.startupDurationMs,
      runtime: restarted,
    };
  } catch (error) {
    await restarted?.close().catch(() => undefined);
    throw error;
  } finally {
    await page.close();
  }
}

export async function verifyWebUiRecoveryNarrative(browser, origin, expected) {
  const page = await openWebUiPage(
    browserContext(browser),
    `${origin}/?thread=${encodeURIComponent(expected.threadId)}`,
    { width: 1_440, height: 900 },
  );
  try {
    await page.waitForFunction(
      (phase) =>
        document
          .querySelector(".task-narrative-current > span")
          ?.textContent?.trim() === phase,
      expected.phase,
      { timeout: WEB_UI_START_TIMEOUT_MS },
    );
    const before = await readRecoveryNarrative(page, expected);
    await page.reload({
      waitUntil: "commit",
      timeout: WEB_UI_START_TIMEOUT_MS,
    });
    const after = await readRecoveryNarrative(page, expected);
    assert.deepEqual(after, before);
    return {
      ...after,
      selectedThreadPreserved:
        new URL(page.url()).searchParams.get("thread") === expected.threadId,
      refreshPreserved: true,
    };
  } finally {
    await page.close();
  }
}

export async function verifyWebUiLongRunNarrative(browser, origin, expected) {
  const page = await openWebUiPage(
    browserContext(browser),
    `${origin}/?thread=${encodeURIComponent(expected.threadId)}`,
    { width: 1_440, height: 900 },
  );
  try {
    const before = await readWebUiNarrative(page, expected);
    await page.reload({
      waitUntil: "commit",
      timeout: WEB_UI_START_TIMEOUT_MS,
    });
    const after = await readWebUiNarrative(page, expected);
    assert.deepEqual(after, before);
    const environmentFallbackInitiallyHidden = !(await page
      .locator(".environment-degradation-notice")
      .isVisible());
    await page.locator(".task-status-details > summary").click();
    await page.locator(".environment-degradation-notice").waitFor({
      state: "visible",
      timeout: WEB_UI_START_TIMEOUT_MS,
    });
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".conversation-activity-group").length ===
          3 &&
        document.querySelector(".conversation-show-earlier") instanceof
          HTMLElement,
      undefined,
      { timeout: WEB_UI_START_TIMEOUT_MS },
    );
    const collapsed = await page.evaluate(() => {
      const feedItems = () =>
        document.querySelectorAll(
          ".message-ledger > :is(article, details, section)",
        ).length;
      return {
        showEarlierVisible:
          document.querySelector(".conversation-show-earlier") instanceof
          HTMLElement,
        mountedFeedItems: feedItems(),
        summaries: [
          ...document.querySelectorAll(
            ".conversation-activity-group > summary strong",
          ),
        ].map((item) => item.textContent?.trim() ?? ""),
        mountedChildren: document.querySelectorAll(
          ".conversation-activity-group-items > details",
        ).length,
      };
    });
    const environmentFallback = {
      visible: await page
        .locator(".environment-degradation-notice")
        .isVisible(),
      tools:
        (
          await page.locator(".environment-degradation-tools").textContent()
        )?.trim() ?? "",
      repair:
        (
          await page.locator(".environment-degradation-repair").textContent()
        )?.trim() ?? "",
      geometry: await page.evaluate(() => {
        const notice = document.querySelector(
          ".environment-degradation-notice",
        );
        const details = document.querySelector(".task-status-details-popover");
        if (
          !(notice instanceof HTMLElement) ||
          !(details instanceof HTMLElement)
        ) {
          return { withinDetails: false, horizontalOverflowPx: -1 };
        }
        const noticeRect = notice.getBoundingClientRect();
        const detailsRect = details.getBoundingClientRect();
        return {
          withinDetails:
            noticeRect.top >= detailsRect.top &&
            noticeRect.bottom <= detailsRect.bottom &&
            noticeRect.left >= detailsRect.left &&
            noticeRect.right <= detailsRect.right,
          horizontalOverflowPx: Math.max(
            0,
            document.documentElement.scrollWidth -
              document.documentElement.clientWidth,
          ),
        };
      }),
    };
    await page.locator(".task-status-details > summary").click();
    await page
      .locator(".task-status-details-popover")
      .waitFor({ state: "hidden", timeout: WEB_UI_START_TIMEOUT_MS });
    await page.locator(".conversation-show-earlier").click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll(
          ".message-ledger > :is(article, details, section)",
        ).length > 160,
      undefined,
      { timeout: WEB_UI_START_TIMEOUT_MS },
    );
    const expandedFeedItems = await page
      .locator(".message-ledger > :is(article, details, section)")
      .count();
    await page
      .locator(".conversation-activity-group > summary")
      .first()
      .click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll(
          ".conversation-activity-group-items > details",
        ).length === 12,
      undefined,
      { timeout: WEB_UI_START_TIMEOUT_MS },
    );
    return {
      ...after,
      environmentFallbackInitiallyHidden,
      environmentFallbackVisible: environmentFallback.visible,
      environmentFallbackTools: environmentFallback.tools,
      environmentFallbackRepair: environmentFallback.repair,
      environmentFallbackWithinDetails:
        environmentFallback.geometry.withinDetails,
      horizontalOverflowPx: environmentFallback.geometry.horizontalOverflowPx,
      refreshPreserved: true,
      showEarlierVisible: collapsed.showEarlierVisible,
      mountedFeedItems: collapsed.mountedFeedItems,
      expandedFeedItems,
      activityAggregation: {
        summaries: collapsed.summaries,
        collapsedMountedChildren: collapsed.mountedChildren,
        expandedMountedChildren: await page
          .locator(".conversation-activity-group-items > details")
          .count(),
      },
    };
  } finally {
    await page.close();
  }
}

export async function verifyWebUiArtifactNavigation(browser, origin, expected) {
  const page = await openWebUiPage(
    browserContext(browser),
    `${origin}/?thread=${encodeURIComponent(expected.threadId)}`,
    { width: 1_440, height: 900 },
  );
  try {
    await page.waitForFunction(
      (title) =>
        document.querySelector(".thread-heading h1")?.textContent?.trim() ===
          title && document.querySelector(".task-narrative-completed") !== null,
      expected.title,
      { timeout: WEB_UI_START_TIMEOUT_MS },
    );
    const completionToggle = page.locator(".task-completion-toggle");
    if ((await completionToggle.getAttribute("aria-expanded")) === "false") {
      await completionToggle.click();
    }
    await page.waitForFunction(
      (count) =>
        document.querySelectorAll(".task-narrative-completed nav button")
          .length === count,
      expected.paths.length,
      { timeout: WEB_UI_START_TIMEOUT_MS },
    );
    const previews = [];
    for (const path of expected.paths) {
      await page
        .locator(`.task-completion-details nav button[title="Open ${path}"]`)
        .click();
      await page.waitForFunction(
        (targetPath) =>
          document.activeElement instanceof HTMLElement &&
          document.activeElement.dataset["artifactPath"] === targetPath &&
          document.activeElement.querySelector(
            '.artifact-action-inspection',
          ) !== null,
        path,
        { timeout: WEB_UI_START_TIMEOUT_MS },
      );
      const card = page.locator(
        `.conversation-artifact[data-artifact-path="${path}"]`,
      );
      await card.locator(".artifact-action-inspection").waitFor({
        state: "visible",
        timeout: WEB_UI_START_TIMEOUT_MS,
      });
      previews.push({
        path,
        focused: true,
        openedInOneClick: true,
        preview: await card
          .locator(".artifact-action-inspection pre")
          .textContent(),
      });
      await card
        .getByRole("button", { name: `Close artifact inspection ${path}` })
        .click();
    }
    return { outputCount: expected.paths.length, previews };
  } finally {
    await page.close();
  }
}

async function readRecoveryNarrative(page, expected) {
  const narrative = await readWebUiNarrative(page, expected);
  return {
    title: narrative.title,
    phase: narrative.phase,
    currentAction: narrative.currentAction,
    blocker: narrative.blocker,
    nextStep: narrative.nextStep,
  };
}

function browserContext(browser) {
  const context = browser.contexts()[0];
  assert.ok(context, "Web UI E2E Browser context is unavailable");
  return context;
}
