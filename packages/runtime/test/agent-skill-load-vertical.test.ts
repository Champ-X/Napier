import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  parseResearchSourceEvidenceV1,
  projectSkillApplicationV1,
} from "@napier/contracts/skill-load";
import { isSkillLifecycleProjectionV1 } from "@napier/contracts/skill-lifecycle";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createLocalAgentRuntime } from "../src/local-agent-runtime.js";
import type { PublicHttpResponse } from "../src/public-http-client.js";
import { RunWebFetchSourceManager } from "../src/web-fetch-sources.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Research Skill load vertical", () => {
  it("projects loaded through capture_fetch and cite to citation-adjacent applied", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-skill-vertical-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    for (const name of ["research-brief", "data-analysis"]) {
      const directory = path.join(workspaceRoot, "skills", name);
      await mkdir(directory, { recursive: true });
      await writeFile(
        path.join(directory, "SKILL.md"),
        `---\nname: ${name}\ndescription: ${name} fixture.\n---\n\n# ${name}\n\nUse bounded evidence.\n`,
      );
    }
    const webFetch = new RunWebFetchSourceManager({
      http: {
        request: vi.fn(
          async (): Promise<PublicHttpResponse> => ({
            status: 200,
            headers: { "content-type": "text/plain" },
            body: Buffer.from(
              "PRIVATE_SOURCE_BODY: Node.js v24.0.0 was released on May 6, 2025.",
            ),
            finalUrl: "https://nodejs.org/en/blog/release/v24.0.0",
            redirectCount: 0,
          }),
        ),
      },
    });
    const services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot: path.join(root, "state"),
      env: {},
      webFetch,
    });
    try {
      const agent = services.store.listAgents()[0]!;
      const thread = await services.store.createThread({
        title: "Research Skill vertical",
        agentId: agent.id,
      });
      const provider = fauxProvider({ provider: "faux-skill-vertical" });
      provider.setResponses([
        fauxAssistantMessage(
          fauxToolCall("skill_load", { name: "research-brief" }),
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage(
          fauxToolCall("web_fetch", {
            action: "fetch",
            url: "https://nodejs.org/en/blog/release/v24.0.0",
          }),
          { stopReason: "toolUse" },
        ),
        (context) => {
          const text = JSON.stringify(context.messages);
          const sourceId = /Web Source: (websource_[a-z0-9]+)/u.exec(text)?.[1];
          const contentSha256 = /Content SHA-256: ([a-f0-9]{64})/u.exec(
            text,
          )?.[1];
          return fauxAssistantMessage(
            fauxToolCall("research_source", {
              action: "capture_fetch",
              webSourceId: sourceId!,
              webSourceContentSha256: contentSha256!,
              maxChars: 12_000,
            }),
            { stopReason: "toolUse" },
          );
        },
        (context) => {
          const text = JSON.stringify(context.messages);
          const sourceId = /Research Source: (source_[a-z0-9]+)/u.exec(
            text,
          )?.[1];
          const contentSha256 = /Capture SHA-256: ([a-f0-9]{64})/u.exec(
            text,
          )?.[1];
          return fauxAssistantMessage(
            fauxToolCall("research_source", {
              action: "cite",
              sourceId: sourceId!,
              sourceContentSha256: contentSha256!,
              startLine: 1,
              endLine: 1,
              claim: "Node.js v24.0.0 was released on May 6, 2025.",
            }),
            { stopReason: "toolUse" },
          );
        },
        (context) => {
          const citation = /\[citation:citation_[a-z0-9]{8,80}\]/u.exec(
            JSON.stringify(context.messages),
          )?.[0];
          expect(citation).toBeTruthy();
          return fauxAssistantMessage(
            `Node.js v24.0.0 was released on May 6, 2025.\n${citation}`,
          );
        },
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      services.models.registerProvider(provider.provider);

      const run = await services.runtime.runPrompt({
        threadId: thread.id,
        text: "Use the Research Brief Skill and cite the official release.",
        model: { provider: "faux-skill-vertical", id: "faux-1" },
        capabilityPreset: "research",
      });
      expect(run.status, run.error).toBe("completed");
      const events = await services.store.listEvents(thread.id);
      const researchEvents = events.filter(
        (event) =>
          event.type === "tool.completed" &&
          record(event.payload)?.toolName === "research_source",
      );
      const researchEvidence = researchEvents.map((event) =>
        parseResearchSourceEvidenceV1(record(event.payload)?.details),
      );
      expect(researchEvidence.map((item) => item?.action)).toEqual([
        "capture_fetch",
        "cite",
      ]);
      expect(
        researchEvidence.map((item) => item?.continuityCapsuleContentSha256),
      ).toEqual([
        expect.stringMatching(/^[a-f0-9]{64}$/u),
        expect.stringMatching(/^[a-f0-9]{64}$/u),
      ]);
      expect(researchEvidence[0]?.sourceId).toBe(researchEvidence[1]?.sourceId);
      const finalAssistant = events.findLast(
        (event) => event.type === "message.assistant",
      );
      const finalText = String(record(finalAssistant?.payload)?.text ?? "");
      const citationLine = finalText.split("\n").at(-1)!;
      expect(createHash("sha256").update(citationLine).digest("hex")).toBe(
        researchEvidence[1]?.action === "cite"
          ? researchEvidence[1].citationTokenSha256
          : undefined,
      );
      const projection = projectSkillApplicationV1(events, run.id, {
        canonicalName: "research-brief",
      });
      expect(projection).toEqual(
        expect.objectContaining({
          state: "applied",
          skillName: "research-brief",
          applicationMode: "citation_adjacent",
        }),
      );
      expect(projection!.terminalSeq).toBeLessThan(projection!.captureSeq!);
      expect(projection!.captureSeq).toBeLessThan(projection!.citeSeq!);
      expect(projection!.citeSeq).toBeLessThan(projection!.applicationSeq!);
      const lifecycleEvent = events.find(
        (event) => event.runId === run.id && event.type === "skill.lifecycle",
      );
      expect(isSkillLifecycleProjectionV1(lifecycleEvent?.payload)).toBe(true);
      expect(lifecycleEvent?.payload).toEqual(
        expect.objectContaining({
          state: "applied",
          skillName: "research-brief",
          applicationMode: "research_evidence_cited",
          proofEventSeqs: researchEvents.map((event) => event.seq),
        }),
      );
      const durable = JSON.stringify(events);
      expect(durable).not.toContain("Use bounded evidence.");
      expect(durable).not.toContain("PRIVATE_SOURCE_BODY");
      expect(durable).not.toContain(workspaceRoot);
    } finally {
      await services.shutdown();
    }
  });
});

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
