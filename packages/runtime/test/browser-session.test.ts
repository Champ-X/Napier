import { readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_ACTIVE_BROWSER_SESSIONS,
  type BrowserSessionOwner,
} from "../src/browser-session.js";
import {
  cleanupBrowserSessionHarnesses,
  createBrowserSessionHarness as createHarness,
} from "./browser-session-harness.js";

afterEach(async () => {
  await cleanupBrowserSessionHarnesses();
});

describe("RunBrowserSessionManager", () => {
  it("reuses one isolated Session and returns bounded snapshots and screenshots", async () => {
    const harness = await createHarness();
    const owner = { threadId: "thread_one", runId: "run_one" };

    const started = await harness.manager.execute(owner, {
      action: "start",
      url: "https://one.example/",
    });
    const live = await harness.manager.captureLiveView(owner);
    const waited = await harness.manager.execute(owner, {
      action: "wait",
      durationMs: 5,
    });
    const snapshot = await harness.manager.execute(owner, {
      action: "snapshot",
    });
    const typed = await harness.manager.execute(owner, {
      action: "type",
      target: { ref: "e2" },
      text: "private input",
    });
    const screenshot = await harness.manager.execute(owner, {
      action: "screenshot",
    });
    const closed = await harness.manager.execute(owner, { action: "close" });

    expect([
      started.details.sessionOperation,
      waited.details.sessionOperation,
      snapshot.details.sessionOperation,
      typed.details.sessionOperation,
      screenshot.details.sessionOperation,
      closed.details.sessionOperation,
    ]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(live.receipt).toEqual(
      expect.objectContaining({
        kind: "napier.browser-live-view",
        schemaVersion: 4,
        threadId: owner.threadId,
        runId: owner.runId,
        sessionIdSha256: started.details.sessionIdSha256,
        sessionOperation: 1,
        imageSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        imageBytes: Buffer.byteLength("fake png"),
        mimeType: "image/png",
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        pageDiagnosis: {
          status: "none",
          signalCount: 0,
          signalsSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          takeoverRecommended: false,
        },
      }),
    );
    expect(live.image).toEqual(Buffer.from("fake png"));
    expect(started.details.sessionReused).toBe(false);
    expect(snapshot.details.sessionReused).toBe(true);
    expect(snapshot.details.sessionIdSha256).toBe(
      started.details.sessionIdSha256,
    );
    expect(snapshot.output).toContain("[ref=e2]");
    expect(waited.output).toContain("[ref=e2]");
    expect(screenshot.screenshot).toEqual({
      data: Buffer.from("fake png").toString("base64"),
      mimeType: "image/png",
    });
    expect(harness.pages[0]?.filled).toEqual([
      { selector: "aria-ref=e2", text: "private input" },
    ]);
    expect(harness.launchOptions).toHaveLength(1);
    expect(harness.launchOptions[0]).toEqual(
      expect.objectContaining({
        chromiumSandbox: true,
        headless: true,
        proxy: expect.objectContaining({
          server: "http://127.0.0.1:32100",
          bypass: "<-loopback>",
        }),
      }),
    );
    expect(harness.launchOptions[0]?.env?.["HOME"]).not.toBe(
      process.env["HOME"],
    );
    expect(harness.launchOptions[0]?.args).toContain(
      "--disable-crash-reporter",
    );
    expect(harness.proxies[0]?.outboundTransitions).toEqual([
      true,
      false,
      true,
      false,
      true,
      false,
    ]);
    expect(harness.proxies[0]?.closed).toBe(true);
    await expect(
      harness.manager.execute(owner, { action: "snapshot" }),
    ).rejects.toThrow("not active");
  });

  it("routes login and challenge structures to privacy-safe human handoff", async () => {
    const loginHarness = await createHarness({
      pageHtml:
        '<html><head><title>Sign in</title></head><body><form><input name="email"><input type="password" value="PRIVATE_PASSWORD"></form></body></html>',
    });
    const loginOwner = {
      threadId: "thread_login_diagnosis",
      runId: "run_login_diagnosis",
    };
    const login = await loginHarness.manager.execute(loginOwner, {
      action: "start",
      url: "https://one.example/login",
    });
    const loginLive = await loginHarness.manager.captureLiveView(loginOwner);

    expect(login.details.pageDiagnosis).toEqual(
      expect.objectContaining({
        status: "login_required",
        signalCount: 2,
        takeoverRecommended: true,
      }),
    );
    expect(login.output).toContain("Ask the user to take control");
    expect(login.output).not.toContain("PRIVATE_PASSWORD");
    expect(loginLive.receipt.pageDiagnosis).toEqual(
      login.details.pageDiagnosis,
    );
    expect(loginHarness.proxies[0]?.outboundTransitions).toEqual([true, false]);
    await loginHarness.manager.cancelRun(loginOwner);

    const challengeHarness = await createHarness({
      pageHtml:
        '<html><head><title>Just a moment</title></head><body><div class="cf-turnstile"></div><iframe src="https://challenges.cloudflare.com/cdn-cgi/challenge-platform/widget"></iframe></body></html>',
    });
    const challengeOwner = {
      threadId: "thread_challenge_diagnosis",
      runId: "run_challenge_diagnosis",
    };
    const challenge = await challengeHarness.manager.execute(challengeOwner, {
      action: "start",
      url: "https://one.example/cdn-cgi/challenge-platform/",
    });

    expect(challenge.details.pageDiagnosis).toEqual(
      expect.objectContaining({
        status: "challenge_detected",
        signalCount: 4,
        takeoverRecommended: true,
      }),
    );
    expect(challenge.output).toContain("CAPTCHA solving is not automated");
    await challengeHarness.manager.cancelRun(challengeOwner);
  });

  it("does not diagnose article text that merely discusses login or CAPTCHA", async () => {
    const harness = await createHarness({
      sourceText:
        "This article explains CAPTCHA, login walls, and how to verify you are human.",
      sourceTitle: "How login and CAPTCHA systems work",
    });
    const owner = {
      threadId: "thread_diagnosis_article",
      runId: "run_diagnosis_article",
    };

    const started = await harness.manager.execute(owner, {
      action: "start",
      url: "https://one.example/articles/captcha-login",
    });
    const found = await harness.manager.execute(owner, {
      action: "find",
      query: "CAPTCHA",
    });

    expect(started.details.pageDiagnosis).toEqual(
      expect.objectContaining({
        status: "none",
        signalCount: 0,
        takeoverRecommended: false,
      }),
    );
    expect(found.details.pageDiagnosis.status).toBe("none");
    expect(started.output).not.toContain("Ask the user to take control");
    await harness.manager.cancelRun(owner);
  });

  it("captures bounded normalized page text without reopening network access", async () => {
    const harness = await createHarness({
      sourceText:
        "  Research heading  \n\nEvidence\twith   spacing\u001b[31m\nFinal evidence",
      sourceTitle: "  Research\u001b  title  ",
    });
    const owner = { threadId: "thread_capture", runId: "run_capture" };
    await harness.manager.execute(owner, {
      action: "start",
      url: "https://one.example/research",
    });

    const capture = await harness.manager.capturePage(owner, 12_000);

    expect(capture).toEqual(
      expect.objectContaining({
        url: "https://one.example/research",
        title: "Research title",
        lines: [
          "Research heading",
          "Evidence with spacing [31m",
          "Final evidence",
        ],
        textChars: 58,
        truncated: false,
        sessionOperation: 2,
      }),
    );
    expect(capture.capturedContentSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(harness.proxies[0]?.outboundTransitions).toEqual([true, false]);
    await harness.manager.cancelRun(owner);
  });

  it("finds and scrolls long pages without reopening network access", async () => {
    const harness = await createHarness({
      sourceText: [
        "Long page introduction",
        "Target evidence appears here",
        "Long page conclusion",
      ].join("\n"),
    });
    const owner = { threadId: "thread_observe", runId: "run_observe" };
    await harness.manager.execute(owner, {
      action: "start",
      url: "https://one.example/long",
    });

    const found = await harness.manager.execute(owner, {
      action: "find",
      query: "target evidence",
    });
    const scrolled = await harness.manager.execute(owner, {
      action: "scroll",
      direction: "down",
      pixels: 800,
    });
    const returned = await harness.manager.execute(owner, {
      action: "scroll",
      direction: "up",
      pixels: 200,
    });

    expect(found.output).toContain("2 | Target evidence appears here");
    expect(found.details).toEqual(
      expect.objectContaining({
        action: "find",
        sessionOperation: 2,
        findQuerySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        findQueryChars: 15,
        findMatchCount: 1,
        findScannedChars: 72,
        findTruncated: false,
      }),
    );
    expect(scrolled.output).toContain("Viewport evidence at 800");
    expect(scrolled.details).toEqual(
      expect.objectContaining({
        action: "scroll",
        sessionOperation: 3,
        scrollDeltaY: 800,
        scrollPositionY: 800,
        scrollViewportHeight: 900,
        scrollDocumentHeight: 3_000,
        scrollAtStart: false,
        scrollAtEnd: false,
        viewportTextChars: 24,
      }),
    );
    expect(returned.details).toEqual(
      expect.objectContaining({
        action: "scroll",
        sessionOperation: 4,
        scrollDeltaY: -200,
        scrollPositionY: 600,
      }),
    );
    expect(harness.proxies[0]?.outboundTransitions).toEqual([true, false]);
    await harness.manager.cancelRun(owner);
  });

  it("rejects invalid find and scroll bounds before page evaluation", async () => {
    const findHarness = await createHarness();
    const findOwner = {
      threadId: "thread_invalid_find",
      runId: "run_invalid_find",
    };
    await findHarness.manager.execute(findOwner, {
      action: "start",
      url: "https://one.example/long",
    });
    await expect(
      findHarness.manager.execute(findOwner, {
        action: "find",
        query: " \u0000 ",
      }),
    ).rejects.toThrow("find query is invalid");
    expect(findHarness.browsers[0]?.closed).toBe(true);

    const scrollHarness = await createHarness();
    const scrollOwner = {
      threadId: "thread_invalid_scroll",
      runId: "run_invalid_scroll",
    };
    await scrollHarness.manager.execute(scrollOwner, {
      action: "start",
      url: "https://one.example/long",
    });
    await expect(
      scrollHarness.manager.execute(scrollOwner, {
        action: "scroll",
        direction: "down",
        pixels: 5_001,
      }),
    ).rejects.toThrow("scroll distance is invalid");
    expect(scrollHarness.browsers[0]?.closed).toBe(true);
  });

  it("closes an uncertain Session when the page URL drifts during capture", async () => {
    const harness = await createHarness({ sourceUrlDriftDuringCapture: true });
    const owner = {
      threadId: "thread_capture_drift",
      runId: "run_capture_drift",
    };
    await harness.manager.execute(owner, {
      action: "start",
      url: "https://one.example/research",
    });

    await expect(harness.manager.capturePage(owner, 12_000)).rejects.toThrow(
      "page changed",
    );
    expect(harness.browsers[0]?.closed).toBe(true);
    await expect(
      harness.manager.execute(owner, { action: "snapshot" }),
    ).rejects.toThrow("not active");
  });

  it("denies cross-origin redirects unless the current action authorizes them", async () => {
    const redirects = new Map([
      ["https://one.example/redirect", "https://two.example/final"],
    ]);
    const denied = await createHarness({ redirects });
    const owner = { threadId: "thread_redirect", runId: "run_redirect" };

    await expect(
      denied.manager.execute(owner, {
        action: "start",
        url: "https://one.example/redirect",
      }),
    ).rejects.toThrow("Cross-origin navigation requires allowCrossOrigin");
    expect(denied.proxies[0]?.closed).toBe(true);

    const allowed = await createHarness({ redirects });
    const result = await allowed.manager.execute(owner, {
      action: "start",
      url: "https://one.example/redirect",
      allowCrossOrigin: true,
    });
    expect(result.output).toContain("https://two.example/final");
    expect(result.details.crossOriginAuthorized).toBe(true);
    await allowed.manager.cancelRun(owner);
  });

  it("rejects private DNS before creating a proxy or browser", async () => {
    const harness = await createHarness({
      lookup: async (hostname) =>
        hostname === "private.example"
          ? [{ address: "127.0.0.1", family: 4 }]
          : [{ address: "1.1.1.1", family: 4 }],
    });
    const owner = { threadId: "thread_private", runId: "run_private" };

    await expect(
      harness.manager.execute(owner, {
        action: "start",
        url: "https://private.example/",
      }),
    ).rejects.toThrow("private or reserved");
    expect(harness.proxies).toEqual([]);
    expect(harness.browsers).toEqual([]);
  });

  it("binds explicit uploads and downloads to workspace files", async () => {
    const harness = await createHarness({
      downloadBody: "downloaded content",
    });
    await writeFile(path.join(harness.workspace, "upload.txt"), "upload body");
    const owner = { threadId: "thread_files", runId: "run_files" };
    await harness.manager.execute(owner, {
      action: "start",
      url: "https://one.example/",
    });

    const upload = await harness.manager.execute(owner, {
      action: "upload",
      target: { selector: "#upload" },
      path: "upload.txt",
    });
    expect(upload.details.file).toEqual(
      expect.objectContaining({ fileBytes: 11 }),
    );
    expect(harness.pages[0]?.uploaded).toEqual([
      {
        selector: "#upload",
        path: await realpath(path.join(harness.workspace, "upload.txt")),
      },
    ]);

    const download = await harness.manager.execute(owner, {
      action: "download",
      target: { ref: "e3" },
      path: "download.txt",
    });
    expect(download.details.file).toEqual(
      expect.objectContaining({ fileBytes: 18 }),
    );
    await expect(
      readFile(path.join(harness.workspace, "download.txt"), "utf8"),
    ).resolves.toBe("downloaded content");
    expect(harness.downloads[0]?.deleted).toBe(true);
    await harness.manager.cancelRun(owner);
  });

  it("rejects an unsafe download target before clicking the page", async () => {
    const harness = await createHarness();
    const owner = {
      threadId: "thread_download_preflight",
      runId: "run_download_preflight",
    };
    await harness.manager.execute(owner, {
      action: "start",
      url: "https://one.example/",
    });

    await expect(
      harness.manager.execute(owner, {
        action: "download",
        target: { ref: "e3" },
        path: "../escape.txt",
      }),
    ).rejects.toThrow("escapes");
    expect(harness.pages[0]?.clicked).toEqual([]);
    expect(harness.browsers[0]?.closed).toBe(true);
  });

  it("executes navigate, select, click, and back through one Session", async () => {
    const harness = await createHarness();
    const owner = { threadId: "thread_actions", runId: "run_actions" };
    await harness.manager.execute(owner, {
      action: "start",
      url: "https://one.example/root",
    });
    await harness.manager.execute(owner, {
      action: "navigate",
      url: "https://one.example/next",
    });
    await harness.manager.execute(owner, {
      action: "select",
      target: { selector: "#choice" },
      values: ["one", "two"],
    });
    await harness.manager.execute(owner, {
      action: "click",
      target: { ref: "e2" },
    });
    const back = await harness.manager.execute(owner, { action: "back" });

    expect(back.output).toContain("https://one.example/root");
    expect(harness.pages[0]?.selected).toEqual([
      { selector: "#choice", values: ["one", "two"] },
    ]);
    expect(harness.pages[0]?.clicked).toEqual(["aria-ref=e2"]);
    await harness.manager.execute(owner, { action: "close" });
  });

  it("owns bounded explicit tabs with independent history and selected-tab capture", async () => {
    const harness = await createHarness();
    const owner = { threadId: "thread_tabs", runId: "run_tabs" };
    const started = await harness.manager.execute(owner, {
      action: "start",
      url: "https://one.example/root",
    });
    await harness.manager.execute(owner, {
      action: "navigate",
      url: "https://one.example/next",
    });
    const backed = await harness.manager.execute(owner, { action: "back" });
    const forwarded = await harness.manager.execute(owner, {
      action: "forward",
    });
    const opened = await harness.manager.execute(owner, {
      action: "tab_new",
      url: "https://two.example/second",
    });
    const listed = await harness.manager.execute(owner, {
      action: "tab_list",
    });
    const captured = await harness.manager.capturePage(owner, 12_000);
    const live = await harness.manager.captureLiveView(owner);

    expect(backed.output).toContain("https://one.example/root");
    expect(forwarded.output).toContain("https://one.example/next");
    expect(opened.details).toEqual(
      expect.objectContaining({
        activeTabId: "tab_2",
        tabCount: 2,
        tabSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(listed.tabs).toEqual([
      expect.objectContaining({
        tabId: "tab_1",
        active: false,
        url: "https://one.example/next",
      }),
      expect.objectContaining({
        tabId: "tab_2",
        active: true,
        url: "https://two.example/second",
      }),
    ]);
    expect(captured).toEqual(
      expect.objectContaining({
        url: "https://two.example/second",
        activeTabId: "tab_2",
        tabCount: 2,
        tabSetSha256: opened.details.tabSetSha256,
      }),
    );
    expect(live.receipt).toEqual(
      expect.objectContaining({
        schemaVersion: 4,
        activeTabId: "tab_2",
        tabCount: 2,
        tabSetSha256: opened.details.tabSetSha256,
      }),
    );

    const switched = await harness.manager.execute(owner, {
      action: "tab_switch",
      tabId: "tab_1",
    });
    const closed = await harness.manager.execute(owner, {
      action: "tab_close",
      tabId: "tab_2",
    });
    expect(switched.output).toContain("https://one.example/next");
    expect(closed.details).toEqual(
      expect.objectContaining({
        activeTabId: "tab_1",
        tabCount: 1,
      }),
    );
    expect(closed.details.tabSetSha256).not.toBe(opened.details.tabSetSha256);
    expect(started.details.activeTabId).toBe("tab_1");
    await harness.manager.cancelRun(owner);
  });

  it("closes unsolicited popups and denies inactive-tab network requests", async () => {
    const harness = await createHarness();
    const owner = {
      threadId: "thread_tab_security",
      runId: "run_tab_security",
    };
    await harness.manager.execute(owner, {
      action: "start",
      url: "https://one.example/root",
    });
    await harness.manager.execute(owner, {
      action: "tab_new",
      url: "https://two.example/active",
    });

    const popup = harness.browsers[0]!.context.openUnsolicitedPage();
    await vi.waitFor(() => expect(popup.closed).toBe(true));
    await expect(
      harness.browsers[0]!.context.dispatch(
        "https://one.example/background",
        harness.pages[0]!,
      ),
    ).rejects.toThrow("navigation aborted");

    const listed = await harness.manager.execute(owner, {
      action: "tab_list",
    });
    expect(listed.tabs).toHaveLength(2);
    expect(listed.details).toEqual(
      expect.objectContaining({
        activeTabId: "tab_2",
        tabCount: 2,
        blockedRequestCount: 1,
      }),
    );
    expect(harness.pages).toHaveLength(3);
    await harness.manager.cancelRun(owner);
  });

  it("rejects takeover capture when tab metadata drifts after snapshot", async () => {
    const harness = await createHarness();
    const owner = {
      threadId: "thread_takeover_tab_drift",
      runId: "run_takeover_tab_drift",
    };
    await harness.manager.execute(owner, {
      action: "start",
      url: "https://one.example/root",
    });
    harness.pages[0]!.driftTitleOnNextRead = true;

    await expect(
      harness.manager.captureTakeoverSnapshot(owner),
    ).rejects.toThrow("tab evidence changed");
    expect(harness.browsers[0]?.closed).toBe(true);
  });

  it("enforces the four-tab bound and preserves a final tab", async () => {
    const harness = await createHarness();
    const owner = { threadId: "thread_tab_limit", runId: "run_tab_limit" };
    await harness.manager.execute(owner, {
      action: "start",
      url: "https://one.example/1",
    });
    for (let index = 2; index <= 4; index += 1) {
      const opened = await harness.manager.execute(owner, {
        action: "tab_new",
        url: `https://one.example/${String(index)}`,
      });
      expect(opened.details.tabCount).toBe(index);
    }
    await expect(
      harness.manager.execute(owner, {
        action: "tab_new",
        url: "https://one.example/5",
      }),
    ).rejects.toThrow("tab limit");
    expect(harness.browsers[0]?.closed).toBe(true);

    const finalHarness = await createHarness();
    const finalOwner = { threadId: "thread_final_tab", runId: "run_final_tab" };
    await finalHarness.manager.execute(finalOwner, {
      action: "start",
      url: "https://one.example/",
    });
    await expect(
      finalHarness.manager.execute(finalOwner, {
        action: "tab_close",
        tabId: "tab_1",
      }),
    ).rejects.toThrow("final tab");
    expect(finalHarness.browsers[0]?.closed).toBe(true);
  });

  it("allows visual and keyboard actions only through takeover", async () => {
    const harness = await createHarness();
    const owner = {
      threadId: "thread_visual_takeover",
      runId: "run_visual_takeover",
    };
    await harness.manager.execute(owner, {
      action: "start",
      url: "https://one.example/",
    });

    await expect(
      harness.manager.execute(owner, {
        action: "visual_click",
        x: 640,
        y: 450,
      }),
    ).rejects.toThrow("pause-bound takeover");
    expect(harness.browsers[0]?.closed).toBe(false);

    const clicked = await harness.manager.executeTakeoverAction(owner, {
      action: "visual_click",
      x: 640,
      y: 450,
    });
    const pressed = await harness.manager.executeTakeoverAction(owner, {
      action: "keypress",
      key: "Enter",
    });
    expect(clicked.details.sessionOperation).toBe(2);
    expect(pressed.details.sessionOperation).toBe(3);
    expect(harness.pages[0]?.visualClicks).toEqual([{ x: 640, y: 450 }]);
    expect(harness.pages[0]?.pressedKeys).toEqual(["Enter"]);
    await harness.manager.cancelRun(owner);
  });

  it("rejects invalid visual coordinates and key names", async () => {
    const harness = await createHarness();
    const owner = {
      threadId: "thread_visual_invalid",
      runId: "run_visual_invalid",
    };
    await harness.manager.execute(owner, {
      action: "start",
      url: "https://one.example/",
    });

    await expect(
      harness.manager.executeTakeoverAction(owner, {
        action: "visual_click",
        x: 1_280,
        y: 0,
      }),
    ).rejects.toThrow("coordinates are invalid");
    expect(harness.browsers[0]?.closed).toBe(true);

    const keyHarness = await createHarness();
    const keyOwner = {
      threadId: "thread_key_invalid",
      runId: "run_key_invalid",
    };
    await keyHarness.manager.execute(keyOwner, {
      action: "start",
      url: "https://one.example/",
    });
    await expect(
      keyHarness.manager.executeTakeoverAction(keyOwner, {
        action: "keypress",
        key: "Control+L" as "Enter",
      }),
    ).rejects.toThrow("key is invalid");
    expect(keyHarness.browsers[0]?.closed).toBe(true);
  });

  it("closes the Session when its bounded operation budget is exhausted", async () => {
    const harness = await createHarness();
    const owner = { threadId: "thread_limit", runId: "run_limit" };
    await harness.manager.execute(owner, {
      action: "start",
      url: "https://one.example/",
    });
    for (let operation = 2; operation <= 64; operation += 1) {
      const result = await harness.manager.execute(owner, {
        action: "snapshot",
      });
      expect(result.details.sessionOperation).toBe(operation);
    }
    await expect(
      harness.manager.execute(owner, { action: "snapshot" }),
    ).rejects.toThrow("operation limit");
    expect(harness.browsers[0]?.closed).toBe(true);
  });

  it("isolates Runs, enforces the active bound, and closes on cancellation", async () => {
    const harness = await createHarness();
    const owners = Array.from(
      { length: MAX_ACTIVE_BROWSER_SESSIONS + 1 },
      (_, index) => ({
        threadId: `thread_${String(index)}`,
        runId: `run_${String(index)}`,
      }),
    );
    const starts = await Promise.allSettled(
      owners.map((owner) =>
        harness.manager.execute(owner, {
          action: "start",
          url: "https://one.example/",
        }),
      ),
    );
    expect(starts.map((start) => start.status)).toEqual([
      "fulfilled",
      "fulfilled",
      "rejected",
    ]);
    expect(
      starts[MAX_ACTIVE_BROWSER_SESSIONS]?.status === "rejected"
        ? starts[MAX_ACTIVE_BROWSER_SESSIONS].reason
        : undefined,
    ).toEqual(
      expect.objectContaining({
        message: "Browser active Session limit reached",
      }),
    );
    expect(
      new Set(
        (
          await Promise.all(
            owners
              .slice(0, MAX_ACTIVE_BROWSER_SESSIONS)
              .map((owner) =>
                harness.manager.execute(owner, { action: "snapshot" }),
              ),
          )
        ).map((result) => result.details.sessionIdSha256),
      ).size,
    ).toBe(MAX_ACTIVE_BROWSER_SESSIONS);
    const first = owners[0]!;
    for (const page of harness.pages) page.blockClicks = true;
    const controller = new AbortController();
    const operation = harness.manager.execute(
      first,
      { action: "click", target: { ref: "e2" } },
      controller.signal,
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await expect(operation).rejects.toThrow("cancelled");
    expect(harness.browsers.filter((browser) => browser.closed)).toHaveLength(
      1,
    );

    await Promise.all(
      owners
        .slice(1, MAX_ACTIVE_BROWSER_SESSIONS)
        .map((owner) => harness.manager.cancelRun(owner)),
    );
  });
});
