import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  BootstrapResponse,
  ExtensionPublisherTrustAnchor,
  InstallSkillPackageResult,
  SignedSkillPackageEnvelope,
  SkillPackageInstallation,
  SkillPackageQualification,
  SkillPackageVerification,
} from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  createApp,
  createServices as createNapierServices,
} from "../src/app.js";

const SIGNING_ENV = "NAPIER_TEST_SERVER_SKILL_PACKAGE_KEY";
const temporaryRoots: string[] = [];
const openServices: Awaited<ReturnType<typeof createNapierServices>>[] = [];

afterEach(async () => {
  delete process.env[SIGNING_ENV];
  for (const services of openServices.splice(0)) {
    await services.recovery.stop();
    await services.automation.stop();
    await services.channels.stop();
    await services.extensions.shutdown();
    services.store.close();
  }
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

function jsonRequest(value: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  };
}

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-server-skillpkg-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(path.join(workspaceRoot, "skills/server-skill"), {
    recursive: true,
  });
  await writeFile(
    path.join(workspaceRoot, "skills/server-skill/SKILL.md"),
    [
      "---",
      "name: server-skill",
      "description: Use this Skill through the signed server package API.",
      "---",
      "",
      "# Server Skill",
      "",
      "Do not leak this server Skill instruction into package evidence.",
      "",
    ].join("\n"),
    "utf8",
  );
  const services = await createNapierServices({
    dataRoot: path.join(root, "data"),
    workspaceRoot,
  });
  openServices.push(services);
  return { services, app: createApp(services), workspaceRoot };
}

function installSigningKey(): void {
  const { privateKey } = generateKeyPairSync("ed25519");
  process.env[SIGNING_ENV] = privateKey
    .export({ format: "pem", type: "pkcs8" })
    .toString();
}

function responseSha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function expectSkillPackageVerificationHeaders(
  response: Response,
  verification: SkillPackageVerification,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    responseSha256(verification),
  );
  expect(response.headers.get("x-napier-skill-package-status")).toBe(
    verification.status,
  );
  expect(response.headers.get("x-napier-skill-count")).toBe(
    String(verification.skillCount),
  );
  expect(response.headers.get("x-napier-manifest-sha256")).toBe(
    verification.manifestSha256 ?? null,
  );
  expect(response.headers.get("x-napier-skill-package-envelope-sha256")).toBe(
    verification.envelopeSha256 ?? null,
  );
  expect(response.headers.get("x-napier-signature-key-id")).toBe(
    verification.keyId ?? null,
  );
}

function expectSkillPackageQualificationHeaders(
  response: Response,
  qualification: SkillPackageQualification,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    responseSha256(qualification),
  );
  expect(response.headers.get("x-napier-skill-package-status")).toBe(
    qualification.status,
  );
  expect(
    response.headers.get("x-napier-skill-package-verification-status"),
  ).toBe(qualification.verificationStatus);
  expect(response.headers.get("x-napier-skill-count")).toBe(
    String(qualification.skillCount),
  );
  expect(response.headers.get("x-napier-manifest-sha256")).toBe(
    qualification.manifestSha256 ?? null,
  );
  expect(response.headers.get("x-napier-skill-package-envelope-sha256")).toBe(
    qualification.envelopeSha256 ?? null,
  );
  expect(response.headers.get("x-napier-skill-catalog-sha256")).toBe(
    qualification.skillCatalogSha256 ?? null,
  );
  expect(response.headers.get("x-napier-observed-skill-catalog-sha256")).toBe(
    qualification.observedSkillCatalogSha256 ?? null,
  );
  expect(response.headers.get("x-napier-signature-key-id")).toBe(
    qualification.keyId ?? null,
  );
}

function expectSkillPackageInstallationResultHeaders(
  response: Response,
  result: InstallSkillPackageResult,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    responseSha256(result),
  );
  expect(response.headers.get("x-napier-skill-package-installation-id")).toBe(
    result.installation.id,
  );
  expect(
    response.headers.get("x-napier-skill-package-installation-status"),
  ).toBe(result.installation.status);
  expect(
    response.headers.get("x-napier-skill-package-installation-created"),
  ).toBe(String(result.created));
  expect(response.headers.get("x-napier-skill-package-status")).toBe(
    result.qualification.status,
  );
  expect(
    response.headers.get("x-napier-skill-package-verification-status"),
  ).toBe(result.qualification.verificationStatus);
  expect(response.headers.get("x-napier-skill-count")).toBe(
    String(result.installation.loadedSkillNames.length),
  );
  expect(response.headers.get("x-napier-skill-catalog-sha256")).toBe(
    result.installation.skillCatalogSha256,
  );
  expect(response.headers.get("x-napier-manifest-sha256")).toBe(
    result.installation.manifestSha256,
  );
  expect(response.headers.get("x-napier-skill-package-envelope-sha256")).toBe(
    result.installation.envelopeSha256,
  );
  expect(response.headers.get("x-napier-skill-names-sha256")).toBe(
    result.installation.skillNamesSha256,
  );
  expect(response.headers.get("x-napier-signature-key-id")).toBe(
    result.installation.keyId,
  );
  expect(
    response.headers.get("x-napier-skill-package-replaced-installation-id"),
  ).toBe(result.replacedInstallation?.id ?? null);
}

