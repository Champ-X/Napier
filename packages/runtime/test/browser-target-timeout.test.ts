import { writeFile } from "node:fs/promises";
import { errors } from "playwright-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BrowserTargetTimeoutError } from "../src/browser-session-errors.js";
import type { BrowserSessionRequest } from "../src/browser-session-model.js";
import { withBrowserTargetActionFailure } from "../src/browser-target-action.js";
import { BROWSER_TOOL_FAILURE_DECLARATION } from "../src/browser-tool-failure.js";
import { resolveBrowserToolProgress } from "../src/browser-tool-progress.js";
import { resolveDeclaredToolFailure } from "../src/tool-failure-semantics.js";
import { stableOperationBinding } from "../src/tool-operation-binding.js";
import {
  cleanupBrowserSessionHarnesses,
  createBrowserSessionHarness,
} from "./browser-session-harness.js";

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupBrowserSessionHarnesses();
});

describe("Browser target timeout recovery", () => {
  it.each([
    ["click", { action: "click", target: { ref: "e2" } }],
    ["fill", { action: "type", target: { ref: "e2" }, text: "private-value" }],
    [
      "selectOption",
      { action: "select", target: { ref: "e2" }, values: ["one"] },
    ],
    [
      "setInputFiles",
      { action: "upload", target: { ref: "e2" }, path: "upload.txt" },
    ],
  ] satisfies Array<[string, BrowserSessionRequest]>)(
    "keeps the healthy session available after %s times out",
    async (method, request) => {
      const harness = await createBrowserSessionHarness();
      const owner = { threadId: "thread_timeout", runId: "run_timeout" };
      await writeFile(`${harness.workspace}/upload.txt`, "fixture");
      const started = await harness.manager.execute(owner, {
        action: "start",
        url: "https://one.example/start",
      });
      const page = harness.pages[0]!;
      const original = page.locator.bind(page);
      const timeout = new errors.TimeoutError(
        "control intercepts pointer events",
      );
      const failedAction = vi.fn().mockRejectedValue(timeout);
      const locatorSpy = vi
        .spyOn(page, "locator")
        .mockImplementation((selector) => {
          const locator = original(selector);
          return selector === "aria-ref=e2"
            ? { ...locator, [method]: failedAction }
            : locator;
        });
      try {
        const failure = await harness.manager
          .execute(owner, request)
          .catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(BrowserTargetTimeoutError);
        expect(failure).toMatchObject({
          cause: timeout,
          message: expect.stringContaining(timeout.message),
        });
        expect(failedAction).toHaveBeenCalledOnce();
        expect(
          resolveDeclaredToolFailure(
            BROWSER_TOOL_FAILURE_DECLARATION,
            request,
            failure,
          ),
        ).toMatchObject({
          coverage: "trusted_declared",
          modeId: "target_timeout",
          class: "timeout",
          scope: "target",
          disposition: "correct_input",
          fatalToSession: false,
          bindingSha256: stableOperationBinding(
            resolveBrowserToolProgress(request).failureBindings?.target,
          ),
        });
        expect(harness.manager.hasActiveSession(owner)).toBe(true);
        expect(harness.browsers[0]?.closed).toBe(false);
        expect(harness.proxies[0]?.outboundEnabled).toBe(false);
        locatorSpy.mockRestore();
        const snapshot = await harness.manager.execute(owner, {
          action: "snapshot",
        });
        expect(snapshot.details.sessionIdSha256).toBe(
          started.details.sessionIdSha256,
        );
        expect(snapshot.details.sessionReused).toBe(true);
      } finally {
        await harness.manager.cancelRun(owner);
      }
    },
  );

  it("also preserves a confirmed action's session for observation without replaying it", async () => {
    const harness = await createBrowserSessionHarness();
    const owner = {
      threadId: "thread_confirmed_timeout",
      runId: "run_confirmed_timeout",
    };
    const request = { action: "click", target: { ref: "e2" } } as const;
    await harness.manager.execute(owner, {
      action: "start",
      url: "https://one.example/start",
    });
    const state = await harness.manager.captureConfirmationPageState(
      owner,
      request,
    );
    const page = harness.pages[0]!;
    const original = page.locator.bind(page);
    const click = vi
      .fn()
      .mockRejectedValue(new errors.TimeoutError("locator timed out"));
    vi.spyOn(page, "locator").mockImplementation((selector) => ({
      ...original(selector),
      click,
    }));
    try {
      await expect(
        harness.manager.executeConfirmedAction(owner, request, state),
      ).rejects.toBeInstanceOf(BrowserTargetTimeoutError);
      await expect(
        harness.manager.execute(owner, { action: "snapshot" }),
      ).resolves.toMatchObject({ details: { sessionReused: true } });
      expect(click).toHaveBeenCalledOnce();
    } finally {
      await harness.manager.cancelRun(owner);
    }
  });

  it.each([
    new Error("locator.click: Timeout 15000ms exceeded; target_timeout"),
    Object.assign(new Error("target_timeout"), { code: "ETIMEDOUT" }),
    Object.assign(new Error("target_timeout"), { code: "ECONNRESET" }),
    Object.assign(new Error("target_timeout"), { name: "AbortError" }),
  ])(
    "does not turn unrelated errors into recoverable target failures: %s",
    async (error) => {
      await expect(
        withBrowserTargetActionFailure(async () => {
          throw error;
        }),
      ).rejects.toBe(error);
    },
  );

  it("binds failures to the same private target as progress, keeping other controls separate", () => {
    const failure = new BrowserTargetTimeoutError(
      new errors.TimeoutError("diagnostic only"),
    );
    const input = {
      action: "type",
      target: { selector: "#private-email" },
      text: "secret",
    };
    const receipt = resolveDeclaredToolFailure(
      BROWSER_TOOL_FAILURE_DECLARATION,
      input,
      failure,
    );
    const other = { ...input, target: { selector: "#other-field" } };
    expect(receipt.bindingSha256).toBe(
      stableOperationBinding(
        resolveBrowserToolProgress(input).failureBindings?.target,
      ),
    );
    expect(receipt.bindingSha256).not.toBe(
      stableOperationBinding(
        resolveBrowserToolProgress(other).failureBindings?.target,
      ),
    );
    expect(JSON.stringify(receipt)).not.toMatch(/private-email|secret/);
    const navigation = resolveDeclaredToolFailure(
      BROWSER_TOOL_FAILURE_DECLARATION,
      { action: "navigate", url: "https://one.example/" },
      new errors.TimeoutError("diagnostic only"),
    );
    expect(navigation).toMatchObject({
      modeId: "origin_timeout",
      scope: "origin",
      disposition: "alternate_route",
    });
  });
});
