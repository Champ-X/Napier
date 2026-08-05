import { createHash } from "node:crypto";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { connect as connectTcp } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { startOpenWebComparisonModelProxy } from "./open-web-comparison-model-proxy.mjs";
import {
  assertOpenWebComparisonBrowserRuntimeCurrent,
  createOpenWebComparisonBrowserRuntime,
} from "./open-web-comparison-browser-runtime.mjs";
import { buildOpenWebComparisonBrowserSandboxProfile } from "./open-web-comparison-isolated-browser.mjs";
import { evaluateOpenWebComparisonOutcome } from "./open-web-comparison-oracle.mjs";
import {
  createNapierComparisonParser,
  createOmpComparisonParser,
  infrastructureFailureText,
  processInfrastructureFailureText,
  runOpenWebComparisonProcess,
} from "./open-web-comparison-process.mjs";
import { startOpenWebComparisonPublicProxy } from "./open-web-comparison-public-proxy.mjs";
import { createOpenWebComparisonOmpRuntime } from "./open-web-comparison-omp-runtime.mjs";
import {
  createOpenWebComparisonReport,
  openWebComparisonSummary,
  verifyOpenWebComparisonReport,
} from "./open-web-comparison-report.mjs";
import {
  OPEN_WEB_COMPARISON_NOTES,
  OPEN_WEB_COMPARISON_NOTES_V2,
} from "./open-web-comparison-report-policy.mjs";
import { buildOmpComparisonSandboxProfile } from "./open-web-comparison-sandbox.mjs";
import { scanOpenWebComparisonSecrets } from "./open-web-comparison-secret-scan.mjs";
import {
  createOpenWebComparisonSuite,
  publicOpenWebComparisonSuite,
  verifyOpenWebComparisonSuite,
} from "./open-web-comparison-suite.mjs";
import {
  createOpenWebComparisonNapierEnvironment,
  createOpenWebComparisonTrialOutcome,
  OPEN_WEB_CONTROLLED_NAPIER_TOOLS,
} from "./open-web-comparison-trial.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("open-web executor comparison", () => {
  it("generates a deterministic low, medium, and high suite from the seed", () => {
    const first = createOpenWebComparisonSuite(20260805);
    const second = createOpenWebComparisonSuite(20260805);
    const another = createOpenWebComparisonSuite(20260806);

    expect(first).toEqual(second);
    expect(first.contentSha256).not.toBe(another.contentSha256);
    expect(first.cases.map((entry) => entry.complexity)).toEqual([
      "low",
      "medium",
      "high",
    ]);
    expect(first.cases.map((entry) => entry.taskFamily)).toEqual([
      "search_primary_source",
      "url_pdf_research",
      "dynamic_browser_evidence",
    ]);
    expect(verifyOpenWebComparisonSuite(first)).toEqual({
      valid: true,
      diagnostics: [],
    });
    const publicSuite = publicOpenWebComparisonSuite(first);
    expect(JSON.stringify(publicSuite)).not.toContain("nodejs.org");
    expect(JSON.stringify(publicSuite)).not.toContain("Dummy PDF file");
    expect(JSON.stringify(publicSuite)).not.toContain("Question:");
  });

  it("uses the same Search, URL-read, and Browser families in controlled mode", () => {
    expect(OPEN_WEB_CONTROLLED_NAPIER_TOOLS).toEqual([
      "web_search",
      "web_fetch",
      "browser",
    ]);
    expect(OPEN_WEB_CONTROLLED_NAPIER_TOOLS).not.toContain("research_source");
  });

  it("prepares controlled Napier without ambient environment or credentials", () => {
    const environment = createOpenWebComparisonNapierEnvironment(
      {
        homeRoot: "/private/tmp/comparison/home",
        trialRoot: "/private/tmp/comparison/trial",
      },
      {
        PATH: "/usr/bin:/bin",
        LANG: "en_US.UTF-8",
        LC_ALL: "en_US.UTF-8",
        DEEPSEEK_API_KEY: "secret",
        HTTPS_PROXY: "http://ambient-proxy",
        AWS_ACCESS_KEY_ID: "ambient-cloud-key",
      },
      "DEEPSEEK_API_KEY",
      false,
    );

    expect(environment).toEqual({
      HOME: "/private/tmp/comparison/home",
      TMPDIR: "/private/tmp/comparison/trial",
      PATH: "/usr/bin:/bin",
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
    });
  });

  it("requires exact answers, original URLs, supporting quotes, and tool families", () => {
    const benchmarkCase = createOpenWebComparisonSuite(20260805).cases[0];
    const fact = benchmarkCase.expectedFacts[0];
    const passing = evaluateOpenWebComparisonOutcome({
      benchmarkCase,
      finalText: JSON.stringify({
        facts: [
          {
            id: fact.id,
            answer: fact.answer,
            sourceUrl: fact.sourceUrl,
            quote: fact.acceptedQuotes[0],
          },
        ],
      }),
      toolCounts: { search: 1, fetch: 1, browser: 0 },
    });
    expect(passing.passed).toBe(true);
    expect(JSON.stringify(passing)).not.toContain(fact.answer);
    expect(JSON.stringify(passing)).not.toContain(fact.sourceUrl);
    expect(JSON.stringify(passing)).not.toContain(fact.acceptedQuotes[0]);

    const failed = evaluateOpenWebComparisonOutcome({
      benchmarkCase,
      finalText: JSON.stringify({
        facts: [
          {
            id: fact.id,
            answer: fact.answer,
            sourceUrl: fact.sourceUrl,
            quote: "Search snippets are enough.",
          },
        ],
      }),
      toolCounts: { search: 1, fetch: 0, browser: 0 },
    });
    expect(failed.passed).toBe(false);
    expect(failed.diagnostics).toEqual(
      expect.arrayContaining(["quote_mismatch", "tool_fetch_missing"]),
    );
  });

  it("normalizes Napier and OMP machine streams without retaining reasoning", () => {
    const finalText =
      '{"facts":[{"id":"node_engine","answer":"13.6","sourceUrl":"https://nodejs.org/en/blog/release/v24.0.0","quote":"V8 13.6"}]}';
    const napier = createNapierComparisonParser();
    napier.accept(
      JSON.stringify({
        type: "event",
        event: {
          type: "tool.started",
          payload: { callId: "search_1", toolName: "web_search" },
        },
      }),
    );
    napier.accept(
      JSON.stringify({
        type: "event",
        event: {
          type: "tool.started",
          payload: { callId: "fetch_1", toolName: "web_fetch" },
        },
      }),
    );
    napier.accept(
      JSON.stringify({
        type: "event",
        event: {
          type: "tool.completed",
          payload: { callId: "search_1", toolName: "web_search" },
        },
      }),
    );
    napier.accept(
      JSON.stringify({
        type: "event",
        event: {
          type: "tool.completed",
          payload: { callId: "fetch_1", toolName: "web_fetch" },
        },
      }),
    );
    napier.accept(
      JSON.stringify({
        type: "snapshot",
        detail: {
          runs: [
            {
              status: "completed",
              usage: {
                inputTokens: 10,
                outputTokens: 2,
                cacheReadTokens: 3,
                cacheWriteTokens: 0,
                costUsd: 0.01,
              },
            },
          ],
          events: [
            {
              type: "message.assistant",
              payload: { text: finalText, reasoning: "private" },
            },
          ],
        },
      }),
    );
    expect(napier.result()).toEqual(
      expect.objectContaining({
        finalText,
        status: "completed",
        usage: {
          inputTokens: 10,
          outputTokens: 2,
          cacheReadTokens: 3,
          cacheWriteTokens: 0,
          costUsd: 0.01,
        },
        toolCounts: { search: 1, fetch: 1, browser: 0 },
      }),
    );

    const omp = createOmpComparisonParser();
    omp.accept(
      JSON.stringify({
        type: "tool_execution_start",
        toolCallId: "read_1",
        toolName: "read",
        args: { path: "https://example.com/source" },
      }),
    );
    omp.accept(
      JSON.stringify({
        type: "tool_execution_start",
        toolCallId: "failed_browser_1",
        toolName: "browser",
        args: { action: "run" },
      }),
    );
    omp.accept(
      JSON.stringify({
        type: "tool_execution_end",
        toolCallId: "failed_browser_1",
        toolName: "browser",
        isError: true,
        result: { content: [] },
      }),
    );
    omp.accept(
      JSON.stringify({
        type: "tool_execution_start",
        toolCallId: "browser_1",
        toolName: "browser",
        args: { action: "open" },
      }),
    );
    omp.accept(
      JSON.stringify({
        type: "tool_execution_end",
        toolCallId: "read_1",
        toolName: "read",
        isError: false,
        result: { content: [] },
      }),
    );
    omp.accept(
      JSON.stringify({
        type: "tool_execution_end",
        toolCallId: "browser_1",
        toolName: "browser",
        isError: false,
        result: { content: [] },
      }),
    );
    omp.accept(
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "private" },
            { type: "text", text: finalText },
          ],
          stopReason: "stop",
          usage: {
            input: 20,
            output: 4,
            cacheRead: 6,
            cacheWrite: 0,
            cost: { total: 0.02 },
          },
        },
      }),
    );
    expect(omp.result()).toEqual(
      expect.objectContaining({
        finalText,
        status: "completed",
        toolCounts: { search: 0, fetch: 1, browser: 1 },
        toolFailed: 1,
        usage: {
          inputTokens: 20,
          outputTokens: 4,
          cacheReadTokens: 6,
          cacheWriteTokens: 0,
          costUsd: 0.02,
        },
      }),
    );
  });

  it("does not classify product Browser errors as external infrastructure", () => {
    expect(infrastructureFailureText("Browser is not connected")).toBe(false);
    expect(
      infrastructureFailureText("Failed to attach to browser tab worker"),
    ).toBe(false);
    expect(infrastructureFailureText("HTTP status 503")).toBe(true);
    expect(infrastructureFailureText("provider unavailable")).toBe(true);
    expect(processInfrastructureFailureText("Cannot find module x")).toBe(true);
    expect(
      processInfrastructureFailureText("failed to launch browser runtime"),
    ).toBe(true);
  });

  it("trusts structured provider errors but not tool-result text", () => {
    const omp = createOmpComparisonParser();
    omp.accept(
      JSON.stringify({
        type: "tool_execution_start",
        toolCallId: "browser_error_1",
        toolName: "browser",
        args: { action: "run" },
      }),
    );
    omp.accept(
      JSON.stringify({
        type: "tool_execution_end",
        toolCallId: "browser_error_1",
        toolName: "browser",
        isError: true,
        result: {
          content: [{ type: "text", text: "provider unavailable" }],
        },
      }),
    );
    expect(omp.result().infrastructureSignal).toBe(false);

    omp.accept(
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage: "HTTP status 503",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            cost: { total: 0 },
          },
        },
      }),
    );
    expect(omp.result().infrastructureSignal).toBe(true);

    const napier = createNapierComparisonParser();
    napier.accept(
      JSON.stringify({
        type: "snapshot",
        detail: {
          runs: [{ status: "completed" }],
          events: [
            {
              type: "tool.failed",
              payload: { diagnostic: "provider unavailable" },
            },
          ],
        },
      }),
    );
    expect(napier.result().infrastructureSignal).toBe(false);
  });

  it("injects the parent credential only at the bounded model proxy", async () => {
    const upstreamApiKey = "parent-secret-value";
    const childApiKey = "child-dummy-value";
    const fetchImpl = vi.fn(async (_url, init) => {
      expect(init.headers.authorization).toBe(`Bearer ${upstreamApiKey}`);
      expect(init.body.toString("utf8")).not.toContain(upstreamApiKey);
      return new Response('{"ok":true}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const proxy = await startOpenWebComparisonModelProxy({
      upstreamApiKey,
      childApiKey,
      timeoutMs: 5_000,
      fetchImpl,
    });
    try {
      const response = await fetch(`${proxy.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${childApiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ model: "deepseek-v4-flash", messages: [] }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      expect(proxy.receipt).toEqual(
        expect.objectContaining({
          requestCount: 1,
          rejectedCount: 0,
          modelMatch: true,
        }),
      );
      expect(JSON.stringify(proxy.receipt)).not.toContain(upstreamApiKey);
      expect(JSON.stringify(proxy.receipt)).not.toContain(childApiKey);
    } finally {
      await proxy.close();
    }
  });

  it("keeps the OMP public proxy on the production public-network boundary", async () => {
    const local = await new Promise((resolve, reject) => {
      const server = createServer((_request, response) =>
        response.end("private"),
      );
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve(server));
    });
    const address = local.address();
    expect(address && typeof address !== "string").toBe(true);
    const proxy = await startOpenWebComparisonPublicProxy();
    try {
      const target = new URL(proxy.server);
      const status = await new Promise((resolve, reject) => {
        const request = httpRequest({
          hostname: target.hostname,
          port: target.port,
          method: "GET",
          path: `http://127.0.0.1:${String(address.port)}/private`,
          headers: {
            "proxy-authorization": proxy.proxyAuthorization,
          },
        });
        request.once("response", (response) => {
          response.resume();
          response.once("end", () => resolve(response.statusCode));
        });
        request.once("error", reject);
        request.end();
      });
      expect(status).toBe(502);
      expect(proxy.snapshot().rejectedCount).toBeGreaterThan(0);
    } finally {
      await proxy.close();
      await new Promise((resolve) => local.close(resolve));
    }
  });

  it("survives a reset public-proxy client before CONNECT settlement", async () => {
    const proxy = await startOpenWebComparisonPublicProxy();
    try {
      const target = new URL(proxy.server);
      const socket = connectTcp(Number(target.port), target.hostname);
      await new Promise((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
      });
      socket.write(
        `CONNECT example.com:443 HTTP/1.1\r\nProxy-Authorization: ${proxy.proxyAuthorization}\r\n\r\n`,
      );
      socket.destroy();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(proxy.snapshot().requestCount).toBeGreaterThanOrEqual(0);
    } finally {
      await proxy.close();
    }
  });

  it("requires authentication at the loopback public proxy", async () => {
    const proxy = await startOpenWebComparisonPublicProxy();
    try {
      const target = new URL(proxy.server);
      const status = await new Promise((resolve, reject) => {
        const request = httpRequest({
          hostname: target.hostname,
          port: target.port,
          method: "GET",
          path: "http://example.com/",
        });
        request.once("response", (response) => {
          response.resume();
          response.once("end", () => resolve(response.statusCode));
        });
        request.once("error", reject);
        request.end();
      });
      expect(status).toBe(407);
    } finally {
      await proxy.close();
    }
  });

  it("keeps the Browser-only proxy unauthenticated but SSRF-safe", async () => {
    const local = await new Promise((resolve, reject) => {
      const server = createServer((_request, response) =>
        response.end("private"),
      );
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve(server));
    });
    const address = local.address();
    expect(address && typeof address !== "string").toBe(true);
    const proxy = await startOpenWebComparisonPublicProxy({
      requireAuthentication: false,
    });
    try {
      const target = new URL(proxy.server);
      const status = await new Promise((resolve, reject) => {
        const request = httpRequest({
          hostname: target.hostname,
          port: target.port,
          method: "GET",
          path: `http://127.0.0.1:${String(address.port)}/private`,
        });
        request.once("response", (response) => {
          response.resume();
          response.once("end", () => resolve(response.statusCode));
        });
        request.once("error", reject);
        request.end();
      });
      expect(status).toBe(502);
      expect(proxy.snapshot().rejectedCount).toBeGreaterThan(0);
    } finally {
      await proxy.close();
      await new Promise((resolve) => local.close(resolve));
    }
  });

  it("confines the OMP process to runtime and trial roots", () => {
    const trialRoot = "/private/tmp/comparison/trial";
    const profile = buildOmpComparisonSandboxProfile({
      trialRoot,
      workspaceRoot: `${trialRoot}/workspace`,
      homeRoot: `${trialRoot}/home`,
      bunExecutable: "/Users/test/.bun/bin/bun",
      ompEntry:
        "/Users/test/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/dist/cli.js",
      modelProxyPort: 41001,
      publicProxyPort: 41002,
      cdpPort: 41003,
    });
    expect(profile).toContain("(allow default)");
    expect(profile).toContain("(deny file-read-data");
    expect(profile).toContain("(deny file-write*");
    expect(profile).toContain("(deny process-exec");
    expect(profile).not.toContain("/Users/test/.bun/install/cache");
    expect(profile).not.toContain(
      "/Users/test/.bun/install/global/node_modules",
    );
    expect(profile).not.toContain("registry.npmjs.org");
    expect(profile).toContain('(remote ip "localhost:41001")');
    expect(profile).toContain('(remote ip "localhost:41002")');
    expect(profile).toContain('(remote ip "localhost:41003")');
    expect(profile).not.toContain("(allow network*)");
    expect(profile).toContain(`(subpath ${JSON.stringify(trialRoot)})`);
    expect(profile).toContain(
      `(deny file-write* (require-not (require-any (subpath ${JSON.stringify(trialRoot)})`,
    );
    expect(profile).not.toContain("/Users/bytedance/projects/Napier");
    expect(profile).not.toContain("DEEPSEEK_API_KEY");
  });

  it("clones only the installed OMP dependency closure", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-omp-runtime-fixture-"),
    );
    roots.push(root);
    const nodeModules = path.join(root, "install", "global", "node_modules");
    const ompRoot = path.join(nodeModules, "@oh-my-pi", "pi-coding-agent");
    const dependencyRoot = path.join(nodeModules, "required-dependency");
    const unrelatedRoot = path.join(nodeModules, "unrelated-package");
    await Promise.all([
      mkdir(path.join(ompRoot, "dist"), { recursive: true }),
      mkdir(dependencyRoot, { recursive: true }),
      mkdir(unrelatedRoot, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        path.join(ompRoot, "package.json"),
        JSON.stringify({
          name: "@oh-my-pi/pi-coding-agent",
          version: "17.2.1",
          dependencies: { "required-dependency": "1.0.0" },
        }),
      ),
      writeFile(path.join(ompRoot, "dist", "cli.js"), "fixture-cli"),
      writeFile(
        path.join(dependencyRoot, "package.json"),
        JSON.stringify({
          name: "required-dependency",
          version: "1.0.0",
        }),
      ),
      writeFile(
        path.join(unrelatedRoot, "package.json"),
        JSON.stringify({
          name: "unrelated-package",
          version: "1.0.0",
        }),
      ),
    ]);
    const runtime = await createOpenWebComparisonOmpRuntime({
      temporaryRoot: root,
      installedEntry: path.join(ompRoot, "dist", "cli.js"),
    });

    await expect(
      access(path.join(runtime.root, "node_modules", "required-dependency")),
    ).resolves.toBeUndefined();
    await expect(
      access(path.join(runtime.root, "node_modules", "unrelated-package")),
    ).rejects.toThrow();
  });

  it("copies a bounded isolated Browser runtime image", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-browser-runtime-fixture-"),
    );
    roots.push(root);
    const sourceRoot = path.join(root, "source");
    const executable = path.join(sourceRoot, "chrome-headless-shell");
    await mkdir(sourceRoot);
    await writeFile(executable, "fixture-headless-shell", { mode: 0o700 });

    const runtime = await createOpenWebComparisonBrowserRuntime({
      temporaryRoot: root,
      sourceExecutable: executable,
    });

    expect(runtime).toEqual(
      expect.objectContaining({
        fileCount: 1,
        totalBytes: Buffer.byteLength("fixture-headless-shell"),
        executableSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        runtimeSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    await expect(readFile(runtime.executablePath, "utf8")).resolves.toBe(
      "fixture-headless-shell",
    );
  });

  it("rejects an isolated Browser runtime symlink that escapes its image", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-browser-runtime-symlink-"),
    );
    roots.push(root);
    const sourceRoot = path.join(root, "source");
    const executable = path.join(sourceRoot, "chrome-headless-shell");
    const outside = path.join(root, "outside.bin");
    await mkdir(sourceRoot);
    await writeFile(executable, "fixture-headless-shell", { mode: 0o700 });
    await writeFile(outside, "outside");
    await symlink(outside, path.join(sourceRoot, "escape"));

    await expect(
      createOpenWebComparisonBrowserRuntime({
        temporaryRoot: root,
        sourceExecutable: executable,
      }),
    ).rejects.toThrow("runtime symlink escapes its image");
  });

  it("rejects copied Browser runtime drift outside the executable", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-browser-runtime-drift-"),
    );
    roots.push(root);
    const sourceRoot = path.join(root, "source");
    const executable = path.join(sourceRoot, "chrome-headless-shell");
    await mkdir(sourceRoot);
    await writeFile(executable, "fixture-headless-shell", { mode: 0o700 });
    await writeFile(path.join(sourceRoot, "runtime.pak"), "before");
    const runtime = await createOpenWebComparisonBrowserRuntime({
      temporaryRoot: root,
      sourceExecutable: executable,
    });

    await writeFile(path.join(runtime.root, "runtime.pak"), "after");

    await expect(
      assertOpenWebComparisonBrowserRuntimeCurrent(runtime),
    ).rejects.toThrow("runtime changed");
  });

  it("confines the isolated Browser to copied runtime, fresh state, proxy, and loopback CDP", () => {
    const trialRoot = "/private/tmp/comparison/trial";
    const browserRoot = `${trialRoot}/browser`;
    const executablePath =
      "/private/tmp/comparison/browser-runtime/chrome-headless-shell";
    const profile = buildOpenWebComparisonBrowserSandboxProfile({
      comparisonRoot: "/private/tmp/comparison",
      trialRoot,
      browserRoot,
      browserRuntimeRoot: "/private/tmp/comparison/browser-runtime",
      executablePath,
      proxyPort: 41004,
    });

    expect(profile).toContain(
      `(deny file-read-data (subpath ${JSON.stringify(
        path.resolve(process.env.HOME),
      )}))`,
    );
    expect(profile).toContain(`(subpath ${JSON.stringify(browserRoot)})`);
    expect(profile).toContain(
      `(subpath ${JSON.stringify("/private/tmp/comparison/browser-runtime")})`,
    );
    expect(profile).toContain(
      `(deny process-exec (require-not (literal ${JSON.stringify(
        executablePath,
      )})))`,
    );
    expect(profile).toContain('(remote ip "localhost:41004")');
    expect(profile).toContain('(local ip "localhost:*")');
    expect(profile).not.toContain("(allow network*)");
  });

  it("retains OMP browser isolation evidence in the assembled outcome", () => {
    const browserIsolation = {
      status: "blocked",
      diagnostic: "nested_chromium_sandbox_unavailable",
      requestCount: 0,
    };
    const assembled = createOpenWebComparisonTrialOutcome({
      executor: "omp",
      parsed: {
        status: "completed",
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0.002,
        },
        toolCounts: { search: 1, fetch: 1, browser: 0 },
        toolFailed: 0,
        frameCount: 10,
      },
      execution: {
        code: 0,
        timedOut: false,
        outputLimitExceeded: false,
        parseFailed: false,
        secretLeakDetected: false,
        durationMs: 120,
        firstOutputMs: 10,
        stdoutBytes: 1_000,
        stderrBytes: 0,
        stderr: "",
      },
      outcome: {
        passed: true,
        diagnostics: [],
        evidence: {
          finalOutputSha256: "b".repeat(64),
          finalOutputBytes: 100,
          factCount: 1,
          factSetSha256: "c".repeat(64),
          answerSetSha256: "d".repeat(64),
          sourceUrlSetSha256: "e".repeat(64),
          quoteSetSha256: "f".repeat(64),
        },
      },
      persistenceScan: { leakDetected: false, bytes: 1_024, fileCount: 4 },
      infrastructureSignal: false,
      credentialBoundary: "loopback_proxy_dummy_child_key",
      modelProxy: {
        requestCount: 1,
        requestBytes: 100,
        responseBytes: 200,
        rejectedCount: 0,
        modelMatch: true,
        upstreamOriginSha256: "1".repeat(64),
      },
      browserIsolation,
      publicNetwork: {
        requestCount: 3,
        connectCount: 2,
        rejectedCount: 0,
        transferredBytes: 1_024,
        destinationCount: 2,
        destinationsSha256: "3".repeat(64),
      },
      sandbox: {
        id: "macos-sandbox-exec-guarded",
        profileSha256: "2".repeat(64),
      },
    });

    expect(assembled.browserIsolation).toEqual(browserIsolation);
  });

  it("cannot pass a Browser case when the isolated CDP endpoint was used", () => {
    const assembled = createOpenWebComparisonTrialOutcome({
      executor: "omp",
      parsed: {
        status: "completed",
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0.002,
        },
        toolCounts: { search: 0, fetch: 0, browser: 1 },
        toolFailed: 0,
        frameCount: 10,
      },
      execution: {
        code: 0,
        timedOut: false,
        outputLimitExceeded: false,
        parseFailed: false,
        secretLeakDetected: false,
        durationMs: 120,
        firstOutputMs: 10,
        stdoutBytes: 1_000,
        stderrBytes: 0,
        stderr: "",
      },
      outcome: {
        passed: true,
        diagnostics: [],
        evidence: {
          finalOutputSha256: "b".repeat(64),
          finalOutputBytes: 100,
          factCount: 1,
          factSetSha256: "c".repeat(64),
          answerSetSha256: "d".repeat(64),
          sourceUrlSetSha256: "e".repeat(64),
          quoteSetSha256: "f".repeat(64),
        },
      },
      persistenceScan: { leakDetected: false, bytes: 1_024, fileCount: 4 },
      infrastructureSignal: false,
      credentialBoundary: "loopback_proxy_dummy_child_key",
      browserIsolation: {
        status: "blocked",
        diagnostic: "nested_chromium_sandbox_unavailable",
        requestCount: 1,
      },
    });

    expect(assembled).toEqual(
      expect.objectContaining({
        status: "infrastructure_failure",
        outcomePassed: false,
        failureClass: "external_infrastructure",
      }),
    );
  });

  it("accepts an outcome when the fresh isolated Browser closed cleanly", () => {
    const assembled = createOpenWebComparisonTrialOutcome({
      executor: "omp",
      parsed: {
        status: "completed",
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0.002,
        },
        toolCounts: { search: 0, fetch: 0, browser: 1 },
        toolFailed: 0,
        frameCount: 10,
      },
      execution: {
        code: 0,
        timedOut: false,
        outputLimitExceeded: false,
        parseFailed: false,
        secretLeakDetected: false,
        durationMs: 120,
        firstOutputMs: 10,
        stdoutBytes: 1_000,
        stderrBytes: 0,
        stderr: "",
      },
      outcome: {
        passed: true,
        diagnostics: [],
        evidence: {
          finalOutputSha256: "b".repeat(64),
          finalOutputBytes: 100,
          factCount: 1,
          factSetSha256: "c".repeat(64),
          answerSetSha256: "d".repeat(64),
          sourceUrlSetSha256: "e".repeat(64),
          quoteSetSha256: "f".repeat(64),
        },
      },
      persistenceScan: { leakDetected: false, bytes: 1_024, fileCount: 4 },
      infrastructureSignal: false,
      credentialBoundary: "loopback_proxy_dummy_child_key",
      browserIsolation: readyBrowserIsolation(),
    });

    expect(assembled).toEqual(
      expect.objectContaining({
        status: "passed",
        outcomePassed: true,
        failureClass: "none",
      }),
    );
  });

  it("creates a counterbalanced self-verifying privacy-safe report", () => {
    const suite = createOpenWebComparisonSuite(20260805);
    const cases = suite.cases.map((benchmarkCase, caseIndex) => ({
      caseId: benchmarkCase.id,
      complexity: benchmarkCase.complexity,
      taskFamily: benchmarkCase.taskFamily,
      promptSha256: benchmarkCase.promptSha256,
      oracleSha256: benchmarkCase.oracleSha256,
      caseSha256: benchmarkCase.caseSha256,
      tracks: [
        {
          track: "default",
          trials: [
            pair(
              1,
              caseIndex % 2 === 0 ? ["napier", "omp"] : ["omp", "napier"],
              outcome("napier", "passed"),
              outcome("omp", "failed"),
            ),
          ],
        },
        {
          track: "controlled",
          trials: [
            pair(
              1,
              caseIndex % 2 === 0 ? ["omp", "napier"] : ["napier", "omp"],
              outcome("napier", "passed"),
              outcome("omp", "passed"),
            ),
          ],
        },
      ],
    }));
    const content = reportContent(suite, cases);
    content.summary = openWebComparisonSummary(cases);
    const report = createOpenWebComparisonReport(content);
    expect(verifyOpenWebComparisonReport(report)).toEqual({
      valid: true,
      diagnostics: [],
      reportSha256: report.contentSha256,
    });
    expect(report.summary.overall).toEqual(
      expect.objectContaining({
        pairCount: 6,
        decisivePairCount: 6,
        excludedPairCount: 0,
        napier: expect.objectContaining({ passed: 6 }),
        omp: expect.objectContaining({ passed: 3, failed: 3 }),
        paired: {
          bothPassed: 3,
          napierOnlyPassed: 3,
          ompOnlyPassed: 0,
          neitherPassed: 0,
        },
      }),
    );
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("nodejs.org/");
    expect(serialized).not.toContain("Dummy PDF file");
    expect(serialized).not.toContain("reasoning_content");

    const tampered = structuredClone(report);
    tampered.summary.overall.pairCount += 1;
    tampered.contentSha256 = hashWithoutSelf(tampered);
    expect(verifyOpenWebComparisonReport(tampered)).toEqual(
      expect.objectContaining({
        valid: false,
        diagnostics: ["report_summary_invalid"],
      }),
    );
    const leaked = structuredClone(report);
    leaked.transcript = "https://nodejs.org/en/blog/release/v24.0.0";
    leaked.contentSha256 = hashWithoutSelf(leaked);
    expect(verifyOpenWebComparisonReport(leaked)).toEqual({
      valid: false,
      diagnostics: ["report_shape_invalid"],
    });
  });

  it("verifies schema-2 reports with ready isolated Browser evidence", () => {
    const suite = createOpenWebComparisonSuite(20260805);
    const cases = suite.cases.map((benchmarkCase, caseIndex) => ({
      caseId: benchmarkCase.id,
      complexity: benchmarkCase.complexity,
      taskFamily: benchmarkCase.taskFamily,
      promptSha256: benchmarkCase.promptSha256,
      oracleSha256: benchmarkCase.oracleSha256,
      caseSha256: benchmarkCase.caseSha256,
      tracks: ["default", "controlled"].map((track, trackIndex) => ({
        track,
        trials: [
          pair(
            1,
            (1 + trackIndex + caseIndex) % 2 === 0
              ? ["omp", "napier"]
              : ["napier", "omp"],
            outcome("napier", "passed"),
            outcomeV2("omp", "passed"),
          ),
        ],
      })),
    }));
    const content = reportContentV2(suite, cases);
    content.summary = openWebComparisonSummary(cases);
    const report = createOpenWebComparisonReport(content);

    expect(verifyOpenWebComparisonReport(report)).toEqual({
      valid: true,
      diagnostics: [],
      reportSha256: report.contentSha256,
    });
    expect(report.summary.overall.excludedPairCount).toBe(0);
    expect(report.cases[0].tracks[0].trials[0].omp.browserIsolation).toEqual(
      readyBrowserIsolation(),
    );
    const substituted = structuredClone(report);
    substituted.cases[0].tracks[0].trials[0].omp.browserIsolation.browserRuntimeSetSha256 =
      "6".repeat(64);
    substituted.contentSha256 = hashWithoutSelf(substituted);
    expect(verifyOpenWebComparisonReport(substituted)).toEqual(
      expect.objectContaining({
        valid: false,
        diagnostics: ["report_browser_binding_invalid"],
      }),
    );
  });

  it("excludes infrastructure and inconclusive outcomes from paired wins", () => {
    const cases = [
      {
        tracks: [
          {
            track: "default",
            trials: [
              pair(
                1,
                ["napier", "omp"],
                outcome("napier", "passed"),
                outcome("omp", "infrastructure_failure"),
              ),
              pair(
                2,
                ["omp", "napier"],
                outcome("napier", "inconclusive"),
                outcome("omp", "passed"),
              ),
              pair(
                3,
                ["napier", "omp"],
                outcome("napier", "passed"),
                outcome("omp", "failed"),
              ),
            ],
          },
        ],
      },
    ];

    expect(openWebComparisonSummary(cases).byTrack.default).toEqual(
      expect.objectContaining({
        pairCount: 3,
        decisivePairCount: 1,
        excludedPairCount: 2,
        paired: {
          bothPassed: 0,
          napierOnlyPassed: 1,
          ompOnlyPassed: 0,
          neitherPassed: 0,
        },
      }),
    );
  });

  it("bounds process output and detects secret bytes without retaining stdout", async () => {
    const secret = "comparison-secret";
    const lines = [];
    const root = await mkdtemp(path.join(tmpdir(), "napier-compare-process-"));
    roots.push(root);
    const result = await runOpenWebComparisonProcess({
      command: process.execPath,
      args: [
        "-e",
        `console.log(JSON.stringify({type:"ok"})); console.error(${JSON.stringify(secret)})`,
      ],
      cwd: root,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
      timeoutMs: 5_000,
      secret,
      onStdoutLine: (line) => lines.push(JSON.parse(line)),
    });
    expect(result).toEqual(
      expect.objectContaining({
        code: 0,
        timedOut: false,
        parseFailed: false,
        secretLeakDetected: true,
      }),
    );
    expect(lines).toEqual([{ type: "ok" }]);
    expect(result).not.toHaveProperty("stdout");
  });

  it("detects credentials split across process stream chunks", async () => {
    const secret = "comparison-secret-across-chunks";
    const root = await mkdtemp(path.join(tmpdir(), "napier-compare-stream-"));
    roots.push(root);
    const split = Math.floor(secret.length / 2);
    const result = await runOpenWebComparisonProcess({
      command: process.execPath,
      args: [
        "-e",
        `process.stderr.write(${JSON.stringify(secret.slice(0, split))}); setTimeout(() => process.stderr.end(${JSON.stringify(secret.slice(split))}), 25)`,
      ],
      cwd: root,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
      timeoutMs: 5_000,
      secrets: [secret],
      onStdoutLine: () => undefined,
    });

    expect(result.secretLeakDetected).toBe(true);
  });

  it("force-kills a timed-out process group after the termination grace", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-compare-timeout-"));
    roots.push(root);
    const result = await runOpenWebComparisonProcess({
      command: process.execPath,
      args: [
        "-e",
        'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)',
      ],
      cwd: root,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
      timeoutMs: 250,
      onStdoutLine: () => undefined,
    });

    expect(result.timedOut).toBe(true);
    expect(result.signal).toBe("SIGKILL");
    expect(result.durationMs).toBeLessThan(2_000);
  });

  it("detects persisted credentials and rejects escaping state symlinks", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-compare-scan-"));
    const outside = await mkdtemp(
      path.join(tmpdir(), "napier-compare-outside-"),
    );
    roots.push(root, outside);
    const state = path.join(root, "state");
    await mkdir(state);
    const secret = "persisted-comparison-secret";
    await writeFile(path.join(state, "state.json"), `prefix:${secret}:suffix`);

    await expect(
      scanOpenWebComparisonSecrets([root], [secret]),
    ).resolves.toEqual(
      expect.objectContaining({
        leakDetected: true,
        fileCount: 1,
      }),
    );

    await symlink(outside, path.join(state, "escape"));
    await expect(
      scanOpenWebComparisonSecrets([root], ["absent-secret"]),
    ).rejects.toThrow("Comparison state symlink escapes the trial roots");
  });
});

