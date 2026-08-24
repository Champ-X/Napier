import assert from "node:assert/strict";

export const WEB_UI_E2E_KIND = "napier.web-ui-e2e";
export const WEB_UI_LAYOUT_BASELINE_VIEWPORTS = Object.freeze([
  Object.freeze({ width: 1_280, height: 900, layout: "desktop" }),
  Object.freeze({ width: 1_440, height: 900, layout: "desktop" }),
  Object.freeze({ width: 1_920, height: 1_080, layout: "desktop" }),
]);
export const WEB_UI_E2E_VIEWPORTS = WEB_UI_LAYOUT_BASELINE_VIEWPORTS;

export const WORKSPACE_VIEW_LABELS = Object.freeze([
  "Conversation",
  "Task",
  "Trajectory",
]);
export const DEFAULT_TASK_SECTION_LABELS = Object.freeze([
  "Overview",
  "Changes",
  "Validation",
]);
export const SETTINGS_SECTION_LABELS = Object.freeze([
  "Agent & Model",
  "Memory",
  "Extensions",
  "Workspace",
  "Automations",
  "Design system",
  "Developer",
  "Language",
]);
export const WEB_UI_UX_SCENARIOS = Object.freeze([
  "empty-conversation",
  "normal-conversation",
  "long-conversation",
  "running-task",
  "waiting-approval",
  "completed-task",
  "failed-recovery",
  "active-runtime",
  "dense-trajectory",
  "environment-degradation",
  "settings-administration",
]);

export const WEB_UI_NARRATIVE_EXPECTATION = Object.freeze({
  title: "Ship verified research brief",
  phase: "Waiting",
  currentAction: "Approval",
  completedItem: "Inspect source evidence",
  blocker:
    "The run has ended. Record an answer to unlock a linked continuation.",
  nextStep: "Approve final delivery",
  harness: "Generic · Focused · 18 / 42 tools",
  artifactPath: "artifacts/research-brief.md",
});
export const WEB_UI_LONG_RUN_NARRATIVE_EXPECTATION = Object.freeze({
  title: "Synthesize long-running evidence",
  phase: "Settled",
  currentAction: "Latest run completed",
  completedItem:
    "Read 12 files · Searched the web 5 times · Completed 3 browser steps",
  blocker: "",
  nextStep: "Start a follow-up task or inspect the evidence.",
  artifactPath: "",
});

