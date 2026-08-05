import type {
  PinnedBrowserRuntimeInspection,
  PinnedBrowserRuntimeInstallDependencies,
} from "@napier/runtime/browser-runtime-setup";

export interface BrowserRuntimeVerification {
  executableSha256: string;
  destinationCount: number;
  chromiumSandbox: true;
}

export interface BrowserRuntimeSetupDependencies extends PinnedBrowserRuntimeInstallDependencies {
  verify?: (
    workspaceRoot: string,
    runtime: NonNullable<PinnedBrowserRuntimeInspection["runtime"]>,
    signal: AbortSignal,
  ) => Promise<BrowserRuntimeVerification>;
  markVerified?: (input: {
    target: PinnedBrowserRuntimeInspection["target"];
    runtime: NonNullable<PinnedBrowserRuntimeInspection["runtime"]>;
  }) => Promise<void>;
}
