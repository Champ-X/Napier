import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";

import type { CredentialReference, ThreadDetail } from "@napier/contracts";
import {
  createOpenTelemetryTraceArtifact,
  verifyOpenTelemetryTraceArtifact,
} from "@napier/runtime/core";
import {
  exportThreadReplayBundle,
  verifyThreadReplayBundle,
} from "@napier/runtime/agent";

import { runCli } from "../apps/cli/src/cli.js";
import { createApp, createServices } from "../apps/server/src/app.js";
import {
  checkCredentialReference,
  createCredentialReference,
} from "../apps/web/src/context-api.js";
import {
  credentialEventTraceSummary,
  credentialEventTraceView,
} from "../apps/web/src/credential-event-view.js";
import { readSseJsonRecords } from "../apps/web/src/sse-json.js";

interface CanaryResult {
  status: "pass" | "fail";
  matchCount: number;
}

class CaptureWritable extends Writable {
  readonly chunks: Buffer[] = [];

  override _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(
      Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding),
    );
    callback();
  }

  text(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

const result = await runCanary().catch(
  (): CanaryResult => ({
    status: "fail",
    matchCount: 0,
  }),
);
process.stdout.write(`${JSON.stringify(result)}\n`);
if (result.status === "fail") process.exitCode = 1;

async function runCanary(): Promise<CanaryResult> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-credential-canary-"));
  const secret = `napier-canary-${randomBytes(24).toString("hex")}`;
  let services: Awaited<ReturnType<typeof createServices>> | undefined;
  try {
    const surfaces: unknown[] = [];
    surfaces.push(await exerciseCli(path.join(root, "cli"), secret));

    const serverRoot = path.join(root, "server");
    const workspaceRoot = path.join(serverRoot, "workspace");
    const dataRoot = path.join(serverRoot, "data");
    await mkdir(workspaceRoot, { recursive: true });
    services = await createServices({
      workspaceRoot,
      dataRoot,
      env: {
        DEEPSEEK_API_KEY: secret,
        OPENAI_API_KEY: secret,
      },
    });
    const app = createApp(services);

    const threadResponse = await app.request("/api/threads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Credential reference canary" }),
    });
    assertStatus(threadResponse, 201);
    const threadText = await threadResponse.text();
    const created = JSON.parse(threadText) as ThreadDetail;
    surfaces.push({
      body: threadText,
      headers: Object.fromEntries(threadResponse.headers),
    });

    const httpResponse = await app.request("/api/credentials", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerId: "deepseek",
        label: "HTTP canary reference",
        source: { type: "environment", variable: "DEEPSEEK_API_KEY" },
        threadId: created.thread.id,
      }),
    });
    assertStatus(httpResponse, 201);
    const httpText = await httpResponse.text();
    const httpReference = JSON.parse(httpText) as CredentialReference;
    surfaces.push({
      body: httpText,
      headers: Object.fromEntries(httpResponse.headers),
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const requestPath =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? `${input.pathname}${input.search}`
            : `${new URL(input.url).pathname}${new URL(input.url).search}`;
      return app.request(requestPath, init);
    }) as typeof fetch;
    let webReference: CredentialReference;
    let checkedWebReference: CredentialReference;
    try {
      webReference = await createCredentialReference({
        providerId: "openai",
        label: "Web canary reference",
        source: { type: "environment", variable: "OPENAI_API_KEY" },
        threadId: created.thread.id,
      });
      checkedWebReference = await checkCredentialReference(
        webReference.id,
        created.thread.id,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
    if (checkedWebReference.availability !== "available") {
      throw new Error("Web credential check did not resolve the reference");
    }

    const prompt =
      "Verify the registered OPENAI_API_KEY credential reference without reading or returning its value.";
    const sseResponse = await app.request(
      `/api/threads/${created.thread.id}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: prompt }),
      },
    );
    assertStatus(sseResponse, 200);
    if (
      !sseResponse.headers.get("content-type")?.includes("text/event-stream")
    ) {
      throw new Error("Formal SSE response contract is missing");
    }
    const sseHeaders = Object.fromEntries(sseResponse.headers);
    const sseBody = await sseResponse.text();
    const sseRecords: unknown[] = [];
    const replayedSseBody = new Response(sseBody).body;
    if (!replayedSseBody) throw new Error("Formal SSE body is missing");
    for await (const record of readSseJsonRecords(
      `/api/threads/${created.thread.id}/messages`,
      replayedSseBody,
    )) {
      sseRecords.push(record);
    }
    if (sseRecords.length === 0) {
      throw new Error("Formal SSE serialization emitted no records");
    }
    surfaces.push({
      sse: { headers: sseHeaders, body: sseBody, records: sseRecords },
    });

    const detail = await services.store.getDetail(created.thread.id);
    const credentialEvents = detail.events.filter((event) =>
      event.type.startsWith("credential.reference."),
    );
    const webProjection = credentialEvents.map((event) => ({
      view: credentialEventTraceView(event),
      summary: credentialEventTraceSummary(event),
    }));
    const trace = await createOpenTelemetryTraceArtifact(
      services.store,
      created.thread.id,
    );
    const traceVerification = verifyOpenTelemetryTraceArtifact(trace);
    if (traceVerification.status !== "valid") {
      throw new Error("Trace verification failed");
    }
    const artifact = await exportThreadReplayBundle(
      services.store,
      created.thread.id,
    );
    if (verifyThreadReplayBundle(artifact).status !== "valid") {
      throw new Error("Replay artifact verification failed");
    }
    if (
      !credentialEvents.some(
        (event) =>
          event.type === "credential.reference.created" &&
          event.payload &&
          typeof event.payload === "object" &&
          !Array.isArray(event.payload) &&
          event.payload["referenceId"] === httpReference.id,
      ) ||
      !credentialEvents.some(
        (event) =>
          event.type === "credential.reference.checked" &&
          event.payload &&
          typeof event.payload === "object" &&
          !Array.isArray(event.payload) &&
          event.payload["referenceId"] === webReference.id,
      )
    ) {
      throw new Error("Credential reference events are incomplete");
    }

    surfaces.push(
      { webReference, checkedWebReference, webProjection },
      { thread: detail.thread, runs: detail.runs },
      { prompt },
      { events: detail.events },
      { trace, traceVerification },
      { artifact },
    );

    await services.shutdownLocalRuntime();
    services = undefined;
    const surfaceMatchCount = countMatches(
      Buffer.from(JSON.stringify(surfaces)),
      Buffer.from(secret),
    );
    const persistenceMatchCount = await countMatchesInDirectory(root, secret);
    const matchCount = surfaceMatchCount + persistenceMatchCount;
    return { status: matchCount === 0 ? "pass" : "fail", matchCount };
  } finally {
    if (services) await services.shutdownLocalRuntime().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
}

async function exerciseCli(root: string, secret: string): Promise<unknown> {
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot, { recursive: true });
  const env = { DEEPSEEK_API_KEY: secret };
  const previewStdout = new CaptureWritable();
  const previewStderr = new CaptureWritable();
  const previewCode = await runCli(
    ["setup", "--workspace", workspaceRoot, "--data-root", dataRoot, "--jsonl"],
    cliIo(root, env, previewStdout, previewStderr),
  );
  if (previewCode !== 0 || previewStderr.text() !== "") {
    throw new Error("CLI credential preview failed");
  }
  const preview = JSON.parse(previewStdout.text()) as {
    contentSha256: string;
  };
  const applyStdout = new CaptureWritable();
  const applyStderr = new CaptureWritable();
  const applyCode = await runCli(
    [
      "setup",
      "--workspace",
      workspaceRoot,
      "--data-root",
      dataRoot,
      "--provider",
      "deepseek",
      "--expected-preview",
      preview.contentSha256,
      "--apply",
      "--jsonl",
    ],
    cliIo(root, env, applyStdout, applyStderr),
  );
  if (applyCode !== 0 || applyStderr.text() !== "") {
    throw new Error("CLI credential apply failed");
  }
  return {
    preview: previewStdout.text(),
    previewErrors: previewStderr.text(),
    apply: applyStdout.text(),
    applyErrors: applyStderr.text(),
  };
}

function cliIo(
  cwd: string,
  env: Readonly<Record<string, string | undefined>>,
  stdout: Writable,
  stderr: Writable,
) {
  return {
    cwd,
    env,
    stdin: process.stdin,
    stdout,
    stderr,
  };
}

function assertStatus(response: Response, expected: number): void {
  if (response.status !== expected) {
    throw new Error("HTTP credential canary request failed");
  }
}

async function countMatchesInDirectory(
  directory: string,
  secret: string,
): Promise<number> {
  const needle = Buffer.from(secret);
  let matches = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      matches += await countMatchesInDirectory(entryPath, secret);
    } else if (entry.isFile()) {
      matches += countMatches(await readFile(entryPath), needle);
    }
  }
  return matches;
}

function countMatches(haystack: Buffer, needle: Buffer): number {
  let matches = 0;
  let offset = 0;
  while ((offset = haystack.indexOf(needle, offset)) !== -1) {
    matches += 1;
    offset += needle.length;
  }
  return matches;
}
