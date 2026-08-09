import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { agentCapabilityPresetUpdate } from "@napier/contracts/agent-capabilities";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sha256 } from "../src/ed25519.js";
import { createLocalAgentRuntime } from "../src/local-agent-runtime.js";
import type { PublicHttpResponse } from "../src/public-http-client.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Agent Web Fetch raw Source delivery", () => {
  it("exposes save only to writable presets and verifies exact PDF bytes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-agent-fetch-save-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    await mkdir(path.join(workspaceRoot, "artifacts"));
    for (const name of ["research-brief", "data-analysis"]) {
      const directory = path.join(workspaceRoot, "skills", name);
      await mkdir(directory, { recursive: true });
      await writeFile(
        path.join(directory, "SKILL.md"),
        `---\nname: ${name}\ndescription: ${name} fixture.\n---\n\n# ${name}\n`,
      );
    }
    const sourceUrl = "https://example.com/report.pdf";
    const pdfBody = minimalPdf("Agent raw PDF delivery.");
    const request = vi.fn(
      async (): Promise<PublicHttpResponse> => ({
        status: 200,
        headers: { "content-type": "application/pdf" },
        body: pdfBody,
        finalUrl: sourceUrl,
        redirectCount: 0,
      }),
    );
    const services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot: path.join(root, "state"),
      env: {},
      webFetchHttp: { request },
    });
    try {
      const originalAgent = services.store.listAgents()[0]!;
      expect(
        agentCapabilityPresetUpdate("research").enabledTools,
      ).not.toContain("web_fetch_save");
      expect(
        agentCapabilityPresetUpdate("safe_automation").enabledTools,
      ).toContain("web_fetch_save");
      const agent = await services.store.updateAgent(originalAgent.id, {
        toolPolicy: "workspace",
        enabledTools: ["web_fetch_save", "research_source"],
        enabledSkills: [],
        enabledSubagents: [],
      });
      const researchThread = await services.store.createThread({
        title: "Read-only raw save denial",
        agentId: agent.id,
      });
      const researchProvider = fauxProvider({
        provider: "faux-web-fetch-save-readonly",
      });
      researchProvider.setResponses([
        (context) => {
          expect(context.tools.map((tool) => tool.name)).not.toContain(
            "web_fetch_save",
          );
          return fauxAssistantMessage("RAW_SAVE_UNAVAILABLE");
        },
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      services.models.registerProvider(researchProvider.provider);
      await expect(
        services.runtime.runPrompt({
          threadId: researchThread.id,
          text: "Try to save a raw PDF.",
          model: { provider: "faux-web-fetch-save-readonly", id: "faux-1" },
          capabilityPreset: "research",
        }),
      ).resolves.toEqual(
        expect.objectContaining({
          status: "completed",
        }),
      );
      const thread = await services.store.createThread({
        title: "Raw PDF delivery",
        agentId: agent.id,
      });
      let planId = "";
      let savedSourceId = "";
      let savedSourceContentSha256 = "";
      let capturedSourceId = "";
      let capturedSourceContentSha256 = "";
      let capturedClaimLine = 0;
      const provider = fauxProvider({ provider: "faux-web-fetch-save" });
      provider.setResponses([
        fauxAssistantMessage(
          fauxToolCall("create_plan", {
            objective: "Save one declared public PDF.",
            steps: [
              {
                id: "save-pdf",
                title: "Save PDF",
                description: "Fetch and save the declared PDF.",
                verification: "The exact raw file Artifact is verified.",
              },
            ],
            artifacts: [
              {
                id: "pdf-file",
                path: "artifacts/report.pdf",
                kind: "file",
                description: "The raw public PDF.",
              },
            ],
          }),
          { stopReason: "toolUse" },
        ),
        (context) => {
          planId =
            /"planId":"(plan_[a-z0-9_]+)"/u.exec(
              JSON.stringify(context.messages),
            )?.[1] ?? "";
          return fauxAssistantMessage(
            fauxToolCall("update_plan_step", {
              planId,
              stepId: "save-pdf",
              action: "start",
            }),
            { stopReason: "toolUse" },
          );
        },
        fauxAssistantMessage(
          fauxToolCall("web_fetch_save", {
            url: sourceUrl,
            path: "artifacts/report.pdf",
          }),
          { stopReason: "toolUse" },
        ),
        (context) => {
          const messages = JSON.stringify(context.messages);
          savedSourceId =
            /Web Source: (websource_[a-z0-9]+)/u.exec(messages)?.[1] ?? "";
          savedSourceContentSha256 =
            /Content SHA-256: ([a-f0-9]{64})/u.exec(messages)?.[1] ?? "";
          return fauxAssistantMessage(
            fauxToolCall("research_source", {
              action: "capture_fetch",
              webSourceId: savedSourceId,
              webSourceContentSha256: savedSourceContentSha256,
              maxChars: 12_000,
            }),
            { stopReason: "toolUse" },
          );
        },
        (context) => {
          const messages = JSON.stringify(context.messages);
          capturedSourceId =
            /Research Source: (source_[a-z0-9]+)/u.exec(messages)?.[1] ?? "";
          capturedSourceContentSha256 =
            /Capture SHA-256: ([a-f0-9]{64})/u.exec(messages)?.[1] ?? "";
          capturedClaimLine = Number(
            /(\d+) \| Agent raw PDF delivery\./u.exec(messages)?.[1] ?? 0,
          );
          return fauxAssistantMessage(
            fauxToolCall("research_source", {
              action: "cite",
              sourceId: capturedSourceId,
              sourceContentSha256: capturedSourceContentSha256,
              startLine: capturedClaimLine,
              endLine: capturedClaimLine,
              claim: "Agent raw PDF delivery.",
            }),
            { stopReason: "toolUse" },
          );
        },
        () => {
          return fauxAssistantMessage("RAW_PDF_DELIVERED");
        },
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      services.models.registerProvider(provider.provider);

      const run = await services.runtime.runPrompt({
        threadId: thread.id,
        text: "Save the declared raw PDF.",
        model: { provider: "faux-web-fetch-save", id: "faux-1" },
      });

      const events = await services.store.listEvents(thread.id);
      const toolSummary = events
        .filter(
          (event) =>
            event.type === "tool.completed" ||
            event.type === "tool.failed" ||
            event.type === "tool.blocked",
        )
        .map((event) => ({
          type: event.type,
          tool: record(event.payload)?.["toolName"],
          action: record(record(event.payload)?.["details"])?.["action"],
        }));
      expect(
        run.status,
        `${run.error ?? "unknown error"}; tools=${JSON.stringify(toolSummary)}`,
      ).toBe("completed");
      expect(request).toHaveBeenCalledTimes(1);
      expect(savedSourceId).toMatch(/^websource_/u);
      expect(savedSourceContentSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(capturedSourceId).toMatch(/^source_/u);
      expect(capturedSourceContentSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(capturedClaimLine).toBeGreaterThan(0);
      await expect(
        readFile(path.join(workspaceRoot, "artifacts/report.pdf")),
      ).resolves.toEqual(pdfBody);
      const plan = services.store.getPlan(planId);
      expect(plan.status).toBe("active");
      expect(plan.steps[0]?.status).toBe("running");
      expect(plan.artifacts[0]).toEqual(
        expect.objectContaining({
          status: "verified",
          sourceRunId: run.id,
          sha256: sha256(pdfBody),
          sizeBytes: pdfBody.byteLength,
        }),
      );
      const saveStart = events.find(
        (event) =>
          event.type === "tool.started" &&
          record(event.payload)?.["toolName"] === "web_fetch_save",
      );
      expect(saveStart?.payload).toEqual(
        expect.objectContaining({
          effect: "write",
          inputRedacted: true,
        }),
      );
      expect(
        events
          .filter((event) => event.type.startsWith("plan.artifact."))
          .map((event) => event.type),
      ).toEqual(["plan.artifact.produced", "plan.artifact.verified"]);
      expect(
        events
          .filter(
            (event) =>
              event.type === "tool.completed" &&
              ["web_fetch_save", "research_source"].includes(
                String(record(event.payload)?.["toolName"]),
              ),
          )
          .map((event) => ({
            tool: record(event.payload)?.["toolName"],
            action: record(record(event.payload)?.["details"])?.["action"],
          })),
      ).toEqual([
        { tool: "web_fetch_save", action: undefined },
        { tool: "research_source", action: "capture_fetch" },
        { tool: "research_source", action: "cite" },
      ]);
      const durable = JSON.stringify(events);
      expect(durable).not.toContain(sourceUrl);
      expect(durable).not.toContain("Agent raw PDF delivery.");
    } finally {
      await services.shutdown();
    }
  });
});

function minimalPdf(text: string): Buffer {
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
  return Buffer.from(output);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
