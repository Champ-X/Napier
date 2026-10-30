import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { it, expect, vi, afterEach } from "vitest";
import { LocalStore } from "../src/store.js";
import {
  KernelProjectionRegistry,
  TaskNarrativeProjectionService,
} from "../src/kernel-projections.js";
import { BrowserOutputArtifactRegistrar } from "../src/browser-output-artifact.js";
import { RunResearchSourceManager } from "../src/research-sources.js";
import { createResearchSourceTool } from "../src/research-source-tool.js";
import { writeWorkspaceOutputFile } from "../src/workspace-output-file.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-g01-native-output-"));
  roots.push(root);
  const options = {
    dataRoot: path.join(root, "data"),
    workspaceRoot: path.join(root, "workspace"),
  };
  await mkdir(options.workspaceRoot);
  const store = new LocalStore(options);
  await store.initialize();
  const agent = store.listAgents()[0]!;
  const thread = await store.createThread({
    agentId: agent.id,
    title: "Native tool-only artifact counterexample",
  });
  const run = await store.createRun({
    threadId: thread.id,
    agentId: agent.id,
    source: "user",
  });
  return {
    root,
    options,
    store,
    thread,
    run,
    owner: { threadId: thread.id, runId: run.id },
  };
}
function capture() {
  const content = {
    url: "https://example.com/research",
    title: "Local research fixture",
    lines: ["Local research fixture", "A deterministic captured line."],
    truncated: false,
  };
  return {
    ...content,
    textChars: content.lines.join("\n").length,
    capturedContentSha256: sha256(canonicalJson(content)),
    sessionOperation: 2,
    sessionIdSha256: "1".repeat(64),
    activeTabId: "tab_1",
    tabCount: 1,
    tabSetSha256: sha256(canonicalJson(["tab_1"])),
    browserExecutableSha256: "2".repeat(64),
    browserVersionSha256: "3".repeat(64),
    limitsSha256: "4".repeat(64),
    network: {
      requestCount: 0,
      connectCount: 0,
      rejectedCount: 0,
      transferredBytes: 0,
      destinationCount: 0,
      destinationsSha256: "5".repeat(64),
    },
  };
}
async function observe(
  f: Awaited<ReturnType<typeof fixture>>,
  relative: string,
) {
  const registry = new KernelProjectionRegistry();
  const service = new TaskNarrativeProjectionService(registry, f.store);
  await service.project(f.thread.id);
  await f.store.appendEvent({
    threadId: f.thread.id,
    runId: f.run.id,
    type: "message.assistant",
    category: "message",
    visibility: "user",
    payload: {
      role: "assistant",
      text: "The local tool completed successfully.",
    },
  });
  await f.store.finishRun(f.run.id, "completed");
  const full = (await f.store.getDetail(f.thread.id)).taskNarrative!,
    warm = (await service.project(f.thread.id)).view;
  expect(warm).toEqual(full);
  registry.shutdown();
  await f.store.shutdown();
  const reopened = new LocalStore(f.options);
  await reopened.initialize();
  try {
    const restarted = (await reopened.getDetail(f.thread.id)).taskNarrative!;
    expect(restarted).toEqual(full);
    expect(full.objective?.status).toBe("unverified");
    expect(full.deliverables?.[0]).toMatchObject({
      source: "tool_file",
      verification: "integrity_observed",
      artifact: { status: "verified" },
    });
    expect(
      full.deliverables?.some((d) => d.path === relative),
      "A host-verified tool file should survive independently of final answer wording",
    ).toBe(true);
  } finally {
    await reopened.shutdown();
  }
}
it("retains a real native workspace output after Browser output registration with no Plan", async () => {
  vi.stubGlobal("fetch", () => {
    throw new Error("External requests forbidden");
  });
  const f = await fixture();
  try {
    const bytes = Buffer.from("Local download output.\n");
    const file = await writeWorkspaceOutputFile(
      f.options.workspaceRoot,
      "download.txt",
      Readable.from([bytes]),
      { scope: "Browser", action: "download", maximumBytes: 1024 },
    );
    const registration = await new BrowserOutputArtifactRegistrar(
      f.store,
    ).register(f.owner, {
      operationId: "native-browser-output",
      action: "download",
      path: file.path,
      pathSha256: file.pathSha256,
      fileSha256: file.fileSha256,
      fileBytes: file.fileBytes,
    });
    expect(registration).toEqual({
      status: "registered",
      reason: "artifact_registered",
    });
    expect(await readFile(file.target)).toEqual(bytes);
    await observe(f, "download.txt");
  } finally {
    f.store.close();
    vi.unstubAllGlobals();
  }
});
it("retains an actual research_source verify_report result without a Plan", async () => {
  vi.stubGlobal("fetch", () => {
    throw new Error("External requests forbidden");
  });
  const f = await fixture();
  try {
    const manager = new RunResearchSourceManager(
      { capturePage: async () => capture() },
      f.options.workspaceRoot,
      undefined,
      undefined,
      undefined,
      f.store,
    );
    const tool = createResearchSourceTool(manager, f.owner);
    const captured = await tool.execute("capture-local", { action: "capture" });
    const claim = "Local research fixture";
    const cited = await tool.execute("cite-local", {
      action: "cite",
      sourceId: captured.details.sourceId!,
      sourceContentSha256: captured.details.sourceContentSha256!,
      startLine: 1,
      endLine: 1,
      claim,
    });
    const report = `${claim} [citation:${cited.details.citationId!}]\n`;
    await writeWorkspaceOutputFile(
      f.options.workspaceRoot,
      "brief.md",
      Readable.from([Buffer.from(report)]),
      { scope: "Research fixture", action: "write", maximumBytes: 4096 },
    );
    const verified = await tool.execute("verify-local", {
      action: "verify_report",
      path: "brief.md",
      expectedSha256: sha256(report),
    });
    expect(verified.details.reportFileSha256).toBe(sha256(report));
    expect(verified.details.reportArtifactRegistration).toBe("registered");
    await observe(f, "brief.md");
  } finally {
    f.store.close();
    vi.unstubAllGlobals();
  }
});

