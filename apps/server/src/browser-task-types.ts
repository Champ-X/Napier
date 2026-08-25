import type {
  BrowserUseCloudObservation,
  BrowserUseCloudTaskResult,
  BrowserUseLocalControlObservation,
  BrowserUseLocalObservation,
  BrowserUseLocalTaskRequest,
  BrowserUseLocalTaskResult,
} from "@napier/runtime/browser";

export type BrowserTaskBackend = "browser_use_local" | "browser_use_cloud";

export interface BrowserTaskCreateInput {
  backend: BrowserTaskBackend;
  task: string;
  startUrl: string;
  model: BrowserUseLocalTaskRequest["model"];
  credentialEnv: string;
  allowedDomains: string[];
  maxSteps: number;
  maxCostUsd: number;
}

export interface BrowserTaskSnapshot {
  taskId: string;
  backend: BrowserTaskBackend;
  status: "terminal";
  input: BrowserTaskCreateInput;
  events: BrowserTaskEvent[];
}

export type BrowserTaskEvent =
  | BrowserUseLocalObservation
  | BrowserUseLocalTaskResult
  | BrowserUseCloudObservation
  | BrowserUseCloudTaskResult
  | BrowserTaskErrorEvent;

export interface BrowserTaskErrorEvent {
  type: "error";
  backend: BrowserTaskBackend;
  code: string;
  message: string;
  diagnosticSha256: string;
  recovery: string;
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

export interface BrowserTaskStopResult {
  taskId: string;
  status: "stopping";
}

export interface BrowserTaskControlResult {
  taskId: string;
  state: BrowserUseLocalControlObservation["state"];
  message: string;
}
