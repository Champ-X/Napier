import { spawn } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

import rootPackage from "../package.json" with { type: "json" };
import {
  assertWebUiE2eReceipt,
  DEFAULT_TASK_SECTION_LABELS,
  SETTINGS_SECTION_LABELS,
  WEB_UI_E2E_KIND,
  WEB_UI_E2E_VIEWPORTS,
  WEB_UI_NARRATIVE_EXPECTATION,
  WEB_UI_UX_SCENARIOS,
  WORKSPACE_VIEW_LABELS,
} from "./web-ui-e2e-contract.mjs";
import { productionWebServerEnvironment } from "./web-ui-e2e-runtime.mjs";

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

  it("accepts complete desktop, keyboard, long-list, and cleanup evidence", () => {
    expect(() => assertWebUiE2eReceipt(validReceipt())).not.toThrow();
  });

  it("covers only the three required desktop viewports", () => {
    expect(WEB_UI_E2E_VIEWPORTS).toEqual([
      { width: 1_280, height: 900, layout: "desktop" },
      { width: 1_440, height: 900, layout: "desktop" },
      { width: 1_920, height: 1_080, layout: "desktop" },
    ]);
  });

  it("covers every stable workspace navigation destination", () => {
    expect(WORKSPACE_VIEW_LABELS).toEqual([
      "Conversation",
      "Task",
      "Subagents",
      "Trajectory",
    ]);
  });

  it("rejects horizontal overflow", () => {
    const receipt = validReceipt();
    receipt.viewports[0].geometry.horizontalOverflowPx = 1;
    expect(() => assertWebUiE2eReceipt(receipt)).toThrow();
  });

  it("rejects an undersized wide-screen artifact inspector", () => {
    const receipt = validReceipt();
    receipt.artifactNavigation.primaryInspection.inspectorWidth = 560;
    expect(() => assertWebUiE2eReceipt(receipt)).toThrow();
  });

  it("rejects a compact artifact inspector outside the workspace", () => {
    const receipt = validReceipt();
    receipt.artifactNavigation.compactInspection.inspectorRight = 391;
    expect(() => assertWebUiE2eReceipt(receipt)).toThrow();
  });

  it("rejects an intermediate inspector that shrinks the reading floor", () => {
    const receipt = validReceipt();
    receipt.artifactNavigation.intermediateInspections[1].conversationWidth = 639;
    expect(() => assertWebUiE2eReceipt(receipt)).toThrow();
  });

  it("rejects an inspector that does not prove all in-place views", () => {
    const receipt = validReceipt();
    receipt.artifactNavigation.inspectorInteraction.diffRequestCount = 0;
    expect(() => assertWebUiE2eReceipt(receipt)).toThrow();
  });

  it("rejects an interactive preview with an expanded HTML sandbox", () => {
    const receipt = validReceipt();
    receipt.artifactNavigation.inspectorInteraction.htmlSandbox =
      "allow-scripts allow-same-origin";
    expect(() => assertWebUiE2eReceipt(receipt)).toThrow();
  });

  it("rejects internal Product Trial controls on the default task path", () => {
    const receipt = validReceipt();
    receipt.viewports[0].task.internalTrialControlsVisible = true;
    expect(() => assertWebUiE2eReceipt(receipt)).toThrow();
  });

  it("rejects a thinking row without readable process content", () => {
    const receipt = validReceipt();
    receipt.viewports[0].conversation.thinking.transcript = "";
    expect(() => assertWebUiE2eReceipt(receipt)).toThrow();
  });

  it("rejects a thinking row that does not visibly render the transcript", () => {
    const receipt = validReceipt();
    receipt.viewports[0].conversation.thinking.transcriptVisible = false;
    expect(() => assertWebUiE2eReceipt(receipt)).toThrow();
  });

  it("rejects a tool row without its complete readable payload", () => {
    const receipt = validReceipt();
    receipt.viewports[0].conversation.tool.output = "Done!";
    expect(() => assertWebUiE2eReceipt(receipt)).toThrow();
  });

  it("rejects overflowing header controls or a textarea focus rectangle", () => {
    const receipt = validReceipt();
    receipt.viewports[0].chrome.headerNoOverlap = false;
    expect(() => assertWebUiE2eReceipt(receipt)).toThrow();

    receipt.viewports[0].chrome.headerNoOverlap = true;
    receipt.viewports[0].chrome.compactModelContentContained = false;
    expect(() => assertWebUiE2eReceipt(receipt)).toThrow();

    receipt.viewports[0].chrome.compactModelContentContained = true;
    receipt.viewports[0].chrome.textareaOutlineAbsent = false;
    expect(() => assertWebUiE2eReceipt(receipt)).toThrow();
  });

  it("rejects an active Browser surface outside the right rail", () => {
    const receipt = validReceipt();
    receipt.runtime.browserRail.rightOfConversation = false;
    expect(() => assertWebUiE2eReceipt(receipt)).toThrow();
  });

  it("rejects an unbounded dense trajectory", () => {
    const receipt = validReceipt();
    receipt.trajectory.mountedEventRows = 181;
    expect(() => assertWebUiE2eReceipt(receipt)).toThrow();
  });

  it("rejects a dense trajectory without a bounded virtual window", () => {
    const receipt = validReceipt();
    receipt.trajectory.virtualMountedRowCount =
      receipt.trajectory.semanticRowCount;
    expect(() => assertWebUiE2eReceipt(receipt)).toThrow();
  });

  it("rejects undersized credential controls in Settings", () => {
    const receipt = validReceipt();
    receipt.settings.credentialRegisterMinimumControlHeight = 43;
    expect(() => assertWebUiE2eReceipt(receipt)).toThrow();
  });

  it("rejects untranslated deep Settings and Plan copy", () => {
    const receipt = validReceipt();
    receipt.locale.contextTitles.credentials = "Provider credentials";
    expect(() => assertWebUiE2eReceipt(receipt)).toThrow();
  });

  it("rejects false operating-system isolation claims", () => {
    const receipt = validReceipt();
    receipt.browser.osIsolationClaimed = true;
    expect(() => assertWebUiE2eReceipt(receipt)).toThrow();
  });

  it("isolates the machine-level workspace registry inside the E2E root", () => {
    const root = path.resolve("/tmp/napier-web-ui-e2e-contract");
    const environment = productionWebServerEnvironment(root, 0);

    expect(environment.NAPIER_STATE_HOME).toBe(path.join(root, "state"));
    expect(environment.NAPIER_WORKSPACE).toBe(path.join(root, "workspace"));
    expect(environment.NAPIER_HOST_DIRECT_SANDBOX).toBe("1");
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
    schemaVersion: 2,
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
      latestTerminalRunId: "run_fixture01",
      ...WEB_UI_NARRATIVE_EXPECTATION,
    },
    viewports: WEB_UI_E2E_VIEWPORTS.map((viewport) => ({
      ...viewport,
      workspaceNavigation: {
        labels: [...WORKSPACE_VIEW_LABELS],
        selected: "conversation",
        minimumHeight: 32,
      },
      conversation: {
        messageCount: 2,
        waitingApprovalVisible: true,
        internalTrialControlsVisible: false,
        thinking: {
          initiallyOpen: false,
          visible: true,
          transcript: "PRIVATE_FIXTURE_REASONING",
          chromeHidden: true,
          transcriptVisible: true,
          horizontalOverflowPx: 0,
        },
        tool: {
          visible: true,
          input:
            '{\n  "patch": "*** Begin Patch\\n*** Update File: artifacts/research-brief.md\\n@@\\n- Draft\\n+ Verified\\n*** End Patch"\n}',
          output: "Done!\nValidated artifacts/research-brief.md",
          inputLabel: "Diff",
          outputLabel: "Result",
          horizontalOverflowPx: 0,
        },
      },
      chrome: {
        headerNoOverlap: true,
        headerContentWithinBounds: true,
        compactModelContentContained: true,
        textareaOutlineAbsent: true,
        textareaBoxShadowAbsent: true,
        composerFocusVisible: true,
      },
      task: {
        sections: [...DEFAULT_TASK_SECTION_LABELS],
        sectionCount: 3,
        defaultSection: "overview",
        internalTrialControlsVisible: false,
      },
      settings: {
        initiallyHidden: true,
        dialog: true,
        modal: true,
        labels: [...SETTINGS_SECTION_LABELS],
        minimumSectionHeight: 52,
        drawerWithinViewport: true,
        escapeRestoredTriggerFocus: true,
        closedAfterEscape: true,
      },
      geometry: {
        horizontalOverflowPx: 0,
        drawerWithinViewport: true,
      },
      readingAxis: {
        statusWidth: 220,
        statusHeight: 32,
        statusWithinCommandBar: true,
        navigationToStatusGapPx: 8,
        statusToModelGapPx: 8,
        conversationWidth: 800,
        composerWidth: 800,
        maximumCenterDeltaPx: 0,
        messageFontPx: 15,
      },
      layoutSnapshot: Object.fromEntries(
        [
          "workbench",
          "header",
          "status",
          "conversation",
          "composer",
          "views",
          "primary",
        ].map((key) => [key, { x: 0, y: 0, width: 100, height: 50 }]),
      ),
      keyboard: {
        workspaceNavigationPassed: true,
        taskNavigationPassed: true,
      },
      narrative: {
        title: WEB_UI_NARRATIVE_EXPECTATION.title,
        phase: WEB_UI_NARRATIVE_EXPECTATION.phase,
        currentAction: WEB_UI_NARRATIVE_EXPECTATION.currentAction,
        metrics: "1s · 1,680 tokens",
        blocker: WEB_UI_NARRATIVE_EXPECTATION.blocker,
        nextStep: WEB_UI_NARRATIVE_EXPECTATION.nextStep,
        harness: WEB_UI_NARRATIVE_EXPECTATION.harness,
        detailsControlVisible: true,
        refreshPreserved: viewport.width === 1_440,
      },
      console: { errorCount: 0 },
      screenshot: { sha256: "d".repeat(64), bytes: 42 },
    })),
    scenarios: WEB_UI_UX_SCENARIOS.map((id) => ({ id, passed: true })),
    empty: {
      welcomeVisible: true,
      composerVisible: true,
      titleMatched: true,
      internalTrialControlsVisible: false,
    },
    longRun: {
      showEarlierVisible: true,
      mountedFeedItems: 160,
      expandedFeedItems: 175,
      environmentFallbackInitiallyHidden: true,
      environmentFallbackVisible: true,
      environmentFallbackTools: "14 / 42 tools active",
      environmentFallbackRepair: "Run options → Sandbox setup",
      environmentFallbackWithinDetails: true,
      horizontalOverflowPx: 0,
      activityAggregation: {
        collapsedMountedChildren: 0,
        expandedMountedChildren: 12,
      },
    },
    runtime: {
      composerHeight: 120,
      fallbackWarningVisible: true,
      runningIndicatorVisible: true,
      runtimeSectionVisible: true,
      sectionCount: 4,
      browserSurfaceVisible: true,
      runningArtifactPreview: {
        visible: true,
        sandbox: "",
        path: "artifacts/running-preview.html",
      },
      runningArtifactInspector: true,
      browserRail: {
        visible: true,
        rightOfConversation: true,
        alignedToWorkspaceRight: true,
        withinWorkspaceHeight: true,
        horizontalOverflowPx: 0,
      },
    },
    trajectory: {
      title: "Run trajectory",
      eventCount: 214,
      mountedEventRows: 180,
      runCount: 2,
      keyVisible: true,
      virtualizedTimelineVisible: true,
      semanticRowCount: 214,
      virtualMountedRowCount: 24,
      harnessVisible: true,
      harnessFocused: true,
      contextPruningVisible: true,
      contextPruningSaved: true,
      contextContinuityVisible: true,
      contextContinuityBound: true,
    },
    settings: {
      dialog: true,
      modal: true,
      focusTrappedForward: true,
      focusTrappedBackward: true,
      escapeRestoredTriggerFocus: true,
      defaultProductTrialHidden: true,
      ordinaryGovernanceHidden: true,
      developerDialog: true,
      developerModal: true,
      developerLabels: [
        "Automations",
        "Lab & workflow",
        "Publishing",
        "Design system",
      ],
      developerProductTrialAvailable: true,
      receiptTrustAvailable: true,
      revisionHistoryVisible: true,
      revisionHistoryMinimumFontPx: 12,
      revisionHistoryMinimumButtonHeight: 44,
      publishingSurfaceCount: 3,
      packageManagementMinimumFontPx: 12,
      packageManagementMinimumActionHeight: 44,
      credentialRegisterVisible: true,
      credentialRegisterMinimumFontPx: 12,
      credentialRegisterMinimumControlHeight: 44,
      developerEscapeRestoredTriggerFocus: true,
    },
    locale: {
      lang: "zh-CN",
      workspaceLabels: ["对话", "任务", "子智能体", "轨迹"],
      taskSections: ["概览", "变更", "验证"],
      settingsLabels: ["智能体与模型", "记忆", "扩展", "工作区", "语言"],
      developerLabels: ["自动化工作台", "实验与工作流", "发布治理", "设计系统"],
      composerPlaceholder: "给 Napier 一个任务、问题或长期目标……",
      trajectoryTitles: { page: "运行轨迹", map: "运行轨迹" },
      contextTitles: {
        page: "智能体上下文",
        model: "运行模型",
        credentials: "提供商凭证",
      },
      planTitles: {
        studio: "工作流工作室",
        library: "模板库",
        refresh: "刷新模板库",
      },
    },
    artifactNavigation: {
      outputCount: 2,
      answerFileOpenedInspector: true,
      primaryInspection: {
        path: "artifacts/interactive-report.html",
        focusedSourceCard: true,
        openedInOneClick: true,
        hostedInWorkspace: true,
        inspectorWidth: 760,
        conversationWidth: 908,
        workspaceShare: 0.456,
        horizontalOverflowPx: 0,
      },
      inspectorInteraction: {
        controls: ["Preview", "Raw source", "Changes"],
        initialView: "preview",
        htmlSandbox: "allow-scripts",
        htmlInteractionText: "Step 2",
        sourceViewActivated: true,
        sourceContainsInteractiveMarkup: true,
        changesContainsPatch: true,
        previewRestored: true,
        pathPreserved: true,
        previewRequestCount: 2,
        refreshRequestCount: 1,
        diffRequestCount: 1,
        consoleErrorCount: 0,
      },
      intermediateInspections: [
        {
          viewportWidth: 1_440,
          inspectorWidth: 548,
          conversationWidth: 640,
          horizontalOverflowPx: 0,
        },
        {
          viewportWidth: 1_280,
          inspectorWidth: 388,
          conversationWidth: 640,
          horizontalOverflowPx: 0,
        },
      ],
      compactInspection: {
        viewportWidth: 390,
        inspectorWidth: 334,
        inspectorLeft: 56,
        inspectorRight: 390,
        workspaceLeft: 56,
        workspaceWidth: 334,
        position: "absolute",
        horizontalOverflowPx: 0,
      },
      previews: [
        {
          path: "artifacts/interactive-report.html",
          focused: true,
          openedInOneClick: true,
        },
        {
          path: "artifacts/source-notes.md",
          focused: true,
          openedInOneClick: true,
        },
      ],
    },
    recovery: {
      phase: "Recovery blocked",
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
    child.once("exit", (code, signal) => resolve({ code, signal, stderr }));
  });
}