export function assertWebUiE2eReceipt(receipt) {
  assert.equal(receipt?.schemaVersion, 2);
  assert.equal(receipt?.kind, WEB_UI_E2E_KIND);
  assert.equal(receipt?.status, "passed");
  assert.equal(receipt?.productionEntry?.serverBuilt, true);
  assert.equal(receipt?.productionEntry?.webBuilt, true);
  assert.match(receipt?.productionEntry?.serverSha256 ?? "", SHA256);
  assert.match(receipt?.productionEntry?.webIndexSha256 ?? "", SHA256);
  assert.equal(receipt?.server?.loopbackOnly, true);
  assert.equal(receipt?.server?.ephemeralPort, true);
  assert.equal(receipt?.server?.healthReady, true);
  assert.equal(receipt?.server?.startupDurationMs >= 0, true);
  assert.equal(receipt?.browser?.transport, "playwright-launch");
  assert.equal(receipt?.browser?.freshProfile, true);
  assert.equal(receipt?.browser?.profilePersistent, false);
  assert.equal(receipt?.browser?.osIsolationClaimed, false);
  assert.match(receipt?.browser?.executableSha256 ?? "", SHA256);
  assert.equal(receipt?.browser?.startupDurationMs >= 0, true);
  assert.match(receipt?.fixture?.threadId ?? "", /^thread_[a-z0-9]{8,80}$/u);
  assert.deepEqual(
    {
      title: receipt.fixture.title,
      phase: receipt.fixture.phase,
      currentAction: receipt.fixture.currentAction,
      completedItem: receipt.fixture.completedItem,
      blocker: receipt.fixture.blocker,
      nextStep: receipt.fixture.nextStep,
      harness: receipt.fixture.harness,
      artifactPath: receipt.fixture.artifactPath,
    },
    WEB_UI_NARRATIVE_EXPECTATION,
  );
  assert.deepEqual(
    receipt?.viewports?.map(({ width, height, layout }) => ({
      width,
      height,
      layout,
    })),
    WEB_UI_E2E_VIEWPORTS,
  );
  for (const viewport of receipt.viewports) assertViewportReceipt(viewport);
  assert.deepEqual(
    receipt?.scenarios?.map(({ id }) => id),
    WEB_UI_UX_SCENARIOS,
  );
  for (const scenario of receipt.scenarios) {
    assert.equal(scenario.passed, true, `UX scenario failed: ${scenario.id}`);
  }
  assert.equal(receipt?.empty?.welcomeVisible, true);
  assert.equal(receipt?.empty?.composerVisible, true);
  assert.equal(receipt?.empty?.titleMatched, true);
  assert.equal(receipt?.empty?.internalTrialControlsVisible, false);
  assert.equal(receipt?.longRun?.showEarlierVisible, true);
  assert.equal(receipt?.longRun?.mountedFeedItems > 0, true);
  assert.equal(receipt?.longRun?.mountedFeedItems <= 160, true);
  assert.equal(receipt?.longRun?.expandedFeedItems > 160, true);
  assert.equal(
    receipt?.longRun?.activityAggregation?.collapsedMountedChildren,
    0,
  );
  assert.equal(
    receipt?.longRun?.activityAggregation?.expandedMountedChildren,
    12,
  );
  assert.equal(receipt?.longRun?.environmentFallbackVisible, true);
  assert.equal(
    receipt?.longRun?.environmentFallbackTools,
    "14 / 42 tools active",
  );
  assert.equal(
    receipt?.longRun?.environmentFallbackRepair,
    "Run options → Sandbox setup",
  );
  assert.equal(receipt?.longRun?.environmentFallbackWithinStatus, true);
  assert.equal(receipt?.longRun?.horizontalOverflowPx, 0);
  assert.equal(receipt?.runtime?.runtimeSectionVisible, true);
  assert.equal(receipt?.runtime?.sectionCount, 4);
  assert.equal(receipt?.runtime?.browserSurfaceVisible, true);
  assert.equal(receipt?.runtime?.runningIndicatorVisible, true);
  assert.equal(receipt?.runtime?.fallbackWarningVisible, true);
  assert.equal(receipt?.runtime?.composerHeight >= 184, true);
  assert.equal(receipt?.trajectory?.title, "Run trajectory");
  assert.equal(receipt?.trajectory?.eventCount > 180, true);
  assert.equal(receipt?.trajectory?.runCount >= 2, true);
  assert.equal(receipt?.trajectory?.mountedEventRows > 0, true);
  assert.equal(receipt?.trajectory?.mountedEventRows <= 180, true);
  assert.equal(receipt?.trajectory?.keyVisible, true);
  assert.equal(receipt?.trajectory?.incrementalControlVisible, true);
  assert.equal(receipt?.trajectory?.harnessVisible, true);
  assert.equal(receipt?.trajectory?.harnessFocused, true);
  assert.equal(receipt?.trajectory?.contextPruningVisible, true);
  assert.equal(receipt?.trajectory?.contextPruningSaved, true);
  assert.equal(receipt?.trajectory?.contextContinuityVisible, true);
  assert.equal(receipt?.trajectory?.contextContinuityBound, true);
  assert.equal(receipt?.settings?.dialog, true);
  assert.equal(receipt?.settings?.modal, true);
  assert.equal(receipt?.settings?.focusTrappedForward, true);
  assert.equal(receipt?.settings?.focusTrappedBackward, true);
  assert.equal(receipt?.settings?.escapeRestoredTriggerFocus, true);
  assert.equal(receipt?.settings?.defaultProductTrialHidden, true);
  assert.equal(receipt?.settings?.developerProductTrialAvailable, true);
  assert.equal(receipt?.settings?.revisionHistoryVisible, true);
  assert.equal(receipt?.settings?.revisionHistoryMinimumFontPx >= 12, true);
  assert.equal(
    receipt?.settings?.revisionHistoryMinimumButtonHeight >= 44,
    true,
  );
  assert.equal(receipt?.settings?.packageDeskCount, 3);
  assert.equal(receipt?.settings?.packageManagementMinimumFontPx >= 12, true);
  assert.equal(
    receipt?.settings?.packageManagementMinimumActionHeight >= 44,
    true,
  );
  assert.equal(receipt?.settings?.credentialRegisterVisible, true);
  assert.equal(receipt?.settings?.credentialRegisterMinimumFontPx >= 12, true);
  assert.equal(
    receipt?.settings?.credentialRegisterMinimumControlHeight >= 44,
    true,
  );
  assert.equal(receipt?.locale?.lang, "zh-CN");
  assert.deepEqual(receipt?.locale?.workspaceLabels, ["对话", "任务", "轨迹"]);
  assert.deepEqual(receipt?.locale?.taskSections, ["概览", "变更", "验证"]);
  assert.deepEqual(receipt?.locale?.settingsLabels, [
    "智能体与模型",
    "记忆",
    "扩展",
    "工作区",
    "自动化",
    "设计系统",
    "开发者",
    "语言",
  ]);
  assert.match(
    receipt?.locale?.composerPlaceholder ?? "",
    /给 Napier 一个任务/u,
  );
  assert.deepEqual(receipt?.locale?.trajectoryTitles, {
    page: "运行轨迹",
    map: "运行轨迹",
  });
  assert.deepEqual(receipt?.locale?.contextTitles, {
    page: "智能体上下文",
    model: "运行模型",
    credentials: "提供商凭证",
  });
  assert.deepEqual(receipt?.locale?.planTitles, {
    studio: "工作流工作室",
    library: "模板库",
    refresh: "刷新模板库",
  });
  assert.equal(receipt?.artifactNavigation?.outputCount, 2);
  assert.deepEqual(
    receipt?.artifactNavigation?.previews?.map(({ path, focused }) => ({
      path,
      focused,
    })),
    [
      { path: "artifacts/output-report.md", focused: true },
      { path: "artifacts/source-notes.md", focused: true },
    ],
  );
  assert.equal(receipt?.recovery?.selectedThreadPreserved, true);
  assert.equal(receipt?.recovery?.refreshPreserved, true);
  assert.equal(receipt?.recovery?.phase, "Recovery blocked");
  assert.equal(receipt?.reconnect?.disconnected, true);
  assert.equal(receipt?.reconnect?.samePort, true);
  assert.equal(receipt?.reconnect?.narrativePreserved, true);
  assert.equal(receipt?.reconnect?.restartStartupDurationMs >= 0, true);
  assert.equal(receipt?.reconnect?.runtime, undefined);
  assert.equal(receipt?.cleanup?.browserClosed, true);
  assert.equal(receipt?.cleanup?.serverClosed, true);
  assert.equal(receipt?.cleanup?.temporaryRootRemoved, true);
  return receipt;
}

