import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/ids.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/ids.js")>();
  return {
    ...actual,
    createId(prefix: string) {
      if (prefix === "source") return "source_fixture0001";
      if (prefix === "citation") return "citation_fixture0001";
      return actual.createId(prefix);
    },
  };
});

import {
  AgentRuntime,
  type BrowserPageSourceCapture,
  type BrowserSessionDetails,
  canonicalJson,
  LocalStore,
  ModelRegistry,
  RunBrowserSessionManager,
  sha256,
} from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("Agent Research Source integration", () => {
  it("captures and cites Browser evidence without persisting source content", async () => {
    const fixture = await createFixture();
    const capture = sourceCapture();
    const reportPath = "reports/research-brief.md";
    const citationToken = "[citation:citation_fixture0001]";
    const report = [
      "# Research Brief",
      "",
      `Napier captured immutable Browser evidence. ${citationToken}`,
      "",
      "## Evidence Ledger",
      "",
      "- Source: source_fixture0001",
      `- Capture SHA-256: ${capture.capturedContentSha256}`,
      "- Lines: 2-2",
      "- Citation ID: citation_fixture0001",
      "- URL: https://example.com/",
      "",
    ].join("\n");
    let planId = "";
    const browserSessions = {
      execute: vi.fn(async () => ({
        output:
          "Browser page URL: https://example.com/?token=URL_SECRET\nTitle: TITLE_SECRET",
        details: browserDetails(),
      })),
      capturePage: vi.fn(async () => capture),
      cancelRun: vi.fn(async () => undefined),
    } as unknown as RunBrowserSessionManager;
    const provider = fauxProvider({ provider: "faux-research-source" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("create_plan", {
          objective: "Produce and verify a citation-backed research brief.",
          steps: [
            {
              id: "research",
              title: "Research and deliver",
              description:
                "Capture web evidence and write a citation-backed brief.",
              verification:
                "The report artifact is verified from workspace bytes.",
            },
          ],
          artifacts: [
            {
              id: "brief",
              path: reportPath,
              kind: "file",
              description: "Citation-backed Markdown research brief.",
            },
          ],
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        const match = /"planId":"([^"]+)"/u.exec(
          JSON.stringify(context.messages),
        );
        planId = match?.[1] ?? "";
        expect(planId).toMatch(/^plan_/u);
        return fauxAssistantMessage(
          fauxToolCall("update_plan_step", {
            planId,
            stepId: "research",
            action: "start",
          }),
          { stopReason: "toolUse" },
        );
      },
      fauxAssistantMessage(
        fauxToolCall("browser", {
          action: "start",
          url: "https://example.com/?token=URL_SECRET",
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        fauxToolCall("research_source", {
          action: "capture",
          maxChars: 12_000,
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        fauxToolCall("research_source", {
          action: "cite",
          sourceId: "source_fixture0001",
          sourceContentSha256: capture.capturedContentSha256,
          startLine: 2,
          endLine: 2,
          claim: "Napier captured immutable Browser evidence.",
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        fauxToolCall("apply_patch", {
          operation: "create",
          path: reportPath,
          expectedSha256: null,
          content: report,
          createParentDirectories: true,
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        fauxToolCall("research_source", {
          action: "verify_report",
          path: reportPath,
          expectedSha256: sha256(report),
        }),
        { stopReason: "toolUse" },
      ),
      () =>
        fauxAssistantMessage(
          fauxToolCall("update_plan_artifact", {
            planId,
            artifactId: "brief",
            action: "produced",
            evidence:
              "The citation-backed Markdown brief was written by apply_patch.",
          }),
          { stopReason: "toolUse" },
        ),
      () =>
        fauxAssistantMessage(
          fauxToolCall("update_plan_artifact", {
            planId,
            artifactId: "brief",
            action: "verify",
            evidence: "Napier verified the report from workspace bytes.",
          }),
          { stopReason: "toolUse" },
        ),
      () =>
        fauxAssistantMessage(
          fauxToolCall("update_plan_step", {
            planId,
            stepId: "research",
            action: "complete",
            evidence:
              "The Source citation and verified report artifact are complete.",
          }),
          { stopReason: "toolUse" },
        ),
      fauxAssistantMessage(`The verified report is at ${reportPath}.`),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    fixture.registry.registerProvider(provider.provider);
    const runtime = new AgentRuntime(
      fixture.store,
      fixture.registry,
      undefined,
      undefined,
      undefined,
      undefined,
      browserSessions,
    );

    const run = await runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Write and verify a citation-backed Markdown research brief.",
      model: { provider: "faux-research-source", id: "faux-1" },
    });

    expect(run.status, run.error).toBe("completed");
    await expect(
      readFile(path.join(fixture.workspaceRoot, reportPath), "utf8"),
    ).resolves.toBe(report);
    expect(fixture.store.getPlan(planId)).toEqual(
      expect.objectContaining({
        status: "completed",
        artifacts: [
          expect.objectContaining({
            id: "brief",
            status: "verified",
            sha256: sha256(report),
            sourceRunId: run.id,
          }),
        ],
      }),
    );
    expect(browserSessions.capturePage).toHaveBeenCalledWith(
      { threadId: fixture.threadId, runId: run.id },
      12_000,
      expect.any(AbortSignal),
    );
    expect(browserSessions.cancelRun).toHaveBeenCalledWith({
      threadId: fixture.threadId,
      runId: run.id,
    });
    const events = await fixture.store.listEvents(fixture.threadId);
    const toolEvents = events.filter(
      (event) =>
        event.type.startsWith("tool.") &&
        ["browser", "research_source"].includes(
          String(record(event.payload)?.["toolName"]),
        ),
    );
    expect(
      toolEvents
        .filter((event) => event.type === "tool.started")
        .map((event) => record(event.payload)?.["effect"]),
    ).toEqual(["read", "read", "read", "read"]);
    expect(
      toolEvents
        .filter(
          (event) =>
            event.type === "tool.completed" &&
            record(event.payload)?.["toolName"] === "research_source",
        )
        .map((event) => record(record(event.payload)?.["details"])?.["action"]),
    ).toEqual(["capture", "cite", "verify_report"]);
    const durableTools = JSON.stringify(toolEvents);
    for (const secret of [
      "URL_SECRET",
      "TITLE_SECRET",
      "SOURCE_BODY_SECRET",
      "QUOTE_SECRET",
      reportPath,
    ]) {
      expect(durableTools).not.toContain(secret);
    }
    expect(
      events.find(
        (event) =>
          event.type === "message.assistant" &&
          String(record(event.payload)?.["text"]).includes(
            `The verified report is at ${reportPath}.`,
          ),
      ),
    ).toBeDefined();
  });
});

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-agent-research-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  await store.initialize();
  const agent = await store.updateAgent(store.listAgents()[0]!.id, {
    toolPolicy: "workspace",
    enabledTools: ["browser", "research_source", "apply_patch"],
    enabledSkills: ["research-brief"],
  });
  const thread = await store.createThread({
    title: "Agent research Source",
    agentId: agent.id,
  });
  return {
    store,
    workspaceRoot,
    threadId: thread.id,
    registry: new ModelRegistry(),
  };
}

function sourceCapture(): BrowserPageSourceCapture {
  const content = {
    url: "https://example.com/?token=CAPTURE_URL_SECRET",
    title: "TITLE_SECRET",
    lines: [
      "SOURCE_BODY_SECRET",
      "Napier captured immutable Browser evidence. QUOTE_SECRET",
    ],
    truncated: false,
  };
  return {
    ...content,
    textChars: content.lines.join("\n").length,
    capturedContentSha256: sha256(canonicalJson(content)),
    sessionOperation: 2,
    sessionIdSha256: "1".repeat(64),
    browserExecutableSha256: "2".repeat(64),
    browserVersionSha256: "3".repeat(64),
    limitsSha256: "4".repeat(64),
    network: {
      requestCount: 2,
      connectCount: 1,
      rejectedCount: 0,
      transferredBytes: 512,
      destinationCount: 1,
      destinationsSha256: "5".repeat(64),
    },
  };
}

function browserDetails(): BrowserSessionDetails {
  return {
    kind: "napier.browser-session-operation",
    schemaVersion: 1,
    action: "start",
    sessionMode: "run_persistent",
    sessionReused: false,
    sessionOperation: 1,
    sessionIdSha256: "1".repeat(64),
    browserExecutableSha256: "2".repeat(64),
    browserVersionSha256: "3".repeat(64),
    limitsSha256: "4".repeat(64),
    currentUrlSha256: "5".repeat(64),
    currentOriginSha256: "6".repeat(64),
    titleSha256: "7".repeat(64),
    snapshotSha256: "8".repeat(64),
    snapshotChars: 100,
    snapshotTruncated: false,
    blockedRequestCount: 0,
    network: {
      requestCount: 1,
      connectCount: 1,
      rejectedCount: 0,
      transferredBytes: 100,
      destinationCount: 1,
      destinationsSha256: "9".repeat(64),
    },
    crossOriginAuthorized: false,
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