it("retains distinct research tool invocation versions A to B to A and deduplicates an older call retry", async () => {
  vi.stubGlobal("fetch", () => {
    throw new Error("External requests forbidden");
  });
  const f = await fixture();
  try {
    const manager = new RunResearchSourceManager(
      { capturePage: async () => capture() },
      f.options.workspaceRoot,
      undefined,
      undefined,
      undefined,
      f.store,
    );
    const tool = createResearchSourceTool(manager, f.owner);
    const captured = await tool.execute("capture-aba", { action: "capture" });
    const claim = "Local research fixture";
    const cited = await tool.execute("cite-aba", {
      action: "cite",
      sourceId: captured.details.sourceId!,
      sourceContentSha256: captured.details.sourceContentSha256!,
      startLine: 1,
      endLine: 1,
      claim,
    });
    const report = `${claim} [citation:${cited.details.citationId!}]\n`;
    for (const [callId, text] of [
      ["verify-a1", report],
      ["verify-b", `# Revised\n${report}`],
      ["verify-a2", report],
    ] as const) {
      await writeFile(path.join(f.options.workspaceRoot, "brief.md"), text);
      const result = await tool.execute(callId, {
        action: "verify_report",
        path: "brief.md",
        expectedSha256: sha256(text),
      });
      expect(result.details.reportArtifactRegistration).toBe("registered");
    }
    const receipts = (await f.store.listEvents(f.thread.id)).filter(
      (event) => event.type === "artifact.tool_file_verified",
    );
    expect(receipts).toHaveLength(3);
    expect(
      receipts.map(
        (event) => (event.payload as Record<string, unknown>).operationId,
      ),
    ).toEqual(["verify-a1", "verify-b", "verify-a2"]);
    expect(
      (
        await tool.execute("verify-a1", {
          action: "verify_report",
          path: "brief.md",
          expectedSha256: sha256(report),
        })
      ).details.reportArtifactRegistration,
    ).toBe("registered");
    expect(
      (await f.store.listEvents(f.thread.id)).filter(
        (event) => event.type === "artifact.tool_file_verified",
      ),
    ).toHaveLength(3);
    const view = (await f.store.getDetail(f.thread.id)).taskNarrative!;
    expect(view.deliverables![0]).toMatchObject({
      sourceEventId: receipts[2]!.id,
      accessibility: "available",
      verification: "integrity_observed",
      toolFile: { operationId: "verify-a2", materialization: "observed" },
    });
    await observe(f, "brief.md");
  } finally {
    f.store.close();
    vi.unstubAllGlobals();
  }
});
