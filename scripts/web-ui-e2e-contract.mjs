import assert from "node:assert/strict";

export const WEB_UI_E2E_KIND = "napier.web-ui-e2e";
export const WEB_UI_E2E_VIEWPORTS = Object.freeze([
  Object.freeze({ width: 1_600, height: 900, layout: "desktop" }),
  Object.freeze({ width: 1_200, height: 800, layout: "desktop" }),
  Object.freeze({ width: 900, height: 800, layout: "drawer" }),
  Object.freeze({ width: 390, height: 844, layout: "drawer" }),
]);
export const INSPECTOR_GROUP_LABELS = Object.freeze([
  "Activity/Plan",
  "Files/Artifacts",
  "Inspect",
]);

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
  assert.equal(receipt?.browser?.transport, "loopback-cdp");
  assert.equal(receipt?.browser?.freshProfile, true);
  assert.equal(receipt?.browser?.profilePersistent, false);
  assert.equal(receipt?.browser?.osIsolationClaimed, false);
  assert.match(receipt?.browser?.executableSha256 ?? "", SHA256);
  assert.equal(receipt?.browser?.startupDurationMs >= 0, true);
  assert.deepEqual(
    receipt?.viewports?.map(({ width, height, layout }) => ({
      width,
      height,
      layout,
    })),
    WEB_UI_E2E_VIEWPORTS,
  );
  receipt.viewports.forEach(assertViewportReceipt);
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
  assert.equal(viewport.keyboard.manualActivationPreserved, true);
  assert.equal(viewport.keyboard.groupNavigationPassed, true);
  assert.equal(viewport.keyboard.toolNavigationPassed, true);
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
}

const SHA256 = /^[a-f0-9]{64}$/u;