function expectSkillPackageInstallationListHeaders(
  response: Response,
  installations: SkillPackageInstallation[],
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    responseSha256(installations),
  );
  expect(
    response.headers.get("x-napier-skill-package-installation-count"),
  ).toBe(String(installations.length));
  expect(
    response.headers.get("x-napier-skill-package-active-installation-count"),
  ).toBe(
    String(
      installations.filter((installation) => installation.status === "active")
        .length,
    ),
  );
  expect(
    response.headers.get("x-napier-skill-package-replaced-installation-count"),
  ).toBe(
    String(
      installations.filter((installation) => installation.status === "replaced")
        .length,
    ),
  );
  expect(response.headers.get("x-napier-skill-count")).toBe(
    String(
      installations.reduce(
        (total, installation) => total + installation.loadedSkillNames.length,
        0,
      ),
    ),
  );
}

describe("signed Skill package API", () => {
  it("signs and verifies a hash-only Skill catalog package", async () => {
    installSigningKey();
    const { services, app } = await createFixture();
    const thread = services.store.listThreads()[0]!;

    const invalidAnchorResponse = await app.request(
      "/api/extensions/publishers",
      jsonRequest({
        threadId: thread.id,
        label: "Skill package signer",
        source: { type: "environment", variable: SIGNING_ENV },
        unexpected: true,
      }),
    );
    expect(invalidAnchorResponse.status).toBe(400);
    expect(await invalidAnchorResponse.json()).toEqual(
      expect.objectContaining({
        error: "Extension publisher trust anchor is invalid",
      }),
    );
    expect(services.store.listExtensionPublisherTrustAnchors()).toHaveLength(0);

    const anchorResponse = await app.request(
      "/api/extensions/publishers",
      jsonRequest({
        threadId: thread.id,
        label: "Skill package signer",
        source: { type: "environment", variable: SIGNING_ENV },
      }),
    );
    expect(anchorResponse.status).toBe(201);
    const anchor =
      (await anchorResponse.json()) as ExtensionPublisherTrustAnchor;

    const invalidSignResponse = await app.request(
      "/api/skills/packages/sign",
      jsonRequest({
        threadId: thread.id,
        trustAnchorId: anchor.id,
        publisher: "Napier Skill Registry",
        skillNames: ["server-skill"],
        unexpected: true,
      }),
    );
    expect(invalidSignResponse.status).toBe(400);
    expect(await invalidSignResponse.json()).toEqual(
      expect.objectContaining({
        error: "Skill package signing request is invalid",
      }),
    );
    expect(
      (await services.store.listEvents(thread.id)).filter(
        (event) => event.type === "skill.package.signed",
      ),
    ).toHaveLength(0);

    const signResponse = await app.request(
      "/api/skills/packages/sign",
      jsonRequest({
        threadId: thread.id,
        trustAnchorId: anchor.id,
        publisher: "Napier Skill Registry",
        skillNames: ["server-skill"],
      }),
    );
    expect(signResponse.status).toBe(200);
    const envelope = (await signResponse.json()) as SignedSkillPackageEnvelope;
    expect(signResponse.headers.get("cache-control")).toBe("no-store");
    expect(signResponse.headers.get("x-napier-content-sha256")).toBe(
      envelope.contentSha256,
    );
    expect(signResponse.headers.get("x-napier-manifest-sha256")).toBe(
      envelope.manifest.contentSha256,
    );
    expect(signResponse.headers.get("x-napier-skill-catalog-sha256")).toBe(
      envelope.manifest.skillCatalogSha256,
    );
    expect(signResponse.headers.get("x-napier-skill-count")).toBe("1");
    expect(JSON.stringify(envelope)).not.toContain(
      "Do not leak this server Skill instruction",
    );

    const verifyResponse = await app.request(
      "/api/skills/packages/verify",
      jsonRequest({ envelope }),
    );
    expect(verifyResponse.status).toBe(200);
    const verification =
      (await verifyResponse.json()) as SkillPackageVerification;
    expectSkillPackageVerificationHeaders(verifyResponse, verification);
    expect(verification).toEqual(
      expect.objectContaining({
        status: "trusted",
        skillCount: 1,
        manifestSha256: envelope.manifest.contentSha256,
        envelopeSha256: envelope.contentSha256,
        keyId: anchor.keyId,
      }),
    );
    const qualifyResponse = await app.request(
      "/api/skills/packages/qualify",
      jsonRequest({ threadId: thread.id, envelope }),
    );
    expect(qualifyResponse.status).toBe(200);
    const qualification =
      (await qualifyResponse.json()) as SkillPackageQualification;
    expectSkillPackageQualificationHeaders(qualifyResponse, qualification);
    expect(qualification).toEqual(
      expect.objectContaining({
        status: "qualified",
        verificationStatus: "trusted",
        skillCount: 1,
        manifestSha256: envelope.manifest.contentSha256,
        envelopeSha256: envelope.contentSha256,
        skillCatalogSha256: envelope.manifest.skillCatalogSha256,
        observedSkillCatalogSha256: envelope.manifest.skillCatalogSha256,
        keyId: anchor.keyId,
      }),
    );
    const installResponse = await app.request(
      "/api/skills/packages/installations",
      jsonRequest({ threadId: thread.id, envelope }),
    );
    expect(installResponse.status).toBe(200);
    const installResult =
      (await installResponse.json()) as InstallSkillPackageResult;
    expectSkillPackageInstallationResultHeaders(installResponse, installResult);
    expect(installResult).toEqual(
      expect.objectContaining({
        created: true,
        installation: expect.objectContaining({
          status: "active",
          publisher: "Napier Skill Registry",
          skillCatalogSha256: envelope.manifest.skillCatalogSha256,
          manifestSha256: envelope.manifest.contentSha256,
          envelopeSha256: envelope.contentSha256,
          loadedSkillNames: ["server-skill"],
          skillNamesSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        qualification: expect.objectContaining({
          status: "qualified",
          verificationStatus: "trusted",
        }),
      }),
    );
    expect(JSON.stringify(installResult.installation)).not.toContain(
      "Do not leak this server Skill instruction",
    );
    const listResponse = await app.request(
      "/api/skills/packages/installations",
    );
    expect(listResponse.status).toBe(200);
    const installations =
      (await listResponse.json()) as SkillPackageInstallation[];
    expectSkillPackageInstallationListHeaders(listResponse, installations);
    expect(installations).toEqual([
      expect.objectContaining({
        id: installResult.installation.id,
        status: "active",
      }),
    ]);
    const bootstrap = (await (
      await app.request(`/api/bootstrap?thread=${thread.id}`)
    ).json()) as BootstrapResponse;
    expect(bootstrap.skillPackageInstallations).toEqual([
      expect.objectContaining({
        id: installResult.installation.id,
        skillCatalogSha256: envelope.manifest.skillCatalogSha256,
      }),
    ]);
    const events = await services.store.listEvents(thread.id);
    const signedEvent = events.find(
      (event) => event.type === "skill.package.signed",
    );
    expect(signedEvent?.payload).toEqual(
      expect.objectContaining({
        manifestSha256: envelope.manifest.contentSha256,
        envelopeSha256: envelope.contentSha256,
        skillCatalogSha256: envelope.manifest.skillCatalogSha256,
        skillCount: 1,
      }),
    );
    expect(JSON.stringify(signedEvent?.payload)).not.toContain(
      "Do not leak this server Skill instruction",
    );
    const qualifiedEvent = events.find(
      (event) => event.type === "skill.package.qualified",
    );
    expect(qualifiedEvent?.payload).toEqual(
      expect.objectContaining({
        status: "qualified",
        verificationStatus: "trusted",
        manifestSha256: envelope.manifest.contentSha256,
        envelopeSha256: envelope.contentSha256,
        skillCatalogSha256: envelope.manifest.skillCatalogSha256,
        observedSkillCatalogSha256: envelope.manifest.skillCatalogSha256,
        skillCount: 1,
      }),
    );
    expect(JSON.stringify(qualifiedEvent?.payload)).not.toContain(
      "Do not leak this server Skill instruction",
    );
    const installedEvent = events.find(
      (event) => event.type === "skill.package.installed",
    );
    expect(installedEvent?.payload).toEqual(
      expect.objectContaining({
        installationId: installResult.installation.id,
        status: "active",
        created: true,
        skillCatalogSha256: envelope.manifest.skillCatalogSha256,
        manifestSha256: envelope.manifest.contentSha256,
        envelopeSha256: envelope.contentSha256,
        skillNamesSha256: installResult.installation.skillNamesSha256,
        skillCount: 1,
      }),
    );
    expect(JSON.stringify(installedEvent?.payload)).not.toContain(
      "Do not leak this server Skill instruction",
    );
  });
});