function reportContent(suite, cases) {
  return {
    type: "napier.open-web-executor-comparison",
    schemaVersion: 1,
    generatedAt: "2026-08-05T00:00:00.000Z",
    seed: suite.seed,
    trialCount: 1,
    timeoutMs: 180_000,
    model: { provider: "deepseek", id: "deepseek-v4-flash" },
    suite: publicOpenWebComparisonSuite(suite),
    environment: {
      platform: "darwin",
      architecture: "arm64",
      nodeVersion: "24.16.0",
      napierVersion: "0.1.0",
      ompVersion: "17.2.1",
      ompExecutableSha256: "a".repeat(64),
      ompRuntimeExecutableSha256: "9".repeat(64),
      ompRuntimeVersion: "17.2.1",
      outerSandbox: "macos-sandbox-exec-guarded",
    },
    cases,
    summary: {},
    notes: OPEN_WEB_COMPARISON_NOTES,
  };
}

function reportContentV2(suite, cases) {
  return {
    ...reportContent(suite, cases),
    schemaVersion: 2,
    environment: {
      ...reportContent(suite, cases).environment,
      browserRuntimeExecutableSha256: "7".repeat(64),
      browserRuntimeSetSha256: "8".repeat(64),
      browserRuntimeFileCount: 17,
      browserRuntimeBytes: 201_473_747,
    },
    notes: OPEN_WEB_COMPARISON_NOTES_V2,
  };
}