export function assertViewportReceipt(viewport) {
  const expected = WEB_UI_E2E_VIEWPORTS.find(
    (candidate) =>
      candidate.width === viewport?.width &&
      candidate.height === viewport?.height,
  );
  assert.ok(expected, "Web UI E2E viewport is not part of the contract");
  assert.equal(viewport.layout, expected.layout);
  assert.deepEqual(viewport.workspaceNavigation.labels, WORKSPACE_VIEW_LABELS);
  assert.equal(viewport.workspaceNavigation.selected, "conversation");
  assert.equal(viewport.workspaceNavigation.minimumHeight >= 32, true);
  assert.deepEqual(viewport.task.sections, DEFAULT_TASK_SECTION_LABELS);
  assert.equal(viewport.task.sectionCount <= 4, true);
  assert.equal(viewport.task.defaultSection, "overview");
  assert.equal(viewport.task.internalTrialControlsVisible, false);
  assert.equal(viewport.settings.initiallyHidden, true);
  assert.equal(viewport.settings.dialog, true);
  assert.equal(viewport.settings.modal, true);
  assert.deepEqual(viewport.settings.labels, SETTINGS_SECTION_LABELS);
  assert.equal(viewport.settings.minimumSectionHeight >= 32, true);
  assert.equal(viewport.settings.drawerWithinViewport, true);
  assert.equal(viewport.settings.escapeRestoredTriggerFocus, true);
  assert.equal(viewport.settings.closedAfterEscape, true);
  assert.equal(viewport.conversation.messageCount >= 2, true);
  assert.equal(viewport.conversation.waitingApprovalVisible, true);
  assert.equal(viewport.conversation.internalTrialControlsVisible, false);
  assert.equal(viewport.geometry.horizontalOverflowPx, 0);
  assert.equal(viewport.geometry.drawerWithinViewport, true);
  assert.equal(viewport.readingAxis.statusWidth >= 760, true);
  assert.equal(viewport.readingAxis.statusWidth <= 840, true);
  assert.equal(viewport.readingAxis.conversationWidth >= 760, true);
  assert.equal(viewport.readingAxis.conversationWidth <= 840, true);
  assert.equal(viewport.readingAxis.composerWidth >= 760, true);
  assert.equal(viewport.readingAxis.composerWidth <= 840, true);
  assert.equal(viewport.readingAxis.maximumCenterDeltaPx <= 2, true);
  assert.equal(viewport.readingAxis.messageFontPx >= 15, true);
  assert.equal(viewport.keyboard.workspaceNavigationPassed, true);
  assert.equal(viewport.keyboard.taskNavigationPassed, true);
  assert.deepEqual(
    {
      title: viewport.narrative.title,
      phase: viewport.narrative.phase,
      currentAction: viewport.narrative.currentAction,
      blocker: viewport.narrative.blocker,
      nextStep: viewport.narrative.nextStep,
      harness: viewport.narrative.harness,
    },
    {
      title: WEB_UI_NARRATIVE_EXPECTATION.title,
      phase: WEB_UI_NARRATIVE_EXPECTATION.phase,
      currentAction: WEB_UI_NARRATIVE_EXPECTATION.currentAction,
      blocker: WEB_UI_NARRATIVE_EXPECTATION.blocker,
      nextStep: WEB_UI_NARRATIVE_EXPECTATION.nextStep,
      harness: WEB_UI_NARRATIVE_EXPECTATION.harness,
    },
  );
  if (viewport.width === 1_440) {
    assert.equal(viewport.narrative.refreshPreserved, true);
  }
  for (const key of [
    "workbench",
    "header",
    "status",
    "conversation",
    "composer",
    "views",
    "primary",
  ]) {
    assertLayoutRect(
      viewport.layoutSnapshot[key],
      `${String(viewport.width)}:${key}`,
      key === "conversation",
    );
  }
  assert.equal(viewport.console.errorCount, 0);
  assert.match(viewport.screenshot.sha256, SHA256);
  assert.equal(viewport.screenshot.bytes > 0, true);
}

const SHA256 = /^[a-f0-9]{64}$/u;

function assertLayoutRect(value, label, allowZeroHeight = false) {
  assert.ok(value, `${label} layout rectangle is missing`);
  for (const key of ["x", "y", "width", "height"]) {
    assert.equal(Number.isInteger(value[key]), true);
  }
  assert.equal(value.width > 0, true, `${label} width ${String(value.width)}`);
  assert.equal(
    allowZeroHeight ? value.height >= 0 : value.height > 0,
    true,
    `${label} height ${String(value.height)}`,
  );
}
