import { spawn } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

import rootPackage from "../package.json" with { type: "json" };
import {
  assertWebUiE2eReceipt,
  INSPECTOR_GROUP_LABELS,
  WEB_UI_E2E_KIND,
  WEB_UI_LONG_RUN_NARRATIVE_EXPECTATION,
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

  it("covers the required 1440px desktop and 390px mobile product paths", () => {
    expect(WEB_UI_E2E_VIEWPORTS).toEqual([
      { width: 1_600, height: 900, layout: "desktop" },
      { width: 1_440, height: 900, layout: "desktop" },
      { width: 1_200, height: 800, layout: "desktop" },
      { width: 900, height: 800, layout: "drawer" },
      { width: 390, height: 844, layout: "drawer" },
    ]);
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
      "Usage: node scripts/run-web-ui-e2e.mjs [--receipt <path>] [--layout-baseline <path>] [--write-layout-baseline]",
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
      layoutSnapshot: Object.fromEntries(
        [
          "workbench",
          "header",
          "narrative",
          "conversation",
          "composer",
          "inspector",
        ].map((key) => [
          key,
          { x: 0, y: 0, width: 100, height: key === "conversation" ? 100 : 50 },
        ]),
      ),
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
        layoutRect: { x: 0, y: 0, width: 100, height: 50 },
        selectedBackend: "browser_use_cloud",
        localDisclosure:
          "A separate visible browser with a fresh local profile. Downloads, uploads, typing, secrets, purchases, publishing, deletion are disabled. Pause freezes only the agent process. Take over leaves the browser interactive. CAPTCHA enters takeover automatically. Stop closes the task browser and its process group.",
        cloudDisclosure:
          "Browser Use receives the task, start URL, allowed domains, page data. Provider-plan retention applies; zero retention is not assumed; usage can cross the ceiling between polls. Stop tears down the one-off task and session. Pause and Take over are unavailable.",
        consentRequired: true,
        consentChecked: false,
        provider: "browser-use",
        modelId: "browser-use-2.0",
        credentialEnv: "BROWSER_USE_API_KEY",
        maxCostUsd: "1",
        localProductDefault: {
          provider: "openai",
          modelId: "gpt-4.1",
          credentialEnv: "",
          credentialBinding:
            "Active credential · E2E OpenAI reference · available. The secret stays server-side.",
        },
        retryRecovery: {
          actionVisible: true,
          settingsPreserved: true,
          recovery:
            "The browser process exited. Retry the task with the same settings.",
        },
        restoredHistory: {
          status: "browser_use_local · restored history · terminal",
          retryVisible: true,
          steps: "Step 1 extract_content https://example.com/",
          recovery:
            "Browser task stopped when the Napier server restarted. Retry the same task to start a fresh browser session.",
        },
        credentialRecovery:
          "The selected browser task credential is missing. Set BROWSER_USE_API_KEY in the server environment.",
        credentialRecoveryCode: "credential_missing",
      },
      ...(viewport.width === 1_600
        ? {
            casebookTrials: {
              onboardingAvailable: true,
              onboardingComposerLoaded: true,
              templateCoverageCount: "0/10",
              templateCoverageOptions: 10,
              qualificationBlocked: true,
              productTrialRunOptions: 3,
              productTrialRecorded:
                "0.1.2 · incomplete1/10 Cases · 100% success · UX 5/5",
              controlledHarnessGate: "ready",
              controlledHarnessEvidence:
                "Coding vs OMP13/12 passed · 13/13 decisivenapier not worse · minimum 3 decisive Trials · 67% decisive coverageBrowser autonomy vs Browser Use3/3 passed · 3/3 decisivenapier not worse · minimum 3 decisive Trials · 67% decisive coverageQuantified advantageevidence vs OMP · proven · Napier 1.000 vs OMP 0.778 verifiable final evidence rate · n=9/9",
              requestCount: 3,
              maximumConcurrentRequests: 1,
              summary:
                "Latest batch · 3/3 completed · 2 passed · 67% mean agreement",
              historyCount: "3",
            },
          }
        : {}),
      narrative: {
        ...WEB_UI_NARRATIVE_EXPECTATION,
        metrics: "1s / 15m 0s · 1,680 / 250,000 tokens · $0.0420 / $10.00",
        artifactControlVisible: true,
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
    longRun: {
      ...WEB_UI_LONG_RUN_NARRATIVE_EXPECTATION,
      metrics: "30m 0s / 45m 0s · 21,200 / 250,000 tokens · $0.3100 / $10.00",
      artifactControlVisible: false,
      refreshPreserved: true,
      activityAggregation: {
        summaries: [
          "Read file · 12 calls",
          "Web search · 5 searches",
          "Action · 3 steps",
        ],
        collapsedMountedChildren: 0,
        expandedMountedChildren: 12,
      },
    },
    artifactNavigation: {
      outputCount: 2,
      previews: [
        {
          path: "artifacts/output-report.md",
          focused: true,
          preview: "# Output report\nVerified delivery.\n",
        },
        {
          path: "artifacts/source-notes.md",
          focused: true,
          preview: "# Source notes\nEvidence index.\n",
        },
      ],
    },
    reconnect: {
      disconnected: true,
      samePort: true,
      narrativePreserved: true,
      browserTaskHistoryPreserved: true,
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