function pair(trial, order, napier, omp) {
  return { trial, order, napier, omp };
}

function outcome(executor, status) {
  return {
    executor,
    status,
    outcomePassed: status === "passed",
    failureClass: status === "passed" ? "none" : "outcome_oracle",
    durationMs: executor === "napier" ? 100 : 120,
    firstOutputMs: 10,
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: executor === "napier" ? 0.001 : 0.002,
    },
    toolCounts: { search: 1, fetch: 1, browser: 1 },
    toolFailed: status === "passed" ? 0 : 1,
    manualInterventionCount: 0,
    diagnostics: status === "passed" ? [] : ["quote_mismatch"],
    evidence: {
      finalOutputSha256: "b".repeat(64),
      finalOutputBytes: 100,
      factCount: 1,
      factSetSha256: "c".repeat(64),
      answerSetSha256: "d".repeat(64),
      sourceUrlSetSha256: "e".repeat(64),
      quoteSetSha256: "f".repeat(64),
    },
    process: {
      exitCode: 0,
      timedOut: false,
      outputLimitExceeded: false,
      parseFailed: false,
      stdoutBytes: 1_000,
      stderrBytes: 0,
      stderrSha256: "0".repeat(64),
      frameCount: 10,
    },
    security: {
      secretLeakDetected: false,
      ambientCredentialCount: 0,
      persistenceScanBytes: 1_024,
      persistenceScanFileCount: 4,
      credentialBoundary:
        executor === "omp"
          ? "loopback_proxy_dummy_child_key"
          : "environment_locator",
    },
    ...(executor === "omp"
      ? {
          modelProxy: {
            requestCount: 1,
            requestBytes: 100,
            responseBytes: 200,
            rejectedCount: 0,
            modelMatch: true,
            upstreamOriginSha256: "1".repeat(64),
          },
          browserIsolation: {
            status: "blocked",
            diagnostic: "nested_chromium_sandbox_unavailable",
            requestCount: 0,
          },
          publicNetwork: {
            requestCount: 3,
            connectCount: 2,
            rejectedCount: 0,
            transferredBytes: 1_024,
            destinationCount: 2,
            destinationsSha256: "3".repeat(64),
          },
          sandbox: {
            id: "macos-sandbox-exec-guarded",
            profileSha256: "2".repeat(64),
          },
        }
      : {}),
  };
}

function outcomeV2(executor, status) {
  const value = outcome(executor, status);
  if (executor === "omp") value.browserIsolation = readyBrowserIsolation();
  return value;
}

function readyBrowserIsolation() {
  return {
    status: "ready",
    diagnostic: "fresh_profile_loopback_cdp",
    profilePersistent: false,
    userStateImported: false,
    loopbackOnly: true,
    processClosed: true,
    launchDurationMs: 2_000,
    browserExecutableSha256: "7".repeat(64),
    browserRuntimeSetSha256: "8".repeat(64),
    sandboxProfileSha256: "9".repeat(64),
    cdpEndpointSha256: "a".repeat(64),
    network: {
      requestCount: 3,
      connectCount: 2,
      rejectedCount: 0,
      transferredBytes: 1_024,
      destinationCount: 2,
      destinationsSha256: "3".repeat(64),
    },
  };
}

function hashWithoutSelf(value) {
  const clone = structuredClone(value);
  delete clone.contentSha256;
  return createHash("sha256").update(canonical(clone)).digest("hex");
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}
