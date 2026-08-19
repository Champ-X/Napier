import { deepMergeCopy, getLocale } from "./locale";
import { browserTaskCopyZh } from "./browser-task-copy.zh";

export const browserTaskCopyEn = {
  panel: {
    title: "Autonomous browser task",
    description:
      "Opt in to Browser Use local or Cloud. Navigation is domain-bound and page interaction is public read-only; Native Playwright remains the default Agent backend.",
  },
  form: {
    backend: "Execution backend",
    backends: {
      browser_use_local: "Browser Use local",
      browser_use_cloud: "Browser Use Cloud",
    },
    retry: "Retry same task",
    startLocal: "Start local task",
    startCloud: "Start Cloud task",
    restoredHistory: "restored history",
    reconnected: "reconnected",
    checking: "Checking for an active browser task…",
    nativeDefault: "Native Playwright remains the default Agent backend.",
    actions: {
      pause: "Pause",
      resume: "Resume agent",
      takeover: "Take over",
      stopping: "Stopping…",
      stop: "Stop",
    },
    statuses: {
      idle: "idle",
      restoring: "restoring",
      starting: "starting",
      running: "running",
      paused: "paused",
      takeover: "takeover",
      stopping: "stopping",
      terminal: "finished",
    },
    scope: {
      task: "Task",
      taskPlaceholder: "Summarize the latest release notes on this site",
      startUrl: "Start URL",
      allowedDomains: "Allowed domains",
      allowedDomainsPlaceholder: "Derived from Start URL, or comma-separated",
    },
    model: {
      provider: "Model provider",
      id: "Model ID",
      credential: "Credential",
      activeCredential: "Active credential",
      secretServerSide: "The secret stays server-side.",
      noActiveCredential: "No active provider credential reference.",
      addCredential:
        "Add one in Context → Credentials, or use an environment override.",
      environmentOverride: "Environment override",
      variableName: "Variable name",
      maximumSteps: "Maximum steps",
      maximumCost: "Maximum cost (USD)",
      availability: {
        unknown: "not yet checked",
        available: "available",
        missing: "missing",
        error: "needs repair",
      },
    },
    localDisclosure: {
      title: "Visible local browser and takeover",
      privacy:
        "This backend opens a separate visible browser with a fresh local profile. Page data stays on this machine except for the selected model provider. Downloads, uploads, typing secrets, purchases, publishing, deletion, and challenge bypass remain disabled.",
      controls:
        "Pause freezes only the agent process. Take over leaves the browser interactive for you; Resume agent makes it re-observe your current page. A detected CAPTCHA enters takeover automatically. Stop closes the task browser and its process group.",
    },
    cloudDisclosure: {
      title: "Cloud data and billing boundary",
      data: "Browser Use receives the task, start URL, allowed domains, page data, and screenshots. Napier sends no workspace files or model secrets; only the Browser Use API key authenticates the request. The read-only policy forbids downloads. Napier disables recording and does not request profiles, proxy, workspace, skills, or secret forwarding. Provider-plan retention applies; zero retention is not assumed.",
      cost: "The USD ceiling is enforced by polling reported provider cost, so usage can cross the ceiling between polls.",
      stop: "Stop tears down the one-off task and session. Cloud v2 Pause and Take over are unavailable.",
      consent: "I understand this task sends page data to Browser Use Cloud.",
      consentRequired: "Cloud data-flow consent is required",
    },
  },
  evidence: {
    cloudActive: "Cloud active",
    credentialConfigured: "credential configured",
    workspaceAccessNone: "workspace access none",
    recordingDisabled: "recording disabled",
    retentionProviderPlan: "retention provider-plan",
    pollStopCeiling: "poll-stop ceiling",
    localVisible: "Local visible",
    agent: "agent",
    controls: "Pause/Take over",
    ready: "ready",
    unavailable: "unavailable",
    captcha: "CAPTCHA",
    automaticTakeover: "auto-takeover",
    handoff: "handoff",
    latestStepAlt: "Latest browser task step",
    step: "Step",
    steps: "Browser task steps",
    observe: "observe",
    agentStates: {
      running: "running",
      paused: "paused",
      takeover: "takeover",
      stopped: "stopped",
      failed: "failed",
      completed: "completed",
      cancelled: "cancelled",
      handoff_required: "handoff required",
    },
  },
  terminal: {
    diagnostic: "Diagnostic",
    cost: "Cost",
    unknown: "unknown",
    artifacts: "Artifacts",
    steps: "steps",
    retentionProviderPlan: "Retention provider-plan",
    statuses: {
      completed: "completed",
      failed: "failed",
      cancelled: "cancelled",
      handoff_required: "handoff required",
    },
  },
};

export const browserTaskCopy = deepMergeCopy(
  browserTaskCopyEn,
  getLocale() === "zh" ? browserTaskCopyZh : {},
);
