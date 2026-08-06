import type { Locator, Page } from "playwright-core";

import {
  assertBrowserUploadCurrent,
  type BrowserPreparedUpload,
  type BrowserWorkspaceFile,
  inspectBrowserUpload,
} from "./browser-workspace-files.js";
import {
  BROWSER_ACTION_TIMEOUT_MS,
  type BrowserElementTarget,
} from "./browser-session-model.js";

export async function performBrowserPageUpload(input: {
  page: Page;
  target: BrowserElementTarget;
  path: string;
  workspaceRoot: string;
  prepared?: BrowserPreparedUpload;
  locator: (page: Page, target: BrowserElementTarget) => Locator;
  withNetwork: <T>(operation: () => Promise<T>) => Promise<T>;
}): Promise<BrowserWorkspaceFile> {
  const file =
    input.prepared ??
    (await inspectBrowserUpload(input.workspaceRoot, input.path));
  await input.withNetwork(() =>
    input.locator(input.page, input.target).setInputFiles(
      input.prepared
        ? {
            name: input.prepared.name,
            mimeType: input.prepared.mimeType,
            buffer: input.prepared.buffer,
          }
        : file.target,
      { timeout: BROWSER_ACTION_TIMEOUT_MS },
    ),
  );
  if (!input.prepared) await assertBrowserUploadCurrent(file);
  return file;
}
