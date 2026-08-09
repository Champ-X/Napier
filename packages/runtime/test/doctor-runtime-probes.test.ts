import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  probeSkillsRuntime,
  sandboxIsolationStrength,
} from "../src/doctor-runtime-probes.js";

describe("sandbox isolation strength", () => {
  it("reports container isolation with resource limits for OCI", () => {
    const strength = sandboxIsolationStrength("oci-container");
    expect(strength.level).toBe("container");
    expect(strength.networkDeniedByDefault).toBe(true);
    expect(strength.resourceLimited).toBe(true);
  });

  it("reports OS-profile isolation without resource ceilings on macOS", () => {
    const strength = sandboxIsolationStrength("macos-sandbox-exec");
    expect(strength.level).toBe("os_profile");
    expect(strength.networkDeniedByDefault).toBe(true);
    expect(strength.resourceLimited).toBe(false);
  });

  it("reports namespace isolation for bubblewrap", () => {
    expect(sandboxIsolationStrength("linux-bubblewrap").level).toBe(
      "namespace",
    );
  });

  it("reports no isolation for unsupported hosts", () => {
    const strength = sandboxIsolationStrength("unsupported");
    expect(strength.level).toBe("none");
    expect(strength.networkDeniedByDefault).toBe(false);
    expect(strength.summary).toContain("fail closed");
  });
});

describe("Skill loader Doctor probe", () => {
  it("executes the production loader and returns only sanitized evidence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-doctor-skill-"));
    const home = await mkdtemp(path.join(tmpdir(), "napier-doctor-home-"));
    try {
      const directory = path.join(root, "skills", "research-brief");
      await mkdir(directory, { recursive: true });
      await writeFile(
        path.join(directory, "SKILL.md"),
        "---\nname: research-brief\ndescription: Doctor fixture.\n---\n\nPRIVATE_DOCTOR_SKILL_BODY\n",
      );
      const result = await probeSkillsRuntime(root, { userHome: home });
      expect(result).toEqual(
        expect.objectContaining({
          status: "ready",
          code: "skills_ready",
          evidence: expect.objectContaining({
            present: 1,
            admitted: 1,
            productionCall: true,
            catalogSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          }),
        }),
      );
      expect(JSON.stringify(result)).not.toContain("PRIVATE_DOCTOR_SKILL_BODY");
      expect(JSON.stringify(result)).not.toContain(root);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("does not report ready when a present Skill fails production admission", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-doctor-skill-"));
    const home = await mkdtemp(path.join(tmpdir(), "napier-doctor-home-"));
    try {
      const directory = path.join(root, "skills", "bad-skill");
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "SKILL.md"), "not frontmatter\n");
      await expect(
        probeSkillsRuntime(root, { userHome: home }),
      ).resolves.toEqual(
        expect.objectContaining({
          status: "unavailable",
          code: "skills_unavailable",
          evidence: { present: 1, productionCall: false },
        }),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });
});
