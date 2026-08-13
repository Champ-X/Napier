import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

import type {
  BrowserUseCloudObservation,
  BrowserUseLocalObservation,
} from "@napier/runtime";

import { BrowserTaskServiceError } from "./browser-task-error.js";
import type { BrowserTaskEvent } from "./browser-task-types.js";

const MAX_SCREENSHOT_BYTES = 12 * 1024 * 1024;

export async function readBrowserTaskScreenshot(
  record: { events: BrowserTaskEvent[]; screenshotRoot: string },
  step: number,
): Promise<Uint8Array> {
  const observation = record.events
    .slice()
    .reverse()
    .find(
      (
        event,
      ): event is Extract<
        BrowserUseLocalObservation | BrowserUseCloudObservation,
        { type: "step" }
      > =>
        event.type === "step" &&
        event.step === step &&
        Boolean(event.screenshotPath),
    );
  if (!observation?.screenshotPath) return missingScreenshot();
  let screenshotPath: string;
  let screenshotRoot: string;
  try {
    [screenshotPath, screenshotRoot] = await Promise.all([
      realpath(observation.screenshotPath),
      realpath(record.screenshotRoot),
    ]);
  } catch {
    return missingScreenshot();
  }
  if (!screenshotPath.startsWith(`${screenshotRoot}${path.sep}`)) {
    throw new BrowserTaskServiceError(
      "Browser task screenshot is outside its artifact boundary",
      "browser_task_screenshot_invalid",
      409,
    );
  }
  const bytes = await readFile(screenshotPath);
  if (bytes.byteLength > MAX_SCREENSHOT_BYTES) {
    throw new BrowserTaskServiceError(
      "Browser task screenshot exceeds its response limit",
      "browser_task_screenshot_too_large",
      409,
    );
  }
  return bytes;
}

function missingScreenshot(): never {
  throw new BrowserTaskServiceError(
    "Browser task screenshot was not found",
    "browser_task_screenshot_missing",
    404,
  );
}
