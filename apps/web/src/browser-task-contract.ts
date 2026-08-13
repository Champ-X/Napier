export type BrowserTaskModelProvider =
  | "openai"
  | "anthropic"
  | "google"
  | "browser-use"
  | "deepseek"
  | "openrouter";

export type BrowserTaskBackend = "browser_use_local" | "browser_use_cloud";

export interface CreateBrowserTaskInput {
  backend: BrowserTaskBackend;
  task: string;
  startUrl: string;
  model: { provider: BrowserTaskModelProvider; id: string };
  credentialEnv: string;
  allowedDomains: string[];
  maxSteps: number;
  maxCostUsd: number;
}

export interface BrowserTaskCreated {
  taskId: string;
  backend: BrowserTaskBackend;
  status: "running";
  streamUrl: string;
  stopUrl: string;
  pauseUrl?: string;
  resumeUrl?: string;
  takeoverUrl?: string;
}

export interface BrowserTaskSnapshot {
  taskId: string;
  backend: BrowserTaskBackend;
  status: "terminal";
  input: CreateBrowserTaskInput;
  events: BrowserTaskApiEvent[];
}

export type BrowserTaskApiEvent =
  | {
      type: "started";
      backend: BrowserTaskBackend;
      model: string;
      allowedDomainCount: number;
      costStatus: "unknown";
      interactionPolicy: "public_read_only";
      startUrl?: string;
      dataFlow?: "task_url_domains_and_page_data_to_browser_use_cloud";
      workspaceAccess?: "none";
      secretForwarding?: "browser_use_api_key_only";
      recording?: "disabled";
      retentionPolicy?: "provider_plan";
      costLimitMode?: "napier_poll_stop";
      maxCostUsd?: number;
      credentialStatus?: "configured";
      pauseAvailable?: boolean;
      takeoverAvailable?: boolean;
      browserVisibility?: "visible";
      browserProduct?: "system_chrome" | "system_chromium";
      browserVersion?: string;
      pauseMode?: "immediate_agent_process" | "unavailable";
      challengeMode?: "automatic_takeover_pause" | "handoff_only";
      cancelMode?:
        | "stop_task_and_session"
        | "terminate_process_group"
        | "terminate_process";
    }
  | {
      type: "step";
      backend: BrowserTaskBackend;
      step: number;
      url: string;
      title: string;
      nextGoal?: string;
      actionNames: string[];
      screenshotUrl?: string;
      errorCode?: string;
      errorMessage?: string;
      errorDiagnosticSha256?: string;
    }
  | {
      type: "control";
      backend: "browser_use_local";
      state: "running" | "paused" | "takeover";
      pauseAvailable: boolean;
      takeoverAvailable: boolean;
      browserVisibility: "visible";
      message: string;
    }
  | {
      type: "completed";
      backend: BrowserTaskBackend;
      status: "completed" | "failed" | "cancelled" | "handoff_required";
      result: string;
      stepCount: number;
      costStatus: "reported" | "unknown";
      costUsd?: number;
      totalTokens?: number;
      recovery?: string;
      artifactDirectory: string;
      providerTaskId?: string;
      retentionPolicy?: "provider_plan";
    }
  | {
      type: "error";
      backend: BrowserTaskBackend;
      code: string;
      message: string;
      diagnosticSha256: string;
      recovery: string;
    };
