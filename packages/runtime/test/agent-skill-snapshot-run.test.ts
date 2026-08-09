import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { isSkillCatalogBindingV1 } from "@napier/contracts/skill-load";
import { afterEach, describe, expect, it } from "vitest";

import {
  createLocalAgentRuntime,
  UnsupportedSandboxAdapter,
} from "../src/index.js";
import { buildProjectSkillSnapshot } from "../src/project-skill-snapshot.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-skill-run-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  for (const name of ["research-brief", "data-analysis"]) {
    const directory = path.join(workspaceRoot, "skills", name);
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "SKILL.md"),
      `---\nname: ${name}\ndescription: Use ${name} for bounded work.\n---\n# ${name}\n\nFollow this Skill.\n`,
    );
  }
  const services = await createLocalAgentRuntime({
    workspaceRoot,
    dataRoot: path.join(root, "state"),
    sandbox: new UnsupportedSandboxAdapter("skill-run-test"),
  });
  return { root, workspaceRoot, services };
}

describe("Run-bound project Skill snapshots", () => {
  it("binds one pre-lease snapshot into configuration/context and keeps using it after disk removal", async () => {
    const { workspaceRoot, services } = await fixture();
    try {
      const agentBefore = services.store.listAgents()[0]!;
      const revisionsBefore = services.store.listAgentRevisions(agentBefore.id);
      const thread = await services.store.createThread({
        title: "Frozen Skill handoff",
        agentId: agentBefore.id,
      });
      const run = await services.runtime.runPrompt({
        threadId: thread.id,
        text: "Use the immutable Research capability boundary.",
        capabilityPreset: "research",
        onRunCreated: async () => {
          await rm(path.join(workspaceRoot, "skills"), { recursive: true });
        },
      });

      expect(run.status, run.error).toBe("completed");
      expect(run.configuration?.enabledTools).toContain("skill_load");
      expect(run.configuration?.enabledSkills).toEqual([
        "data-analysis",
        "research-brief",
      ]);
      const contextEvent = (await services.store.listEvents(thread.id)).find(
        (event) => event.runId === run.id && event.type === "context.skills",
      );
      expect(isSkillCatalogBindingV1(contextEvent?.payload)).toBe(true);
      const context = contextEvent!.payload as unknown as {
        catalogSha256: string;
        availabilitySetSha256: string;
        snapshotManifestSha256: string;
        loadableSkillNames: string[];
      };
      expect(context.loadableSkillNames).toEqual([
        "data-analysis",
        "research-brief",
      ]);
      expect(run.configuration?.skillCatalogSha256).toBe(context.catalogSha256);
      expect(context.availabilitySetSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(context.snapshotManifestSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(JSON.stringify(contextEvent?.payload)).not.toContain(
        workspaceRoot,
      );
      expect(services.store.getAgent(agentBefore.id)).toEqual(agentBefore);
      expect(services.store.listAgentRevisions(agentBefore.id)).toEqual(
        revisionsBefore,
      );
    } finally {
      await services.shutdown();
    }
  });

  it("records cancellation when aborted before Skill snapshot construction", async () => {
    const { services } = await fixture();
    try {
      const agent = services.store.listAgents()[0]!;
      const thread = await services.store.createThread({
        title: "Cancelled snapshot",
        agentId: agent.id,
      });
      const controller = new AbortController();
      controller.abort(new DOMException("cancelled", "AbortError"));
      const run = await services.runtime.runPrompt({
        threadId: thread.id,
        text: "This Run must be cancelled before model execution.",
        capabilityPreset: "research",
        signal: controller.signal,
      });
      expect(run).toEqual(
        expect.objectContaining({
          status: "cancelled",
          error: expect.any(String),
        }),
      );
      expect(
        (await services.store.listEvents(thread.id)).some(
          (event) => event.type === "run.started",
        ),
      ).toBe(true);
      expect((await services.store.listEvents(thread.id)).at(-1)).toEqual(
        expect.objectContaining({ type: "run.cancelled" }),
      );
    } finally {
      await services.shutdown();
    }
  });

  it("uses the persisted default Skill loader without a run-scoped preset", async () => {
    const { services } = await fixture();
    try {
      const agent = services.store.listAgents()[0]!;
      const thread = await services.store.createThread({
        title: "Ordinary profile",
        agentId: agent.id,
      });
      const run = await services.runtime.runPrompt({
        threadId: thread.id,
        text: "Use only the stored Agent profile.",
      });
      expect(run.status, run.error).toBe("completed");
      expect(run.configuration?.enabledTools).toContain("skill_load");
      const context = (await services.store.listEvents(thread.id)).find(
        (event) => event.runId === run.id && event.type === "context.skills",
      )?.payload as Record<string, unknown>;
      expect(isSkillCatalogBindingV1(context)).toBe(true);
      expect(context).toEqual(
        expect.objectContaining({
          kind: "napier.skill-catalog-binding",
          loadableSkillNames: ["data-analysis", "research-brief"],
          catalogSha256: run.configuration?.skillCatalogSha256,
          snapshotManifestSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      );
      expect(services.store.getAgent(agent.id)).toEqual(agent);
    } finally {
      await services.shutdown();
    }
  });

  it("inherits the exact Research preset and snapshot through manual recovery", async () => {
    const { workspaceRoot, services } = await fixture();
    try {
      const agent = services.store.listAgents()[0]!;
      const before = structuredClone(agent);
      const thread = await services.store.createThread({
        title: "Research manual recovery",
        agentId: agent.id,
      });
      const snapshot = await buildProjectSkillSnapshot(workspaceRoot, [
        "research-brief",
        "data-analysis",
      ]);
      const interrupted = await services.store.createRun({
        threadId: thread.id,
        agentId: agent.id,
        capabilityPreset: "research",
        skillCatalogSha256: snapshot.manifest.catalogSha256,
      });
      await services.store.appendEvent({
        threadId: thread.id,
        runId: interrupted.id,
        type: "run.started",
        category: "lifecycle",
        visibility: "debug",
        payload: { capabilityPreset: "research" },
      });
      await services.store.appendEvent({
        threadId: thread.id,
        runId: interrupted.id,
        type: "context.skills",
        category: "system",
        visibility: "debug",
        payload: snapshot.binding,
      });
      await services.store.appendEvent({
        threadId: thread.id,
        runId: interrupted.id,
        type: "message.user",
        category: "message",
        visibility: "user",
        payload: { role: "user", text: "Continue bounded Research." },
      });
      await services.store.finishRun(interrupted.id, "interrupted");

      const recovered = await services.runtime.resumeInterruptedRun({
        threadId: thread.id,
        runId: interrupted.id,
      });
      expect(recovered.status, recovered.error).toBe("completed");
      expect(recovered.source).toBe("recovery");
      expect(recovered.parentRunId).toBe(interrupted.id);
      expect(recovered.configuration).toEqual(
        expect.objectContaining({
          enabledSkills: ["data-analysis", "research-brief"],
          enabledTools: expect.arrayContaining(["skill_load"]),
          skillCatalogSha256: snapshot.manifest.catalogSha256,
        }),
      );
      const events = (await services.store.listEvents(thread.id)).filter(
        (event) => event.runId === recovered.id,
      );
      expect(
        events.find((event) => event.type === "run.started")?.payload,
      ).toEqual(expect.objectContaining({ capabilityPreset: "research" }));
      expect(
        isSkillCatalogBindingV1(
          events.find((event) => event.type === "context.skills")?.payload,
        ),
      ).toBe(true);
      expect(services.store.getAgent(agent.id)).toEqual(before);
    } finally {
      await services.shutdown();
    }
  });

  it("recovers a persisted default Skill snapshot without a run-scoped preset", async () => {
    const { workspaceRoot, services } = await fixture();
    try {
      const agent = services.store.listAgents()[0]!;
      const before = structuredClone(agent);
      const thread = await services.store.createThread({
        title: "Default Skill manual recovery",
        agentId: agent.id,
      });
      const snapshot = await buildProjectSkillSnapshot(
        workspaceRoot,
        agent.enabledSkills,
      );
      const interrupted = await services.store.createRun({
        threadId: thread.id,
        agentId: agent.id,
        agentRevision: agent.revision,
        skillCatalogSha256: snapshot.manifest.catalogSha256,
      });
      await services.store.appendEvent({
        threadId: thread.id,
        runId: interrupted.id,
        type: "context.skills",
        category: "system",
        visibility: "debug",
        payload: snapshot.binding,
      });
      await services.store.appendEvent({
        threadId: thread.id,
        runId: interrupted.id,
        type: "message.user",
        category: "message",
        visibility: "user",
        payload: { role: "user", text: "Continue with the default profile." },
      });
      await services.store.finishRun(interrupted.id, "interrupted");

      const recovered = await services.runtime.resumeInterruptedRun({
        threadId: thread.id,
        runId: interrupted.id,
      });
      expect(recovered.status, recovered.error).toBe("completed");
      expect(recovered.source).toBe("recovery");
      expect(recovered.parentRunId).toBe(interrupted.id);
      expect(recovered.configuration).toEqual(
        expect.objectContaining({
          enabledTools: expect.arrayContaining(["skill_load"]),
          enabledSkills: [...agent.enabledSkills].sort(),
          skillCatalogSha256: snapshot.manifest.catalogSha256,
        }),
      );
      const events = (await services.store.listEvents(thread.id)).filter(
        (event) => event.runId === recovered.id,
      );
      expect(
        events.find((event) => event.type === "run.started")?.payload,
      ).not.toHaveProperty("capabilityPreset");
      expect(
        isSkillCatalogBindingV1(
          events.find((event) => event.type === "context.skills")?.payload,
        ),
      ).toBe(true);
      expect(services.store.getAgent(agent.id)).toEqual(before);
    } finally {
      await services.shutdown();
    }
  });
});
