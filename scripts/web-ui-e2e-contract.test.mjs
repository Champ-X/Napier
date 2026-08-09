import { spawn } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

import rootPackage from "../package.json" with { type: "json" };
import {
  assertWebUiE2eReceipt,
  INSPECTOR_GROUP_LABELS,
  WEB_UI_E2E_KIND,
  WEB_UI_NARRATIVE_EXPECTATION,
  WEB_UI_E2E_VIEWPORTS,
} from "./web-ui-e2e-contract.mjs";

describe("Web UI E2E receipt contract", () => {
  it("keeps the production Web gate wired into the root check", () => {
    expect(rootPackage.scripts["check:web-ui-e2e"]).toBe(
      "node scripts/run-web-ui-e2e.mjs",
    );
    expect(rootPackage.scripts["test:web-ui-e2e"]).toContain(
      "npm run check:web-ui-e2e",
    );
    expect(rootPackage.scripts.check).toContain(
      "npm run build && npm run check:web-ui-e2e",
    );
  });

  it("accepts complete production, responsive, keyboard, and cleanup evidence", () => {
    expect(() => assertWebUiE2eReceipt(validReceipt())).not.toThrow();
  });

  it("rejects a viewport with horizontal overflow", () => {
    const receipt = validReceipt();
    receipt.viewports[3].geometry.horizontalOverflowPx = 1;
    expect(() => assertWebUiE2eReceipt(receipt)).toThrow(
      /Expected values to be strictly equal/u,
    );
  });

  it("rejects false operating-system isolation claims", () => {
    const receipt = validReceipt();
    receipt.browser.osIsolationClaimed = true;
    expect(() => assertWebUiE2eReceipt(receipt)).toThrow(
      /Expected values to be strictly equal/u,
    );
  });

  it("rejects unsupported runner arguments before starting the Server", async () => {
    const result = await runScript(["--unknown"]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain(
      "Usage: node scripts/run-web-ui-e2e.mjs [--receipt <path>]",
    );
  });
});

function validReceipt() {
  return {
    schemaVersion: 1,
    kind: WEB_UI_E2E_KIND,
    status: "passed",
    productionEntry: {
      serverBuilt: true,
      webBuilt: true,
      serverSha256: "a".repeat(64),
      webIndexSha256: "b".repeat(64),
    },
    server: {
      loopbackOnly: true,
      ephemeralPort: true,
      healthReady: true,
      startupDurationMs: 1,
    },
    browser: {
      transport: "playwright-launch",
      freshProfile: true,
      profilePersistent: false,
      osIsolationClaimed: false,
      executableSha256: "c".repeat(64),
      startupDurationMs: 2,
    },
    fixture: {
      threadId: "thread_fixture01",
      ...WEB_UI_NARRATIVE_EXPECTATION,
    },
    viewports: WEB_UI_E2E_VIEWPORTS.map((viewport) => ({
      ...viewport,
      inspector: {
        groupLabels: [...INSPECTOR_GROUP_LABELS],
        defaultGroup: "activity",
        defaultTool: "plan",
        panelLabelledBy: "inspector-tab-plan",
        minimumGroupHeight: 44,
        minimumToolHeight: 44,
        desktopVisible: viewport.layout === "desktop",
        drawerTriggerHidden: viewport.layout === "desktop",
        initiallyHidden: viewport.layout === "drawer",
        drawerTriggerVisible: viewport.layout === "drawer",
        drawerOpened: viewport.layout === "drawer",
        openFocusTarget:
          viewport.layout === "drawer" ? "inspector-group-activity" : "",
        escapeRestoredTriggerFocus: viewport.layout === "drawer",
        closedAfterEscape: viewport.layout === "drawer",
      },
      geometry: {
        horizontalOverflowPx: 0,
        drawerWithinViewport: viewport.layout === "drawer",
        navigationLabelOverflowPx: 0,
      },
      keyboard: {
        manualActivationPreserved: true,
        groupNavigationPassed: true,
        toolNavigationPassed: true,
      },
      browserInspector: {
        tabSelected: true,
        panelLabelledBy: "inspector-tab-browser",
        title: "Browser",
        actionDisabled: true,
      },
      narrative: {
        ...WEB_UI_NARRATIVE_EXPECTATION,
        metrics: "1s / 15m 0s · 1,680 / 250,000 tokens · $0.0420 / $10.00",
        refreshPreserved: viewport.width === 1_600,
      },
      console: { errorCount: 0 },
      screenshot: {
        sha256: "d".repeat(64),
        bytes: 42,
      },
    })),
    recovery: {
      title: "Recover interrupted verification",
      phase: "Recovery blocked",
      currentAction: "Automatic recovery stopped safely",
      completedItem: "Inspect recovery evidence",
      blocker: "2 safety conditions require review.",
      nextStep: "Review the Retry card or resume manually.",
      selectedThreadPreserved: true,
      refreshPreserved: true,
    },
    reconnect: {
      disconnected: true,
      samePort: true,
      narrativePreserved: true,
      restartStartupDurationMs: 3,
    },
    cleanup: {
      browserClosed: true,
      serverClosed: true,
      temporaryRootRemoved: true,
    },
  };
}

function runScript(args) {
  const scriptPath = path.resolve(import.meta.dirname, "run-web-ui-e2e.mjs");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: path.resolve(import.meta.dirname, ".."),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolve({ code, signal, stderr });
    });
  });
}
