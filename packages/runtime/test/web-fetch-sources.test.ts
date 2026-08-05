import { describe, expect, it, vi } from "vitest";

import type { BrowserPageSourceCapture } from "../src/browser-session.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import type { PublicHttpResponse } from "../src/public-http-client.js";
import { RunWebFetchSourceManager } from "../src/web-fetch-sources.js";

const OWNER = { threadId: "thread_fetch", runId: "run_fetch" };

describe("RunWebFetchSourceManager", () => {
  it("fetches a Source, supports progressive read/find/list, and validates bindings", async () => {
    const http = {
      request: vi.fn(async () =>
        response(
          `<!doctype html><html><head><title>Source title</title></head><body>
            <main><h1>Source title</h1><p>Alpha evidence line.</p><p>Beta evidence line.</p></main>
          </body></html>`,
          "text/html",
        ),
      ),
    };
    const manager = new RunWebFetchSourceManager({
      http,
      now: () => new Date("2026-08-04T12:00:00.000Z"),
    });

    const fetched = await manager.execute(OWNER, {
      action: "fetch",
      url: "https://example.com/source",
    });
    const sourceId = fetched.details.sourceId!;
    const contentSha256 = fetched.details.sourceContentSha256!;
    const found = await manager.execute(OWNER, {
      action: "find",
      sourceId,
      sourceContentSha256: contentSha256,
      query: "beta",
    });
    const read = await manager.execute(OWNER, {
      action: "read",
      sourceId,
      sourceContentSha256: contentSha256,
      startLine: 1,
      endLine: fetched.details.sourceLineCount!,
    });
    const listed = await manager.execute(OWNER, { action: "list" });
    const research = await manager.captureWebSource(OWNER, {
      webSourceId: sourceId,
      webSourceContentSha256: contentSha256,
      maxChars: 12_000,
    });

    expect(http.request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://example.com/source",
        maxResponseBytes: 8 * 1024 * 1024,
      }),
      expect.any(AbortSignal),
    );
    expect(fetched.output).toContain("SOURCE TEXT (untrusted external data");
    expect(fetched.details).toEqual(
      expect.objectContaining({
        action: "fetch",
        sourceId,
        sourceFormat: "html",
        sourceCount: 1,
        sourceLineCount: expect.any(Number),
        retrievedAt: "2026-08-04T12:00:00.000Z",
      }),
    );
    expect(found.output).toContain("Beta evidence line");
    expect(found.details.findMatchCount).toBe(1);
    expect(read.output).toContain("Alpha evidence line");
    expect(listed.output).toContain(sourceId);
    expect(research).toEqual(
      expect.objectContaining({
        url: "https://example.com/source",
        title: "Source title",
        webSourceContentSha256: contentSha256,
        webSourceFormat: "html",
        webSourceLineCount: fetched.details.sourceLineCount,
      }),
    );
    expect(research.lines.join("\n")).toContain("Beta evidence line");

    await expect(
      manager.execute(OWNER, {
        action: "read",
        sourceId,
        sourceContentSha256: "0".repeat(64),
        startLine: 1,
        endLine: 1,
      }),
    ).rejects.toThrow("stale or invalid");
    await expect(
      manager.execute(
        { threadId: OWNER.threadId, runId: "run_other" },
        {
          action: "read",
          sourceId,
          sourceContentSha256: contentSha256,
          startLine: 1,
          endLine: 1,
        },
      ),
    ).rejects.toThrow("not found for this Run");
    await expect(
      manager.captureWebSource(
        { threadId: OWNER.threadId, runId: "run_other" },
        {
          webSourceId: sourceId,
          webSourceContentSha256: contentSha256,
          maxChars: 12_000,
        },
      ),
    ).rejects.toThrow("not found for this Run");
  });

  it("removes Sources on Run cancellation", async () => {
    const manager = new RunWebFetchSourceManager({
      http: { request: vi.fn(async () => response("alpha", "text/plain")) },
    });
    const fetched = await manager.execute(OWNER, {
      action: "fetch",
      url: "https://example.com/source.txt",
    });

    await manager.cancelRun(OWNER);

    await expect(manager.execute(OWNER, { action: "list" })).resolves.toEqual(
      expect.objectContaining({
        output: "No Web Sources fetched in this Run.",
      }),
    );
    await expect(
      manager.execute(OWNER, {
        action: "read",
        sourceId: fetched.details.sourceId!,
        sourceContentSha256: fetched.details.sourceContentSha256!,
        startLine: 1,
        endLine: 1,
      }),
    ).rejects.toThrow("not found for this Run");
  });

  it("cancels active and queued fetches without repopulating the Run", async () => {
    const started: Array<() => void> = [];
    const http = {
      request: vi.fn(
        (_request: unknown, signal?: AbortSignal) =>
          new Promise<PublicHttpResponse>((_resolve, reject) => {
            started.push(() => undefined);
            signal?.addEventListener(
              "abort",
              () => reject(new Error("cancelled")),
              { once: true },
            );
          }),
      ),
    };
    const manager = new RunWebFetchSourceManager({ http });
    const first = manager.execute(OWNER, {
      action: "fetch",
      url: "https://example.com/one",
    });
    const second = manager.execute(OWNER, {
      action: "fetch",
      url: "https://example.com/two",
    });
    await vi.waitFor(() => expect(started).toHaveLength(1));

    await manager.cancelRun(OWNER);

    await expect(first).rejects.toThrow("Web fetch was cancelled");
    await expect(second).rejects.toThrow("Web fetch was cancelled");
    expect(http.request).toHaveBeenCalledTimes(1);
  });

  it("fails visibly for non-success HTTP responses", async () => {
    const browserFallback = { captureUrl: vi.fn() };
    const manager = new RunWebFetchSourceManager({
      http: {
        request: vi.fn(async () => ({
          ...response("not found", "text/plain"),
          status: 404,
        })),
      },
      browserFallback,
    });

    await expect(
      manager.execute(
        OWNER,
        {
          action: "fetch",
          url: "https://example.com/missing",
        },
        undefined,
        { browserFallbackAllowed: true },
      ),
    ).rejects.toThrow("HTTP 404");
    expect(browserFallback.captureUrl).not.toHaveBeenCalled();
  });

  it("does not start Browser fallback for unsupported binary content", async () => {
    const browserFallback = { captureUrl: vi.fn() };
    const manager = new RunWebFetchSourceManager({
      http: {
        request: vi.fn(async () => ({
          ...response("", "application/octet-stream"),
          body: Buffer.from([0, 1, 2, 3]),
        })),
      },
      browserFallback,
    });

    await expect(
      manager.execute(
        OWNER,
        {
          action: "fetch",
          url: "https://example.com/file.bin",
        },
        undefined,
        { browserFallbackAllowed: true },
      ),
    ).rejects.toThrow("unsupported");
    expect(browserFallback.captureUrl).not.toHaveBeenCalled();
  });

  it("falls back to a bounded Browser render for a document-write HTML shell", async () => {
    const browserFallback = {
      captureUrl: vi.fn(async () =>
        browserCapture("https://example.com/source", "Dynamic Source", [
          "Dynamic Source",
          "This visible Browser-rendered evidence is intentionally longer than the static shell.",
          "A second complete rendered sentence keeps useful text growth above the conservative fallback threshold.",
        ]),
      ),
    };
    const manager = new RunWebFetchSourceManager({
      http: {
        request: vi.fn(async () =>
          response(
            dynamicShell("<p>PRIVATE_SCRIPT_ONLY_EVIDENCE</p>"),
            "text/html",
          ),
        ),
      },
      browserFallback,
      now: () => new Date("2026-08-04T12:00:00.000Z"),
    });

    const fetched = await manager.execute(
      OWNER,
      { action: "fetch", url: "https://example.com/source" },
      undefined,
      { browserFallbackAllowed: true },
    );
    const research = await manager.captureWebSource(OWNER, {
      webSourceId: fetched.details.sourceId!,
      webSourceContentSha256: fetched.details.sourceContentSha256!,
      maxChars: 12_000,
    });

    expect(browserFallback.captureUrl).toHaveBeenCalledWith(
      OWNER,
      {
        url: "https://example.com/source",
        maxChars: 24_000,
        waitMs: 1_000,
      },
      expect.any(AbortSignal),
    );
    expect(fetched.output).toContain("Render: browser_fallback");
    expect(fetched.output).toContain("Browser Fallback: used");
    expect(fetched.output).toContain("Browser-rendered evidence");
    expect(fetched.output).not.toContain("PRIVATE_SCRIPT_ONLY_EVIDENCE");
    expect(fetched.details).toEqual(
      expect.objectContaining({
        sourceFormat: "html",
        sourceRenderMode: "browser_fallback",
        browserFallbackStatus: "used",
        browserFallbackCount: 1,
        browserSessionOperation: 3,
        browserNetworkDestinationCount: 1,
      }),
    );
    expect(research).toEqual(
      expect.objectContaining({
        webSourceFormat: "html",
        webSourceRenderMode: "browser_fallback",
        browserFallbackStatus: "used",
        browserFallback: expect.objectContaining({
          sessionOperation: 3,
        }),
      }),
    );
    expect(research.lines.join("\n")).toContain("Browser-rendered evidence");
  });

  it("does not start Browser fallback for static HTML, password forms, or PDF", async () => {
    const browserFallback = { captureUrl: vi.fn() };
    const http = {
      request: vi
        .fn()
        .mockResolvedValueOnce(
          response(
            "<html><body><main><h1>Static</h1><p>Complete static evidence remains authoritative.</p></main></body></html>",
            "text/html",
          ),
        )
        .mockResolvedValueOnce(
          response(
            '<html><body><h1>Sign in</h1><form><input type="password"></form><script>document.write("<p>private</p>")</script></body></html>',
            "text/html",
          ),
        )
        .mockResolvedValueOnce(response(minimalPdf(), "application/pdf")),
    };
    const manager = new RunWebFetchSourceManager({ http, browserFallback });

    const html = await manager.execute(
      OWNER,
      { action: "fetch", url: "https://example.com/source" },
      undefined,
      { browserFallbackAllowed: true },
    );
    const pdf = await manager.execute(
      OWNER,
      { action: "fetch", url: "https://example.com/login" },
      undefined,
      { browserFallbackAllowed: true },
    );
    const actualPdf = await manager.execute(
      OWNER,
      { action: "fetch", url: "https://example.com/report.pdf" },
      undefined,
      { browserFallbackAllowed: true },
    );

    expect(browserFallback.captureUrl).not.toHaveBeenCalled();
    expect(html.details).toEqual(
      expect.objectContaining({
        sourceRenderMode: "static",
        browserFallbackStatus: "not_needed",
        browserFallbackCount: 0,
      }),
    );
    expect(pdf.details).toEqual(
      expect.objectContaining({
        sourceFormat: "html",
        sourceRenderMode: "static",
        browserFallbackStatus: "not_needed",
        browserFallbackCount: 0,
      }),
    );
    expect(actualPdf.details).toEqual(
      expect.objectContaining({
        sourceFormat: "pdf",
        sourceRenderMode: "static",
        browserFallbackStatus: "not_needed",
        browserFallbackCount: 0,
      }),
    );
  });

  it("returns the static Source with a stable diagnostic when Browser fallback is unavailable", async () => {
    const manager = new RunWebFetchSourceManager({
      http: {
        request: vi.fn(async () =>
          response(dynamicShell("<p>dynamic</p>"), "text/html"),
        ),
      },
      browserFallback: {
        captureUrl: vi.fn(async () => {
          throw new Error("PRIVATE_CHROME_FAILURE");
        }),
      },
    });

    const fetched = await manager.execute(
      OWNER,
      { action: "fetch", url: "https://example.com/source" },
      undefined,
      { browserFallbackAllowed: true },
    );

    expect(fetched.details).toEqual(
      expect.objectContaining({
        sourceRenderMode: "static",
        browserFallbackStatus: "unavailable",
        browserFallbackDiagnostic: "browser_unavailable",
        browserFallbackCount: 1,
      }),
    );
    expect(fetched.output).toContain(
      "Fallback Diagnostic: browser_unavailable",
    );
    expect(fetched.output).not.toContain("PRIVATE_CHROME_FAILURE");
  });

  it("rejects a mismatched Browser result and caps fallback attempts per Run", async () => {
    const browserFallback = {
      captureUrl: vi
        .fn()
        .mockResolvedValueOnce(
          browserCapture("https://other.example/", "Wrong", [
            "Wrong-origin rendered content that must never replace the Source.",
            "Additional visible evidence keeps this capture above the growth threshold.",
          ]),
        )
        .mockResolvedValue(
          browserCapture("https://example.com/source", "Dynamic", [
            "Dynamic visible evidence from the controlled Browser fallback.",
            "Additional visible evidence keeps this capture above the growth threshold.",
          ]),
        ),
    };
    const manager = new RunWebFetchSourceManager({
      http: {
        request: vi.fn(async () =>
          response(dynamicShell("<p>dynamic</p>"), "text/html"),
        ),
      },
      browserFallback,
    });

    const first = await manager.execute(
      OWNER,
      { action: "fetch", url: "https://example.com/source" },
      undefined,
      { browserFallbackAllowed: true },
    );
    const second = await manager.execute(
      OWNER,
      { action: "fetch", url: "https://example.com/source" },
      undefined,
      { browserFallbackAllowed: true },
    );
    const third = await manager.execute(
      OWNER,
      { action: "fetch", url: "https://example.com/source" },
      undefined,
      { browserFallbackAllowed: true },
    );

    expect(browserFallback.captureUrl).toHaveBeenCalledTimes(2);
    expect(first.details.browserFallbackDiagnostic).toBe(
      "browser_render_not_useful",
    );
    expect(second.details.browserFallbackStatus).toBe("used");
    expect(third.details).toEqual(
      expect.objectContaining({
        sourceRenderMode: "static",
        browserFallbackStatus: "unavailable",
        browserFallbackDiagnostic: "fallback_limit_reached",
        browserFallbackCount: 2,
      }),
    );
  });
});

