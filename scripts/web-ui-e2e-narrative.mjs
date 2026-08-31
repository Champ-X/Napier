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
        (text(".task-narrative-current strong") ||
          text(".task-narrative-action-detail p")) === target.currentAction
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
      currentAction:
        text(".task-narrative-current strong") ||
        text(".task-narrative-action-detail p"),
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

export async function readThinkingSummary(page) {
  const thinking = page.locator(".conversation-thinking").first();
  await thinking.waitFor({
    state: "visible",
    timeout: WEB_UI_START_TIMEOUT_MS,
  });
  const initiallyOpen = (await thinking.getAttribute("open")) !== null;
  if (!initiallyOpen) {
    await thinking.locator(":scope > summary").click();
  }
  const receipt = await page.evaluate(() => {
    const root = document.querySelector(".conversation-thinking");
    const content = root?.querySelector(".conversation-thinking-content");
    return {
      visible:
        content instanceof HTMLElement && content.getClientRects().length > 0,
      transcript:
        content
          ?.querySelector(".conversation-thinking-transcript")
          ?.textContent?.trim() ?? "",
      chromeHidden: !content?.querySelector(
        ":scope > strong, :scope > dl, :scope > small",
      ),
      transcriptVisible:
        root?.textContent?.includes("PRIVATE_FIXTURE_REASONING") ?? false,
      horizontalOverflowPx: Math.max(
        0,
        document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    };
  });
  if (!initiallyOpen) {
    await thinking.locator(":scope > summary").click();
  }
  return { initiallyOpen, ...receipt };
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
        document.querySelectorAll(".conversation-activity-group").length >= 1 &&
        document.querySelector(".conversation-show-earlier") instanceof
          HTMLElement,
      undefined,
      { timeout: WEB_UI_START_TIMEOUT_MS },
    );
    const progressNotes = page.locator(".conversation-progress-note");
    const progressNoteCount = await progressNotes.count();
    const progressNoteVisible = await progressNotes
      .filter({ hasText: expected.progressText })
      .isVisible();
    const progressPrivateMarkerVisible = (
      await progressNotes.allTextContents()
    ).some((text) => text.includes("PRIVATE_PROGRESS_PATH"));
    const initialExecutionFlow = await page.evaluate(() => {
      const feedItems = () =>
        document.querySelectorAll(
          ".message-ledger > :is(article, details, section)",
        ).length;
      const groups = [
        ...document.querySelectorAll(".conversation-activity-group"),
      ];
      return {
        showEarlierVisible:
          document.querySelector(".conversation-show-earlier") instanceof
          HTMLElement,
        mountedFeedItems: feedItems(),
        groupCount: groups.length,
        directSummaryCount: document.querySelectorAll(
          ".conversation-activity-group > summary",
        ).length,
        mountedChildren: document.querySelectorAll(
          ".conversation-activity-group-items > details",
        ).length,
        stepsDirectlyExpanded: groups.every(
          (group) =>
            group.querySelectorAll(
              ".conversation-activity-group-items > details",
            ).length > 0,
        ),
        groupsLabelled: groups.every((group) =>
          group.hasAttribute("aria-label"),
        ),
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
    const expandedExecutionFlow = await page.evaluate(() => {
      const groups = [
        ...document.querySelectorAll(".conversation-activity-group"),
      ];
      return {
        groupCount: groups.length,
        directSummaryCount: document.querySelectorAll(
          ".conversation-activity-group > summary",
        ).length,
        mountedChildren: document.querySelectorAll(
          ".conversation-activity-group-items > details",
        ).length,
        stepsDirectlyExpanded: groups.every(
          (group) =>
            group.querySelectorAll(
              ".conversation-activity-group-items > details",
            ).length > 0,
        ),
        groupsLabelled: groups.every((group) =>
          group.hasAttribute("aria-label"),
        ),
      };
    });
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
      showEarlierVisible: initialExecutionFlow.showEarlierVisible,
      mountedFeedItems: initialExecutionFlow.mountedFeedItems,
      expandedFeedItems,
      progressNoteVisible,
      progressNoteCount,
      progressPrivateMarkerVisible,
      activityAggregation: {
        initialGroupCount: initialExecutionFlow.groupCount,
        initialMountedChildren: initialExecutionFlow.mountedChildren,
        expandedGroupCount: expandedExecutionFlow.groupCount,
        expandedMountedChildren: expandedExecutionFlow.mountedChildren,
        directSummaryCount: Math.max(
          initialExecutionFlow.directSummaryCount,
          expandedExecutionFlow.directSummaryCount,
        ),
        stepsDirectlyExpanded:
          initialExecutionFlow.stepsDirectlyExpanded &&
          expandedExecutionFlow.stepsDirectlyExpanded,
        groupsLabelled:
          initialExecutionFlow.groupsLabelled &&
          expandedExecutionFlow.groupsLabelled,
      },
    };
  } finally {
    await page.close();
  }
}

export async function verifyWebUiArtifactNavigation(browser, origin, expected) {
  const consoleErrors = [];
  const artifactRequests = [];
  const page = await openWebUiPage(
    browserContext(browser),
    `${origin}/?thread=${encodeURIComponent(expected.threadId)}`,
    { width: 1_920, height: 1_080 },
    (candidate) => {
      candidate.on("console", (message) => {
        if (message.type() === "error") {
          consoleErrors.push(message.text());
          if (process.env["NAPIER_WEB_E2E_DEBUG"] === "1") {
            process.stderr.write(
              `[web-ui-e2e] artifact console error: ${message.text()}\n`,
            );
          }
        }
      });
      candidate.on("pageerror", (error) => {
        consoleErrors.push(error.message);
        if (process.env["NAPIER_WEB_E2E_DEBUG"] === "1") {
          process.stderr.write(
            `[web-ui-e2e] artifact page error: ${error.message}\n`,
          );
        }
      });
      candidate.on("request", (request) => {
        const pathname = new URL(request.url()).pathname;
        if (/\/artifacts\/[^/]+\/(?:preview|diff)$/u.test(pathname)) {
          artifactRequests.push(pathname);
        }
      });
    },
  );
  try {
    await page.waitForFunction(
      (title) =>
        document.querySelector(".thread-heading h1")?.textContent?.trim() ===
          title && document.querySelector(".task-narrative-completed") !== null,
      expected.title,
      { timeout: WEB_UI_START_TIMEOUT_MS },
    );
    const primaryOutput = page.locator(
      ".workspace-evidence-results .task-completion-primary-output",
    );
    const primaryTitle = await primaryOutput.getAttribute("title");
    const primaryPath = expected.paths.find((path) =>
      primaryTitle?.endsWith(path),
    );
    assert.ok(primaryPath, "Primary Artifact is not an expected output");
    await primaryOutput.locator('[data-artifact-action="open"]').click();
    await page.waitForFunction(
      () => {
        const inspector = document.querySelector(".artifact-inspector");
        return (
          inspector instanceof HTMLElement &&
          document.activeElement instanceof HTMLElement &&
          inspector.contains(document.activeElement)
        );
      },
      undefined,
      { timeout: WEB_UI_START_TIMEOUT_MS },
    );
    const primaryInspection = await page.evaluate((targetPath) => {
      const source = document.activeElement;
      const inspector = document.querySelector(".artifact-inspector");
      const conversation = document.querySelector(
        ".conversation-workspace-view",
      );
      const workspace = document.querySelector(".workspace-primary-surface");
      const inspectorRect = inspector?.getBoundingClientRect();
      const conversationRect = conversation?.getBoundingClientRect();
      const workspaceRect = workspace?.getBoundingClientRect();
      return {
        path: targetPath,
        focusedInspection:
          source instanceof HTMLElement && inspector?.contains(source) === true,
        openedInOneClick:
          inspector instanceof HTMLElement &&
          inspector.getClientRects().length > 0,
        hostedInWorkspace:
          inspector?.parentElement?.classList.contains(
            "workspace-primary-surface",
          ) ?? false,
        inspectorWidth: inspectorRect?.width ?? 0,
        conversationWidth: conversationRect?.width ?? 0,
        workspaceShare:
          inspectorRect && workspaceRect && workspaceRect.width > 0
            ? inspectorRect.width / workspaceRect.width
            : 0,
        horizontalOverflowPx: Math.max(
          0,
          document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        ),
      };
    }, primaryPath);
    const interactivePath = expected.paths.find((path) =>
      /\.html?$/iu.test(path),
    );
    assert.ok(interactivePath, "Interactive HTML Artifact is unavailable");
    if (primaryPath !== interactivePath) {
      await page.getByRole("button", { name: "Close preview" }).click();
      await page.locator(".artifact-inspector").waitFor({
        state: "detached",
        timeout: WEB_UI_START_TIMEOUT_MS,
      });
      const interactiveArtifact = page.locator(
        `.conversation-artifact[data-artifact-path="${interactivePath}"]`,
      );
      await interactiveArtifact
        .locator('[data-artifact-action="open"]')
        .click();
      await page.waitForFunction(
        (targetPath) =>
          document
            .querySelector(".artifact-inspector-meta span")
            ?.textContent?.trim() === targetPath,
        interactivePath,
        { timeout: WEB_UI_START_TIMEOUT_MS },
      );
    }
    const inspectorInteraction = await verifyArtifactInspectorInteraction(
      page,
      interactivePath,
      artifactRequests,
    );
    const intermediateInspections = [];
    for (const viewport of [
      { width: 1_440, height: 900 },
      { width: 1_280, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      intermediateInspections.push(
        await page.evaluate(() => {
          const inspector = document
            .querySelector(".artifact-inspector")
            ?.getBoundingClientRect();
          const conversation = document
            .querySelector(".conversation-workspace-view")
            ?.getBoundingClientRect();
          return {
            viewportWidth: window.innerWidth,
            inspectorWidth: inspector?.width ?? 0,
            conversationWidth: conversation?.width ?? 0,
            horizontalOverflowPx: Math.max(
              0,
              document.documentElement.scrollWidth -
                document.documentElement.clientWidth,
            ),
          };
        }),
      );
    }
    await page.getByRole("button", { name: "Close preview" }).click();
    await page.locator(".artifact-inspector").waitFor({
      state: "detached",
      timeout: WEB_UI_START_TIMEOUT_MS,
    });
    const workspaceToggle = page.locator("#workspace-rail-toggle");
    await page.setViewportSize({ width: 1_920, height: 1_080 });
    const answerFile = page.locator(
      `.message-workspace-link[data-artifact-path="${interactivePath}"]`,
    );
    await answerFile.click();
    await page.locator(".artifact-inspector").waitFor({
      state: "visible",
      timeout: WEB_UI_START_TIMEOUT_MS,
    });
    const answerFileOpenedInspector =
      (
        await page
          .locator(".artifact-inspector-meta span")
          .first()
          .textContent()
      )?.trim() === interactivePath;
    await page.getByRole("button", { name: "Close preview" }).click();
    await page.locator(".artifact-inspector").waitFor({
      state: "detached",
      timeout: WEB_UI_START_TIMEOUT_MS,
    });
    if ((await workspaceToggle.getAttribute("aria-pressed")) === "false") {
      await workspaceToggle.click();
    }
    const completionToggle = page.locator(
      ".workspace-evidence-results .task-completion-toggle",
    );
    if ((await completionToggle.getAttribute("aria-expanded")) === "false") {
      await completionToggle.click();
    }
    await page.waitForFunction(
      (count) =>
        document.querySelectorAll(
          ".task-completion-details .task-completion-output",
        ).length === count,
      expected.paths.length,
      { timeout: WEB_UI_START_TIMEOUT_MS },
    );
    const previews = [];
    for (const path of expected.paths) {
      const output = page.locator(".task-completion-output").filter({
        has: page.locator(`code[title="${path}"]`),
      });
      await output.locator('[data-artifact-action="preview"]').click();
      const inspection = output.locator(".artifact-action-inspection");
      await inspection.waitFor({
        state: "visible",
        timeout: WEB_UI_START_TIMEOUT_MS,
      });
      assert.equal(await inspection.count(), 1);
      previews.push({
        path,
        focused: true,
        openedInOneClick: true,
        preview: await inspection.locator("pre").textContent(),
      });
      await output
        .getByRole("button", { name: `Close artifact inspection ${path}` })
        .click();
    }
    return {
      outputCount: expected.paths.length,
      answerFileOpenedInspector,
      primaryInspection,
      intermediateInspections,
      inspectorInteraction: {
        ...inspectorInteraction,
        consoleErrorCount: consoleErrors.length,
      },
      previews,
    };
  } finally {
    await page.close();
  }
}

async function verifyArtifactInspectorInteraction(
  page,
  primaryPath,
  artifactRequests,
) {
  const inspector = page.locator(".artifact-inspector");
  const preview = inspector.getByRole("button", {
    name: "Preview",
    exact: true,
  });
  const source = inspector.getByRole("button", {
    name: "Raw source",
    exact: true,
  });
  const changes = inspector.getByRole("button", {
    name: "Changes",
    exact: true,
  });
  const refresh = inspector.getByRole("button", {
    name: "Refresh",
    exact: true,
  });
  const controls = await inspector
    .locator(".artifact-inspector-views button")
    .allTextContents();
  const initialView =
    (await preview.getAttribute("aria-pressed")) === "true"
      ? "preview"
      : "unknown";
  const frame = inspector.locator("iframe");
  await frame.waitFor({ state: "visible", timeout: WEB_UI_START_TIMEOUT_MS });
  const htmlSandbox = await frame.getAttribute("sandbox");
  const previewRequestPath = artifactRequests.findLast((request) =>
    request.endsWith("/preview"),
  );
  assert.ok(previewRequestPath, "Initial Artifact preview request is missing");
  const previewFrame = page.frameLocator(".artifact-inspector iframe");
  await page.waitForTimeout(250);
  const htmlPreviewText =
    (await previewFrame.locator("body").textContent({ timeout: 10_000 })) ?? "";
  const frameEvidence = await Promise.all(
    page.frames().map(async (candidate) => ({
      url: candidate.url(),
      readyState: await candidate
        .evaluate(() => document.readyState)
        .catch(() => "unavailable"),
      body: await candidate
        .locator("body")
        .textContent({ timeout: 1_000 })
        .catch(() => "unavailable"),
    })),
  );
  assert.match(
    htmlPreviewText,
    /Advance preview/u,
    `Interactive Artifact content is unavailable: ${String(
      await frame.getAttribute("srcdoc"),
    ).slice(0, 240)} · ${JSON.stringify(frameEvidence)}`,
  );
  await previewFrame
    .locator("button")
    .filter({ hasText: /^Advance preview$/u })
    .evaluate((button) => button.click());
  const htmlInteractionText =
    (await previewFrame.locator("#stage").textContent())?.trim() ?? "";

  await source.click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('.artifact-inspector-views button[title="Raw source"]')
        ?.getAttribute("aria-pressed") === "true" &&
      document.querySelector(".artifact-inspector iframe") === null,
    undefined,
    { timeout: WEB_UI_START_TIMEOUT_MS },
  );
  const sourceViewActivated =
    (await source.getAttribute("aria-pressed")) === "true";
  const sourceText = await inspector
    .locator(".artifact-source-preview")
    .textContent();
  const previewRequestsBeforeRefresh = artifactRequests.filter(
    (request) => request === previewRequestPath,
  ).length;
  await Promise.all([
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === previewRequestPath &&
        response.ok(),
      { timeout: WEB_UI_START_TIMEOUT_MS },
    ),
    refresh.click(),
  ]);
  const diffRequestPath = previewRequestPath.replace(/\/preview$/u, "/diff");
  await Promise.all([
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === diffRequestPath && response.ok(),
      { timeout: WEB_UI_START_TIMEOUT_MS },
    ),
    changes.click(),
  ]);
  await page.waitForFunction(
    () =>
      document
        .querySelector('.artifact-inspector-views button[title="Changes"]')
        ?.getAttribute("aria-pressed") === "true" &&
      document.querySelector(".artifact-source-preview.is-diff") !== null,
    undefined,
    { timeout: WEB_UI_START_TIMEOUT_MS },
  );
  const changesText = await inspector
    .locator(".artifact-source-preview.is-diff")
    .textContent();
  await preview.click();
  await frame.waitFor({ state: "visible", timeout: WEB_UI_START_TIMEOUT_MS });
  return {
    controls: controls.map((label) => label.trim()),
    initialView,
    htmlSandbox,
    htmlInteractionText,
    sourceViewActivated,
    sourceContainsInteractiveMarkup:
      sourceText?.includes("Advance preview") ?? false,
    changesContainsPatch:
      changesText?.includes("Interactive output report") ?? false,
    previewRestored: (await preview.getAttribute("aria-pressed")) === "true",
    pathPreserved:
      (
        await inspector
          .locator(".artifact-inspector-meta span")
          .first()
          .textContent()
      )?.trim() === primaryPath,
    previewRequestCount: artifactRequests.filter(
      (request) => request === previewRequestPath,
    ).length,
    refreshRequestCount:
      artifactRequests.filter((request) => request === previewRequestPath)
        .length - previewRequestsBeforeRefresh,
    diffRequestCount: artifactRequests.filter(
      (request) => request === diffRequestPath,
    ).length,
  };
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
