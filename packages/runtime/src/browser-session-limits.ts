import {
  BROWSER_LIVE_VIEWPORT_HEIGHT,
  BROWSER_LIVE_VIEWPORT_WIDTH,
} from "@napier/contracts/browser-live-view";

import { canonicalJson, sha256 } from "./ed25519.js";

export const MAX_ACTIVE_BROWSER_SESSIONS = 2;
export const MAX_BROWSER_SESSION_TABS = 4;
export const MAX_BROWSER_SESSION_OPERATIONS = 64;
export const BROWSER_VIEWPORT_WIDTH = BROWSER_LIVE_VIEWPORT_WIDTH;
export const BROWSER_VIEWPORT_HEIGHT = BROWSER_LIVE_VIEWPORT_HEIGHT;
export const MAX_BROWSER_SNAPSHOT_CHARS = 32_000;
export const MAX_BROWSER_SCREENSHOT_BYTES = 8 * 1024 * 1024;
export const BROWSER_ACTION_TIMEOUT_MS = 15_000;
export const BROWSER_NAVIGATION_TIMEOUT_MS = 30_000;
export const BROWSER_LAUNCH_TIMEOUT_MS = 20_000;
export const MAX_BROWSER_WAIT_MS = 10_000;
export const MAX_BROWSER_FIND_QUERY_CHARS = 256;
export const MAX_BROWSER_FIND_MATCHES = 20;
export const MAX_BROWSER_FIND_SCAN_CHARS = 2_000_000;
export const MAX_BROWSER_SCROLL_PIXELS = 5_000;
export const MAX_BROWSER_VIEWPORT_TEXT_CHARS = 12_000;
export const MAX_BROWSER_CONSOLE_ENTRIES = 50;
export const MAX_BROWSER_WORKSPACE_PREVIEW_FILE_BYTES = 16 * 1024 * 1024;

export const BROWSER_LIMITS_SHA256 = sha256(
  canonicalJson({
    maxActiveSessions: MAX_ACTIVE_BROWSER_SESSIONS,
    maxTabs: MAX_BROWSER_SESSION_TABS,
    maxOperations: MAX_BROWSER_SESSION_OPERATIONS,
    viewportWidth: BROWSER_VIEWPORT_WIDTH,
    viewportHeight: BROWSER_VIEWPORT_HEIGHT,
    maxSnapshotChars: MAX_BROWSER_SNAPSHOT_CHARS,
    maxScreenshotBytes: MAX_BROWSER_SCREENSHOT_BYTES,
    actionTimeoutMs: BROWSER_ACTION_TIMEOUT_MS,
    navigationTimeoutMs: BROWSER_NAVIGATION_TIMEOUT_MS,
    launchTimeoutMs: BROWSER_LAUNCH_TIMEOUT_MS,
    maxWaitMs: MAX_BROWSER_WAIT_MS,
    maxFindQueryChars: MAX_BROWSER_FIND_QUERY_CHARS,
    maxFindMatches: MAX_BROWSER_FIND_MATCHES,
    maxFindScanChars: MAX_BROWSER_FIND_SCAN_CHARS,
    maxScrollPixels: MAX_BROWSER_SCROLL_PIXELS,
    maxViewportTextChars: MAX_BROWSER_VIEWPORT_TEXT_CHARS,
    maxConsoleEntries: MAX_BROWSER_CONSOLE_ENTRIES,
    maxWorkspacePreviewFileBytes: MAX_BROWSER_WORKSPACE_PREVIEW_FILE_BYTES,
    workspacePreview: "same_directory_offline_read_only",
    proxy: "authenticated_fixed_ip_public_http",
    proxyOutbound: "action_scoped_default_deny",
    executableFreshness: "device_inode_size_mtime_before_after_launch",
    topLevelCrossOrigin: "explicit_per_action",
    tabs: "explicit_only",
    tabNetwork: "active_explicit_tab_only",
    popups: "deny_and_close",
    dialogs: "dismiss",
    unsolicitedDownloads: "cancel",
    serviceWorkers: "block",
    browserProfile: "fresh_ephemeral",
  }),
);
