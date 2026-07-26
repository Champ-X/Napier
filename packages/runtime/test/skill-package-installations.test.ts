import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LocalStore } from "../src/store.js";

const SIGNING_KEY_ENV = "NAPIER_TEST_SKILL_PACKAGE_INSTALL_KEY";
const temporaryRoots: string[] = [];

afterEach(async () => {
  delete process.env[SIGNING_KEY_ENV];
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

function installSigningKey(): void {
  const { privateKey } = generateKeyPairSync("ed25519");
  process.env[SIGNING_KEY_ENV] = privateKey
    .export({ format: "pem", type: "pkcs8" })
    .toString();
}

async function writeSkill(workspaceRoot: string, title: string): Promise<void> {
  await mkdir(path.join(workspaceRoot, "skills/install-skill"), {
    recursive: true,
  });
  await writeFile(
    path.join(workspaceRoot, "skills/install-skill/SKILL.md"),
    [
      "---",
      "name: install-skill",
      "description: Use this Skill to verify reviewed installation baselines.",
      "---",
      "",
      `# ${title}`,
      "",
      "Private Skill instructions stay in the workspace file.",
      "",
    ].join("\n"),
    "utf8",
  );
}

async function writeHelperSkill(workspaceRoot: string): Promise<void> {
  await mkdir(path.join(workspaceRoot, "skills/install-helper"), {
    recursive: true,
  });
  await writeFile(
    path.join(workspaceRoot, "skills/install-helper/SKILL.md"),
    [
      "---",
      "name: install-helper",
      "description: Helper Skill used to verify managed baseline replacement.",
      "---",
      "",
      "# Install Helper",
      "",
      "Private helper Skill instructions stay in the workspace file.",
      "",
    ].join("\n"),
    "utf8",
  );
}

describe("reviewed Skill package installations", () => {
  it("installs a qualified hash-only baseline and requires explicit replacement", async () => {
    installSigningKey();
    const root = await mkdtemp(path.join(tmpdir(), "napier-skill-install-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const options = {
      dataRoot: path.join(root, "data"),
      workspaceRoot,
    };
    await writeSkill(workspaceRoot, "Installed Skill V1");
    const store = new LocalStore(options);
    await store.initialize();
    const thread = store.listThreads()[0]!;
    const anchor = await store.createExtensionPublisherTrustAnchor({
      threadId: thread.id,
      label: "Skill installation signer",
      source: { type: "environment", variable: SIGNING_KEY_ENV },
    });

    const firstEnvelope = await store.signSkillPackage({
      threadId: thread.id,
      trustAnchorId: anchor.id,
      publisher: "Skill Registry",
      skillNames: ["install-skill"],
    });
    const first = await store.installSkillPackage({
      threadId: thread.id,
      envelope: firstEnvelope,
    });
    expect(first).toEqual(
      expect.objectContaining({
        created: true,
        installation: expect.objectContaining({
          status: "active",
          publisher: "Skill Registry",
          skillCatalogSha256: firstEnvelope.manifest.skillCatalogSha256,
          envelopeSha256: firstEnvelope.contentSha256,
          loadedSkillNames: ["install-skill"],
        }),
      }),
    );
    expect(JSON.stringify(first.installation)).not.toContain(
      "Private Skill instructions",
    );

    await expect(
      store.installSkillPackage({
        threadId: thread.id,
        envelope: firstEnvelope,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        created: false,
        installation: expect.objectContaining({
          id: first.installation.id,
        }),
      }),
    );

    await writeSkill(workspaceRoot, "Installed Skill V2");
    const secondEnvelope = await store.signSkillPackage({
      threadId: thread.id,
      trustAnchorId: anchor.id,
      publisher: "Skill Registry",
      skillNames: ["install-skill"],
    });
    await expect(
      store.installSkillPackage({
        threadId: thread.id,
        envelope: secondEnvelope,
      }),
    ).rejects.toThrow("replacement requires confirmation");

    const second = await store.installSkillPackage({
      threadId: thread.id,
      envelope: secondEnvelope,
      replaceInstallationId: first.installation.id,
      confirmReplacement: true,
    });
    expect(second).toEqual(
      expect.objectContaining({
        created: true,
        installation: expect.objectContaining({
          status: "active",
          replacesInstallationId: first.installation.id,
          skillCatalogSha256: secondEnvelope.manifest.skillCatalogSha256,
        }),
        replacedInstallation: expect.objectContaining({
          id: first.installation.id,
          status: "replaced",
          replacedByInstallationId: second.installation.id,
        }),
      }),
    );

    const listed = store.listSkillPackageInstallations();
    expect(listed).toHaveLength(2);
    expect(listed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: second.installation.id,
          status: "active",
        }),
        expect.objectContaining({
          id: first.installation.id,
          status: "replaced",
        }),
      ]),
    );

    const publisherEnvelope = await store.signSkillPackage({
      threadId: thread.id,
      trustAnchorId: anchor.id,
      publisher: "Other Skill Registry",
      skillNames: ["install-skill"],
    });
    await expect(
      store.installSkillPackage({
        threadId: thread.id,
        envelope: publisherEnvelope,
        replaceInstallationId: second.installation.id,
        confirmReplacement: true,
      }),
    ).rejects.toThrow("publisher change requires explicit confirmation");
    const publisherReplacement = await store.installSkillPackage({
      threadId: thread.id,
      envelope: publisherEnvelope,
      replaceInstallationId: second.installation.id,
      confirmReplacement: true,
      confirmPublisherChange: true,
    });
    expect(publisherReplacement.installation).toEqual(
      expect.objectContaining({
        publisher: "Other Skill Registry",
        replacesInstallationId: second.installation.id,
      }),
    );

    await writeHelperSkill(workspaceRoot);
    const skillSetEnvelope = await store.signSkillPackage({
      threadId: thread.id,
      trustAnchorId: anchor.id,
      publisher: "Other Skill Registry",
      skillNames: ["install-skill", "install-helper"],
    });
    await expect(
      store.installSkillPackage({
        threadId: thread.id,
        envelope: skillSetEnvelope,
        replaceInstallationId: publisherReplacement.installation.id,
        confirmReplacement: true,
      }),
    ).rejects.toThrow("Skill set change requires explicit confirmation");
    const skillSetReplacement = await store.installSkillPackage({
      threadId: thread.id,
      envelope: skillSetEnvelope,
      replaceInstallationId: publisherReplacement.installation.id,
      confirmReplacement: true,
      confirmSkillSetChange: true,
    });
    expect(skillSetReplacement.installation).toEqual(
      expect.objectContaining({
        loadedSkillNames: ["install-helper", "install-skill"],
        replacesInstallationId: publisherReplacement.installation.id,
      }),
    );
    const finalListed = store.listSkillPackageInstallations();
    store.close();

    const reopened = new LocalStore(options);
    await reopened.initialize();
    expect(reopened.listSkillPackageInstallations()).toEqual(finalListed);
    reopened.close();
  });
});
