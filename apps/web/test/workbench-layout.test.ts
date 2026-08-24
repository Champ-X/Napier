import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Workbench layout", () => {
  it("pins conversation sections inside the active workspace view", async () => {
    const styles = await readFile(
      new URL("../src/workspace-shell.css", import.meta.url),
      "utf8",
    );

    expect(styles).toContain(
      'grid-template-areas:\n    "header"\n    "content"',
    );
    expect(styles).toContain(
      '"notices"\n    "conversation"\n    "decisions"\n    "composer"',
    );
    expect(styles).toContain(
      "grid-template-rows: auto minmax(0, 1fr) auto auto;",
    );
    expect(styles).toContain(".workspace-primary-surface");
    expect(styles).toContain(".conversation-workspace-view");
    expect(styles).toContain(".trajectory-workspace-view");
    expect(styles).toContain(".task-workspace-view");
  });

  it("keeps blockers and next actions independently visible", async () => {
    const [source, boundary, featureStyles, globalStyles] = await Promise.all([
      readFile(new URL("../src/TaskNarrativeBar.tsx", import.meta.url), "utf8"),
      readFile(
        new URL("../src/TaskNarrativeBoundary.tsx", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../src/task-narrative.css", import.meta.url), "utf8"),
      readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    ]);

    expect(source).toContain("{narrative.blocker ? (");
    expect(source).toContain("{narrative.nextStep ? (");
    expect(source).not.toContain(") : narrative.nextStep ? (");
    expect(source).toContain("aria-label={shellCopy.taskNarrative.controls}");
    expect(source).toContain("copy.narrative.browserControls");
    expect(source).toContain("onClick={onStop}");
    expect(boundary).toContain('import "./task-narrative.css"');
    expect(featureStyles).toContain(
      ".task-status-details > summary:focus-visible",
    );
    expect(featureStyles).toContain(".task-completion-strip");
    expect(featureStyles).toContain(".task-completion-toggle[aria-expanded");
    expect(featureStyles).toContain(".task-result-summary");
    expect(featureStyles).toContain("z-index: 30");
    expect(featureStyles).toContain("@media (forced-colors: active)");
    expect(globalStyles).not.toContain(".task-narrative {");
  });

  it("opens produced outputs through the Task Changes surface", async () => {
    const [app, navigation, summary, task, shell] = await Promise.all([
      readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
      readFile(
        new URL("../src/use-task-control-navigation.ts", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../src/TaskCompletionSummary.tsx", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../src/TaskWorkspace.tsx", import.meta.url), "utf8"),
      readFile(
        new URL("../src/use-workspace-shell.ts", import.meta.url),
        "utf8",
      ),
    ]);

    expect(summary).toContain("onClick={() => onOpenArtifact(path)}");
    expect(navigation).toContain('candidate.dataset["artifactPath"] === path');
    expect(navigation).toContain('openInspector("files")');
    expect(app).toContain("onOpenArtifact={taskControls.openArtifact}");
    expect(shell).toContain('files: "changes"');
    expect(shell).toContain('setWorkspaceView("task")');
    expect(task).toContain("<TaskChangesPanel");
  });

  it("keeps environment setup styles feature-owned and state-complete", async () => {
    const [provider, sandbox, providerStyles, sandboxStyles, globalStyles] =
      await Promise.all([
        readFile(
          new URL("../src/ProviderSetupCard.tsx", import.meta.url),
          "utf8",
        ),
        readFile(
          new URL("../src/SandboxSetupCard.tsx", import.meta.url),
          "utf8",
        ),
        readFile(new URL("../src/provider-setup.css", import.meta.url), "utf8"),
        readFile(new URL("../src/sandbox-setup.css", import.meta.url), "utf8"),
        readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
      ]);

    expect(provider).toContain('import "./provider-setup.css"');
    expect(sandbox).toContain('import "./sandbox-setup.css"');
    expect(providerStyles).toContain(":focus-visible");
    expect(providerStyles).toContain('[aria-busy="true"]');
    expect(sandboxStyles).toContain("button.danger");
    expect(sandboxStyles).toContain("@media (forced-colors: active)");
    expect(globalStyles).not.toContain(".provider-setup-card {");
    expect(globalStyles).not.toContain(".sandbox-setup-card {");
  });

  it("keeps Browser task and takeover styles feature-owned and state-complete", async () => {
    const [
      task,
      live,
      confirmation,
      takeover,
      taskStyles,
      liveStyles,
      takeoverStyles,
      globalStyles,
    ] = await Promise.all([
      readFile(
        new URL("../src/BrowserUseLocalTaskPanel.tsx", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../src/BrowserLiveViewSurface.tsx", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL(
          "../src/BrowserInteractionConfirmationPanel.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL("../src/BrowserTakeoverDesk.tsx", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../src/browser-task.css", import.meta.url), "utf8"),
      readFile(
        new URL("../src/browser-live-view.css", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../src/browser-takeover-shell.css", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    ]);

    expect(task).toContain('import "./browser-task.css"');
    expect(task).toContain('import "./browser-task-boundaries.css"');
    expect(live).toContain('import "./browser-live-view.css"');
    expect(confirmation).toContain(
      'import "./browser-interaction-confirmation.css"',
    );
    expect(takeover).toContain('import "./browser-takeover-shell.css"');
    expect(takeover).toContain('import "./browser-takeover-controls.css"');
    expect(taskStyles).toContain(":focus-visible");
    expect(liveStyles).toContain('[aria-busy="true"]');
    expect(takeoverStyles).toContain(":active:not(:disabled)");
    expect(takeoverStyles).toContain("@media (forced-colors: active)");
    expect(globalStyles).not.toContain(".browser-live-view {");
    expect(globalStyles).not.toContain(".browser-takeover-desk {");
    expect(globalStyles).not.toContain(".browser-interaction-confirmation {");
  });

  it("keeps Context as a composition surface with bounded UI sections", async () => {
    const componentNames = [
      "ContextPanel",
      "ContextRunModelCard",
      "ContextAgentProfileForm",
      "ContextAgentIdentityFields",
      "ContextPromptVariablesFieldset",
      "ContextPromptVariableRow",
      "ContextCapabilityFields",
      "ContextRecoveryPolicyFieldset",
      "ContextModelAdvisorFieldset",
      "ContextToolLoopGuardFieldset",
      "ContextBudgetFieldsets",
      "ContextPackageManagement",
      "ContextWorkspaceEvidence",
    ];
    const sources = await Promise.all(
      componentNames.map((name) =>
        readFile(new URL(`../src/${name}.tsx`, import.meta.url), "utf8"),
      ),
    );
    const panel = sources[0]!;

    expect(panel).toContain("useContextPanelController(props)");
    expect(panel).toContain("<ContextAgentProfileForm");
    expect(panel).toContain("<ContextPackageManagement");
    expect(panel).toContain("<ContextWorkspaceEvidence");
    for (const source of sources) {
      expect(source.trimEnd().split("\n").length).toBeLessThanOrEqual(300);
      expect(source).toMatch(/export (interface|type) \w+Props/u);
    }
  });

  it("keeps Context styles feature-owned and state-complete", async () => {
    const [
      panel,
      shellStyles,
      policyStyles,
      variableStyles,
      evidenceStyles,
      globalStyles,
    ] = await Promise.all([
      readFile(new URL("../src/ContextPanel.tsx", import.meta.url), "utf8"),
      readFile(
        new URL("../src/context-panel-shell.css", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../src/context-profile-policies.css", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../src/context-profile-variables.css", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../src/context-workspace-evidence.css", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    ]);

    expect(panel).toContain('import "./context-panel-shell.css"');
    expect(panel).toContain('import "./context-profile-policies.css"');
    expect(panel).toContain('import "./context-profile-variables.css"');
    expect(panel).toContain('import "./context-workspace-evidence.css"');
    expect(shellStyles).toContain(":focus-visible");
    expect(shellStyles).toContain('[aria-busy="true"]');
    expect(policyStyles).toContain(":has(input:focus-visible)");
    expect(policyStyles).toContain("@media (forced-colors: active)");
    expect(variableStyles).toContain("@container context-panel");
    expect(evidenceStyles).toContain("@media (forced-colors: active)");
    expect(globalStyles).not.toContain(".context-workbench {");
    expect(globalStyles).not.toContain(".context-runtime-card");
    expect(globalStyles).not.toContain(".agent-config-sheet");
    expect(globalStyles).not.toContain(".context-prompt-variables");
    expect(globalStyles).not.toContain(".context-tool-loop-guard");
    expect(globalStyles).not.toContain(".context-option-grid");
    expect(globalStyles).not.toContain(".context-ledger {");
  });

  it("keeps Plan as a bounded composition surface with local interaction states", async () => {
    const componentNames = [
      "PlanPanel",
      "PlanCurrentSheet",
      "PlanOverviewHeader",
      "PlanReplanDraftCard",
      "PlanReplanHistory",
      "PlanReplanRecordCard",
      "PlanStepList",
    ];
    const [sources, interactionStyles] = await Promise.all([
      Promise.all(
        componentNames.map((name) =>
          readFile(new URL(`../src/${name}.tsx`, import.meta.url), "utf8"),
        ),
      ),
      readFile(
        new URL("../src/plan-panel-interactions.css", import.meta.url),
        "utf8",
      ),
    ]);
    const panel = sources[0]!;

    expect(panel).toContain('import "./plan-panel-interactions.css"');
    expect(panel).toContain("usePlanReplanController");
    expect(panel).toContain("<PlanCurrentSheet");
    expect(panel).toContain("<PlanBlueprintLibraryCard");
    for (const source of sources) {
      expect(source.trimEnd().split("\n").length).toBeLessThanOrEqual(300);
      expect(source).toMatch(/export (interface|type) \w+Props/u);
    }
    expect(interactionStyles).toContain(":hover:not(:disabled)");
    expect(interactionStyles).toContain(":focus-visible");
    expect(interactionStyles).toContain(":active:not(:disabled)");
    expect(interactionStyles).toContain(":disabled");
    expect(interactionStyles).toContain('[aria-busy="true"]');
    expect(interactionStyles).toContain("@container plan-panel");
    expect(interactionStyles).toContain("@media (forced-colors: active)");
  });

  it("keeps Automation as bounded controllers and state-complete views", async () => {
    const componentNames = [
      "AutomationPanel",
      "AutomationRecoverySection",
      "AutomationScheduleSection",
      "AutomationChannelComposer",
      "AutomationChannelTokenCard",
      "AutomationChannelSection",
      "AutomationChannelCard",
      "AutomationChannelSummary",
      "AutomationChannelEditors",
      "AutomationAdapterPreviewReceipt",
      "AutomationDeadLetterExportEvidence",
      "AutomationDeadLetterRetryEvidence",
      "AutomationDeadLetterHistoryEvidence",
      "AutomationDeliveryList",
    ];
    const controllerNames = [
      "automation-channel-card-types",
      "automation-channel-composer-actions",
      "automation-channel-runtime-actions",
      "automation-dead-letter-artifact-actions",
      "automation-dead-letter-history-actions",
      "automation-panel-helpers",
      "use-automation-operation",
      "use-automation-schedule-controller",
      "use-automation-channel-composer-controller",
      "use-automation-channel-runtime-controller",
      "use-automation-channel-card-editor",
      "use-automation-dead-letter-history",
      "use-automation-dead-letter-artifacts",
      "use-automation-recovery-refresh",
      "use-automation-panel-controller",
      "use-active-channel-delivery-polling",
      "use-dead-letter-history-preload",
    ];
    const [components, controllers, interactionStyles] = await Promise.all([
      Promise.all(
        componentNames.map((name) =>
          readFile(new URL(`../src/${name}.tsx`, import.meta.url), "utf8"),
        ),
      ),
      Promise.all(
        controllerNames.map((name) =>
          readFile(new URL(`../src/${name}.ts`, import.meta.url), "utf8"),
        ),
      ),
      readFile(
        new URL("../src/automation-panel-interactions.css", import.meta.url),
        "utf8",
      ),
    ]);

    expect(components[0]).toContain(
      'import "./automation-panel-interactions.css"',
    );
    expect(components[0]).toContain("useAutomationPanelController(props)");
    for (const source of components) {
      expect(source.trimEnd().split("\n").length).toBeLessThanOrEqual(300);
      expect(source).toMatch(/export (interface|type) \w+Props/u);
    }
    for (const source of controllers) {
      expect(source.trimEnd().split("\n").length).toBeLessThanOrEqual(300);
    }
    expect(interactionStyles).toContain(":hover:not(:disabled)");
    expect(interactionStyles).toContain(":focus-visible");
    expect(interactionStyles).toContain(":active:not(:disabled)");
    expect(interactionStyles).toContain(":disabled");
    expect(interactionStyles).toContain('[aria-busy="true"]');
    expect(interactionStyles).toContain("@container automation-panel");
    expect(interactionStyles).toContain("@media (forced-colors: active)");
  });

  it("keeps Receipt Trust as bounded task desks with feature-owned states", async () => {
    const componentNames = [
      "ReceiptTrustPanel",
      "ReceiptTrustAnchorDesk",
      "ReceiptTrustVerifierDesk",
      "ReceiptTrustDirectoryDesk",
      "ReceiptTrustDirectorySubscriptions",
      "ReceiptTrustBaselineDesk",
      "ReceiptTrustBaselineActions",
      "ReceiptTrustSelectionActions",
      "ReceiptTrustBaselineEvidence",
      "ReceiptTrustCheckpointDesk",
      "ReceiptTrustCheckpointSubscriptions",
      "ReceiptTrustCheckpointEvidence",
      "ReceiptTrustFileAction",
      "ReceiptTrustEvidence",
    ];
    const controllerNames = [
      "receipt-trust-action-context",
      "receipt-trust-anchor-actions",
      "receipt-trust-baseline-actions",
      "receipt-trust-checkpoint-actions",
      "receipt-trust-checkpoint-registry-actions",
      "receipt-trust-controller-projection",
      "receipt-trust-controller-types",
      "receipt-trust-directory-actions",
      "receipt-trust-helpers",
      "receipt-trust-rotation-actions",
      "receipt-trust-selection-actions",
      "receipt-trust-state-actions",
      "use-receipt-trust-controller",
      "use-receipt-trust-operation",
      "use-receipt-trust-preload",
    ];
    const [components, controllers, styles] = await Promise.all([
      Promise.all(
        componentNames.map((name) =>
          readFile(new URL(`../src/${name}.tsx`, import.meta.url), "utf8"),
        ),
      ),
      Promise.all(
        controllerNames.map((name) =>
          readFile(new URL(`../src/${name}.ts`, import.meta.url), "utf8"),
        ),
      ),
      Promise.all(
        [
          "receipt-trust-layout.css",
          "receipt-trust-interactions.css",
          "receipt-trust-evidence.css",
        ].map((name) =>
          readFile(new URL(`../src/${name}`, import.meta.url), "utf8"),
        ),
      ).then((parts) => parts.join("\n")),
    ]);

    expect(components[0]).toContain("useReceiptTrustController(props)");
    expect(components[0]).toContain('import "./receipt-trust-layout.css"');
    for (const source of components) {
      expect(source.trimEnd().split("\n").length).toBeLessThanOrEqual(300);
      expect(source).toMatch(/export (interface|type) \w+Props/u);
    }
    for (const source of controllers) {
      expect(source.trimEnd().split("\n").length).toBeLessThanOrEqual(300);
    }
    expect(styles).toContain(":hover:not(:disabled)");
    expect(styles).toContain(":focus-visible");
    expect(styles).toContain(":active:not(:disabled)");
    expect(styles).toContain(":disabled");
    expect(styles).toContain('[aria-busy="true"]');
    expect(styles).toContain("@container");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain("@media (forced-colors: active)");
    expect(styles).not.toMatch(/#[0-9a-f]{3,8}\b/iu);
  });

  it("reflows the shell to a single column without page-level horizontal scroll below 720px", async () => {
    const [motion, global, markdown, trajectory] = await Promise.all([
      readFile(
        new URL("../src/styles/motion-responsive.css", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../src/styles/global.css", import.meta.url), "utf8"),
      readFile(new URL("../src/message-markdown.css", import.meta.url), "utf8"),
      readFile(new URL("../src/trace-trajectory.css", import.meta.url), "utf8"),
    ]);

    // Design §18.1: the page floor is 320px and the body itself never scrolls
    // horizontally — only inner containers may.
    expect(global).toContain("min-width: 320px;");
    expect(global).toContain("overflow: hidden;");

    // Design §13 narrow ladder introduces finer breakpoints than the 780px rail.
    expect(motion).toContain("@media (max-width: 720px)");
    expect(motion).toContain("@media (max-width: 560px)");
    expect(motion).toContain("@media (max-width: 390px)");

    // §13: 序号轨道隐藏 — the execution number spine collapses to one column.
    const narrow = motion.slice(motion.indexOf("@media (max-width: 560px)"));
    expect(narrow).toContain(".message-gutter {\n    display: none;");
    expect(narrow).toContain(
      ".message-card {\n    grid-template-columns: minmax(0, 1fr);",
    );
    // The content axis and composer stop reserving the desktop reading cap so
    //普通文本 fills the narrow viewport instead of overflowing it.
    expect(narrow).toContain(".message-ledger,\n  .composer {\n    width: auto;");
    // §13: 任务步骤单列。
    expect(narrow).toContain(
      ".task-artifact-grid {\n    grid-template-columns: minmax(0, 1fr);",
    );

    // §18.1: 图表、表格、diff、代码 keep their own overflow:auto containers.
    expect(markdown).toContain(".message-code-block {");
    expect(markdown).toMatch(/\.message-code-block \{[^}]*overflow: auto;/su);
    expect(markdown).toMatch(/\.message-table-wrap \{[^}]*overflow: auto;/su);
    expect(trajectory).toContain("container-type: inline-size");

    // The reflow rules must remain literal-color free (motion-responsive.css is
    // implicitly ceilinged at zero by check-web-design.mjs).
    expect(narrow).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/iu);
  });
});
