import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { WorkspaceSummary } from "@napier/contracts";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";

import { registerSkillResourcePreviewHttp } from "../src/skill-resource-preview-http.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Skill resource preview endpoint", () => {
  it("serves the receipt-bound virtual resource and rejects hash drift", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "napier-skill-resource-preview-"),
    );
    temporaryRoots.push(workspaceRoot);
    const skillRoot = path.join(
      workspaceRoot,
      ".agents",
      "skills",
      "preview-skill",
    );
    await mkdir(path.join(skillRoot, "references"), { recursive: true });
    await writeFile(
      path.join(skillRoot, "SKILL.md"),
      [
        "---",
        "name: preview-skill",
        "description: Preview a bounded resource.",
        "---",
        "# Preview skill",
        "",
      ].join("\n"),
    );
    const contents = "# Gate\n\nInspect the rendered result.\n";
    await writeFile(path.join(skillRoot, "references", "gate.md"), contents);
    const sha256 = createHash("sha256").update(contents).digest("hex");
    const summary: WorkspaceSummary = {
      root: workspaceRoot,
      dataRoot: path.join(workspaceRoot, ".napier"),
      localFirst: true,
      isolation: "workspace",
    };
    const app = new Hono();
    registerSkillResourcePreviewHttp(app, {
      getWorkspaceSummary: () => summary,
    });
    const query = new URLSearchParams({
      name: "preview-skill",
      path: "references/gate.md",
      rootKind: "project_standard",
      sha256,
    });

    const response = await app.request(
      `/api/skills/resource?${query.toString()}`,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(contents);
    expect(response.headers.get("x-napier-content-sha256")).toBe(sha256);
    expect(response.headers.get("x-napier-skill-resource-virtual-path")).toBe(
      "/project/.agents/skills/preview-skill/references/gate.md",
    );

    query.set("sha256", "0".repeat(64));
    const drift = await app.request(`/api/skills/resource?${query.toString()}`);
    expect(drift.status).toBe(409);
  });
});
