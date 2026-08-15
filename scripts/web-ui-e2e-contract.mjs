import assert from "node:assert/strict";

export const WEB_UI_E2E_KIND = "napier.web-ui-e2e";
export const WEB_UI_LAYOUT_BASELINE_VIEWPORTS = Object.freeze([
  Object.freeze({ width: 1_600, height: 900, layout: "desktop" }),
  Object.freeze({ width: 1_200, height: 800, layout: "desktop" }),
  Object.freeze({ width: 900, height: 800, layout: "drawer" }),
  Object.freeze({ width: 390, height: 844, layout: "drawer" }),
]);
export const WEB_UI_E2E_VIEWPORTS = Object.freeze([
  WEB_UI_LAYOUT_BASELINE_VIEWPORTS[0],
  Object.freeze({ width: 1_440, height: 900, layout: "desktop" }),
  ...WEB_UI_LAYOUT_BASELINE_VIEWPORTS.slice(1),
]);
export const INSPECTOR_GROUP_LABELS = Object.freeze([
  "Activity/Plan",
  "Files/Artifacts",
  "Inspect",
]);
export const WEB_UI_NARRATIVE_EXPECTATION = Object.freeze({
  title: "Ship verified research brief",
  phase: "Waiting",
  currentAction: "Approval",
  completedItem: "Inspect source evidence",
  blocker: "Operator input is required before the run can continue.",
  nextStep: "Approve final delivery",
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
  assert.equal(receipt?.schemaVersion, 1);
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
  receipt.viewports.forEach(assertViewportReceipt);
  assert.deepEqual(
    {
      title: receipt.recovery.title,
      phase: receipt.recovery.phase,
      currentAction: receipt.recovery.currentAction,
      completedItem: receipt.recovery.completedItem,
      blocker: receipt.recovery.blocker,
      nextStep: receipt.recovery.nextStep,
    },
    {
      title: "Recover interrupted verification",
      phase: "Recovery blocked",
      currentAction: "Automatic recovery stopped safely",
      completedItem: "Inspect recovery evidence",
      blocker: "2 safety conditions require review.",
      nextStep: "Review the Retry card or resume manually.",
    },
  );
  assert.equal(receipt?.recovery?.selectedThreadPreserved, true);
  assert.equal(receipt?.recovery?.refreshPreserved, true);
  assert.deepEqual(
    {
      title: receipt.longRun.title,
      phase: receipt.longRun.phase,
      currentAction: receipt.longRun.currentAction,
      completedItem: receipt.longRun.completedItem,
      blocker: receipt.longRun.blocker,
      nextStep: receipt.longRun.nextStep,
      artifactPath: receipt.longRun.artifactPath,
    },
    WEB_UI_LONG_RUN_NARRATIVE_EXPECTATION,
  );
  assert.equal(
    receipt?.longRun?.metrics.includes("21,200 / 250,000 tokens"),
    true,
  );
  assert.equal(receipt?.longRun?.metrics.includes("$0.3100"), true);
  assert.equal(receipt?.longRun?.artifactControlVisible, false);
  assert.equal(receipt?.longRun?.refreshPreserved, true);
  assert.deepEqual(receipt?.longRun?.activityAggregation?.summaries, [
    "Read file · 12 calls",
    "Web search · 5 searches",
    "Action · 3 steps",
  ]);
  assert.equal(
    receipt?.longRun?.activityAggregation?.collapsedMountedChildren,
    0,
  );
  assert.equal(
    receipt?.longRun?.activityAggregation?.expandedMountedChildren,
    12,
  );
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
  assert.match(
    receipt?.artifactNavigation?.previews?.[0]?.preview ?? "",
    /Output report.*Verified delivery/su,
  );
  assert.match(
    receipt?.artifactNavigation?.previews?.[1]?.preview ?? "",
    /Source notes.*Evidence index/su,
  );
  assert.equal(receipt?.reconnect?.disconnected, true);
  assert.equal(receipt?.reconnect?.samePort, true);
  assert.equal(receipt?.reconnect?.narrativePreserved, true);
  assert.equal(receipt?.reconnect?.browserTaskHistoryPreserved, true);
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
  assert.deepEqual(viewport.inspector.groupLabels, INSPECTOR_GROUP_LABELS);
  assert.equal(viewport.inspector.defaultGroup, "activity");
  assert.equal(viewport.inspector.defaultTool, "plan");
  assert.equal(viewport.inspector.panelLabelledBy, "inspector-tab-plan");
  assert.equal(viewport.inspector.minimumGroupHeight >= 44, true);
  assert.equal(viewport.inspector.minimumToolHeight >= 44, true);
  assert.equal(viewport.geometry.horizontalOverflowPx, 0);
  for (const key of [
    "workbench",
    "header",
    "narrative",
    "conversation",
    "composer",
    "inspector",
  ]) {
    assertLayoutRect(
      viewport.layoutSnapshot[key],
      `${String(viewport.width)}:${key}`,
      key === "conversation",
    );
  }
  assert.equal(viewport.layoutSnapshot.conversation.height >= 100, true);
  assert.equal(
    within(
      viewport.layoutSnapshot.inspector,
      viewport.browserInspector.layoutRect,
    ),
    true,
  );
  assert.equal(viewport.keyboard.manualActivationPreserved, true);
  assert.equal(viewport.keyboard.groupNavigationPassed, true);
  assert.equal(viewport.keyboard.toolNavigationPassed, true);
  assert.equal(viewport.browserInspector.tabSelected, true);
  assert.equal(
    viewport.browserInspector.panelLabelledBy,
    "inspector-tab-browser",
  );
  assert.equal(viewport.browserInspector.title, "Browser");
  assertLayoutRect(viewport.browserInspector.layoutRect, "browserInspector");
  assert.equal(
    viewport.browserInspector.actionDisabled,
    true,
    JSON.stringify(viewport.browserInspector),
  );
  assert.equal(viewport.browserInspector.selectedBackend, "browser_use_cloud");
  assert.match(
    viewport.browserInspector.localDisclosure,
    /separate visible browser with a fresh local profile.*Downloads, uploads, typing, secrets, purchases, publishing, deletion.*disabled/su,
  );
  assert.match(
    viewport.browserInspector.localDisclosure,
    /Pause freezes only the agent process.*Take over leaves the browser interactive.*CAPTCHA enters takeover automatically.*Stop closes the task browser and its process group/su,
  );
  assert.match(
    viewport.browserInspector.cloudDisclosure,
    /Browser Use receives the task, start URL, allowed domains, page data/u,
  );
  assert.match(
    viewport.browserInspector.cloudDisclosure,
    /Provider-plan retention applies; zero retention is not assumed/u,
  );
  assert.match(
    viewport.browserInspector.cloudDisclosure,
    /usage can cross the ceiling between polls/u,
  );
  assert.match(
    viewport.browserInspector.cloudDisclosure,
    /Stop tears down the one-off task and session.*Pause and Take over are unavailable/su,
  );
  assert.equal(viewport.browserInspector.consentRequired, true);
  assert.equal(viewport.browserInspector.consentChecked, false);
  assert.equal(viewport.browserInspector.provider, "browser-use");
  assert.equal(viewport.browserInspector.modelId, "browser-use-2.0");
  assert.equal(viewport.browserInspector.credentialEnv, "BROWSER_USE_API_KEY");
  assert.equal(viewport.browserInspector.maxCostUsd, "1");
  assert.equal(
    viewport.browserInspector.localProductDefault.provider,
    "openai",
  );
  assert.equal(
    viewport.browserInspector.localProductDefault.modelId.length > 0,
    true,
  );
  assert.equal(viewport.browserInspector.localProductDefault.credentialEnv, "");
  assert.match(
    viewport.browserInspector.localProductDefault.credentialBinding,
    /Active credential.*E2E OpenAI reference.*secret stays server-side/iu,
  );
  assert.equal(viewport.browserInspector.retryRecovery.actionVisible, true);
  assert.equal(viewport.browserInspector.retryRecovery.settingsPreserved, true);
  assert.match(
    viewport.browserInspector.retryRecovery.recovery,
    /browser process exited.*Retry the task with the same settings/iu,
  );
  assert.match(
    viewport.browserInspector.restoredHistory.status,
    /restored history · terminal/iu,
  );
  assert.equal(viewport.browserInspector.restoredHistory.retryVisible, true);
  assert.match(
    viewport.browserInspector.restoredHistory.steps,
    /Step 1.*extract_content.*example\.com/su,
  );
  assert.match(
    viewport.browserInspector.restoredHistory.recovery,
    /stopped when the Napier server restarted.*Retry the same task/iu,
  );
  assert.match(
    viewport.browserInspector.credentialRecovery,
    /selected browser task credential is missing.*Set BROWSER_USE_API_KEY in the server environment/iu,
  );
  assert.equal(
    viewport.browserInspector.credentialRecoveryCode,
    "credential_missing",
  );
  if (viewport.width === 1_600) {
    assert.equal(viewport.casebookTrials.onboardingAvailable, true);
    assert.equal(viewport.casebookTrials.onboardingComposerLoaded, true);
    assert.equal(viewport.casebookTrials.templateCoverageCount, "0/10");
    assert.equal(viewport.casebookTrials.templateCoverageOptions, 10);
    assert.equal(viewport.casebookTrials.qualificationBlocked, true);
    assert.equal(viewport.casebookTrials.productTrialRunOptions >= 2, true);
    assert.match(
      viewport.casebookTrials.productTrialRecorded,
      /1\/10 Cases · 100% success/u,
    );
    assert.equal(viewport.casebookTrials.controlledHarnessGate, "ready");
    assert.match(
      viewport.casebookTrials.controlledHarnessEvidence,
      /Coding vs OMP13\/12 passed · 13\/13 decisive/iu,
    );
    assert.match(
      viewport.casebookTrials.controlledHarnessEvidence,
      /Browser autonomy vs Browser Use3\/3 passed · 3\/3 decisive\s*napier not worse/iu,
    );
    assert.match(
      viewport.casebookTrials.controlledHarnessEvidence,
      /quantified advantageevidence vs OMP · proven · Napier 1\.000 vs OMP 0\.778 verifiable final evidence rate · n=9\/9/iu,
    );
    assert.doesNotMatch(
      viewport.casebookTrials.controlledHarnessEvidence,
      /sample not proven|not worse not proven|quantified advantage not proven/iu,
    );
    assert.equal(viewport.casebookTrials.requestCount, 3);
    assert.equal(viewport.casebookTrials.maximumConcurrentRequests, 1);
    assert.match(
      viewport.casebookTrials.summary,
      /3\/3 completed · 2 passed · 67% mean agreement/iu,
    );
    assert.equal(viewport.casebookTrials.historyCount, "3");
  }
  assert.deepEqual(
    {
      title: viewport.narrative.title,
      phase: viewport.narrative.phase,
      currentAction: viewport.narrative.currentAction,
      completedItem: viewport.narrative.completedItem,
      blocker: viewport.narrative.blocker,
      nextStep: viewport.narrative.nextStep,
      artifactPath: viewport.narrative.artifactPath,
    },
    WEB_UI_NARRATIVE_EXPECTATION,
  );
  assert.equal(viewport.narrative.metrics.includes("tokens"), true);
  assert.equal(viewport.narrative.metrics.includes("$0.0420"), true);
  assert.equal(viewport.narrative.artifactControlVisible, true);
  assert.equal(viewport.console.errorCount, 0);
  assert.match(viewport.screenshot.sha256, SHA256);
  assert.equal(viewport.screenshot.bytes > 0, true);
  if (viewport.layout === "desktop") {
    assert.equal(viewport.inspector.desktopVisible, true);
    assert.equal(viewport.inspector.drawerTriggerHidden, true);
  } else {
    assert.equal(viewport.inspector.initiallyHidden, true);
    assert.equal(viewport.inspector.drawerTriggerVisible, true);
    assert.equal(viewport.inspector.drawerOpened, true);
    assert.equal(
      viewport.inspector.openFocusTarget,
      "inspector-group-activity",
    );
    assert.equal(viewport.inspector.escapeRestoredTriggerFocus, true);
    assert.equal(viewport.inspector.closedAfterEscape, true);
    assert.equal(viewport.geometry.drawerWithinViewport, true);
  }
  if (viewport.width === 390) {
    assert.equal(viewport.geometry.navigationLabelOverflowPx, 0);
  }
  if (viewport.width === 1_600) {
    assert.equal(viewport.narrative.refreshPreserved, true);
  }
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

function within(container, candidate) {
  return (
    candidate.x >= container.x &&
    candidate.y >= container.y &&
    candidate.x + candidate.width <= container.x + container.width &&
    candidate.y + candidate.height <= container.y + container.height
  );
}