function response(body: string, contentType: string): PublicHttpResponse {
  return {
    status: 200,
    headers: { "content-type": contentType },
    body: Buffer.from(body),
    finalUrl: "https://example.com/source",
    redirectCount: 0,
  };
}

function dynamicShell(rendered: string): string {
  return `<!doctype html><html><head><title>Dynamic Source</title></head><body><h1>Dynamic Source</h1><script>document.write(${JSON.stringify(rendered)});</script></body></html>`;
}

function browserCapture(
  url: string,
  title: string,
  lines: string[],
): BrowserPageSourceCapture {
  return {
    url,
    title,
    lines,
    textChars: lines.join("\n").length,
    truncated: false,
    capturedContentSha256: sha256(
      canonicalJson({ url, title, lines, truncated: false }),
    ),
    sessionOperation: 3,
    sessionIdSha256: "1".repeat(64),
    activeTabId: "tab_1",
    tabCount: 1,
    tabSetSha256: sha256(canonicalJson(["tab_1"])),
    browserExecutableSha256: "2".repeat(64),
    browserVersionSha256: "3".repeat(64),
    limitsSha256: "4".repeat(64),
    network: {
      requestCount: 2,
      connectCount: 1,
      rejectedCount: 0,
      transferredBytes: 1_024,
      destinationCount: 1,
      destinationsSha256: "5".repeat(64),
    },
  };
}

function minimalPdf(text = "Static PDF evidence."): string {
  const escaped = text.replace(/[\\()]/gu, "\\$&");
  const stream = `BT /F1 18 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    output += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return output;
}
