import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  ExtensionPublisherTrustAnchor,
  PromptPackageQualification,
  PromptPackageVerification,
  SignedPromptPackageEnvelope,
} from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  createApp,
  createServices as createNapierServices,
} from "../src/app.js";

const SIGNING_ENV = "NAPIER_TEST_SERVER_PROMPT_PACKAGE_KEY";
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
  const root = await mkdtemp(path.join(tmpdir(), "napier-server-promptpkg-"));
  temporaryRoots.push(root);
  const services = await createNapierServices({
    dataRoot: path.join(root, "data"),
    workspaceRoot: path.join(root, "workspace"),
  });
  openServices.push(services);
  return { services, app: createApp(services) };
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

function expectPromptPackageVerificationHeaders(
  response: Response,
  verification: PromptPackageVerification,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    responseSha256(verification),
  );
  expect(response.headers.get("x-napier-prompt-package-status")).toBe(
    verification.status,
  );
  expect(response.headers.get("x-napier-manifest-sha256")).toBe(
    verification.manifestSha256 ?? null,
  );
  expect(response.headers.get("x-napier-prompt-package-envelope-sha256")).toBe(
    verification.envelopeSha256 ?? null,
  );
  expect(response.headers.get("x-napier-signature-key-id")).toBe(
    verification.keyId ?? null,
  );
}

function expectPromptPackageQualificationHeaders(
  response: Response,
  qualification: PromptPackageQualification,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    responseSha256(qualification),
  );
  expect(response.headers.get("x-napier-prompt-package-status")).toBe(
    qualification.status,
  );
  expect(
    response.headers.get("x-napier-prompt-package-verification-status"),
  ).toBe(qualification.verificationStatus);
  expect(response.headers.get("x-napier-manifest-sha256")).toBe(
    qualification.manifestSha256 ?? null,
  );
  expect(response.headers.get("x-napier-prompt-package-envelope-sha256")).toBe(
    qualification.envelopeSha256 ?? null,
  );
  expect(response.headers.get("x-napier-system-prompt-sha256")).toBe(
    qualification.systemPromptSha256 ?? null,
  );
  expect(response.headers.get("x-napier-observed-system-prompt-sha256")).toBe(
    qualification.observedSystemPromptSha256 ?? null,
  );
  expect(response.headers.get("x-napier-agent-id")).toBe(
    qualification.sourceAgentId ?? null,
  );
  expect(response.headers.get("x-napier-observed-agent-id")).toBe(
    qualification.observedAgentId ?? null,
  );
  expect(response.headers.get("x-napier-observed-agent-revision")).toBe(
    qualification.observedAgentRevision === undefined
      ? null
      : String(qualification.observedAgentRevision),
  );
  expect(response.headers.get("x-napier-signature-key-id")).toBe(
    qualification.keyId ?? null,
  );
}

describe("signed Prompt package API", () => {
  it("signs, verifies, and qualifies hash-only Agent prompt provenance", async () => {
    installSigningKey();
    const { services, app } = await createFixture();
    const thread = services.store.listThreads()[0]!;
    const agent = services.store.listAgents()[0]!;
    const privatePrompt = agent.systemPrompt;

    const anchorResponse = await app.request(
      "/api/extensions/publishers",
      jsonRequest({
        threadId: thread.id,
        label: "Prompt package signer",
        source: { type: "environment", variable: SIGNING_ENV },
      }),
    );
    expect(anchorResponse.status).toBe(201);
    const anchor =
      (await anchorResponse.json()) as ExtensionPublisherTrustAnchor;

    const signResponse = await app.request(
      "/api/prompts/packages/sign",
      jsonRequest({
        threadId: thread.id,
        trustAnchorId: anchor.id,
        publisher: "Napier Prompt Registry",
        agentId: agent.id,
      }),
    );
    expect(signResponse.status).toBe(200);
    const envelope = (await signResponse.json()) as SignedPromptPackageEnvelope;
    expect(signResponse.headers.get("cache-control")).toBe("no-store");
    expect(signResponse.headers.get("x-napier-content-sha256")).toBe(
      envelope.contentSha256,
    );
    expect(signResponse.headers.get("x-napier-manifest-sha256")).toBe(
      envelope.manifest.contentSha256,
    );
    expect(signResponse.headers.get("x-napier-system-prompt-sha256")).toBe(
      envelope.manifest.systemPromptSha256,
    );
    expect(signResponse.headers.get("x-napier-agent-revision")).toBe(
      String(agent.revision),
    );
    expect(JSON.stringify(envelope)).not.toContain(privatePrompt);

    const verifyResponse = await app.request(
      "/api/prompts/packages/verify",
      jsonRequest({ envelope }),
    );
    expect(verifyResponse.status).toBe(200);
    const verification =
      (await verifyResponse.json()) as PromptPackageVerification;
    expectPromptPackageVerificationHeaders(verifyResponse, verification);
    expect(verification).toEqual(
      expect.objectContaining({
        status: "trusted",
        manifestSha256: envelope.manifest.contentSha256,
        envelopeSha256: envelope.contentSha256,
        keyId: anchor.keyId,
      }),
    );

    const qualifyResponse = await app.request(
      "/api/prompts/packages/qualify",
      jsonRequest({ threadId: thread.id, envelope }),
    );
    expect(qualifyResponse.status).toBe(200);
    const qualification =
      (await qualifyResponse.json()) as PromptPackageQualification;
    expectPromptPackageQualificationHeaders(qualifyResponse, qualification);
    expect(qualification).toEqual(
      expect.objectContaining({
        status: "qualified",
        verificationStatus: "trusted",
        manifestSha256: envelope.manifest.contentSha256,
        envelopeSha256: envelope.contentSha256,
        systemPromptSha256: envelope.manifest.systemPromptSha256,
        observedSystemPromptSha256: envelope.manifest.systemPromptSha256,
        sourceAgentId: agent.id,
        observedAgentId: agent.id,
        observedAgentRevision: agent.revision,
        keyId: anchor.keyId,
      }),
    );

    await services.store.updateAgent(agent.id, {
      systemPrompt: "Changed server prompt for qualification drift.",
    });
    const driftResponse = await app.request(
      "/api/prompts/packages/qualify",
      jsonRequest({ threadId: thread.id, envelope }),
    );
    expect(driftResponse.status).toBe(200);
    const drift = (await driftResponse.json()) as PromptPackageQualification;
    expectPromptPackageQualificationHeaders(driftResponse, drift);
    expect(drift).toEqual(
      expect.objectContaining({
        status: "prompt_drift",
        verificationStatus: "trusted",
        systemPromptSha256: envelope.manifest.systemPromptSha256,
        observedSystemPromptSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        observedAgentId: agent.id,
        observedAgentRevision: agent.revision + 1,
      }),
    );

    const events = await services.store.listEvents(thread.id);
    const signedEvent = events.find(
      (event) => event.type === "prompt.package.signed",
    );
    expect(signedEvent?.payload).toEqual(
      expect.objectContaining({
        manifestSha256: envelope.manifest.contentSha256,
        envelopeSha256: envelope.contentSha256,
        systemPromptSha256: envelope.manifest.systemPromptSha256,
        agentId: agent.id,
        agentRevision: agent.revision,
        keyId: anchor.keyId,
      }),
    );
    expect(JSON.stringify(signedEvent?.payload)).not.toContain(privatePrompt);
    const qualifiedEvents = events.filter(
      (event) => event.type === "prompt.package.qualified",
    );
    expect(qualifiedEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            status: "qualified",
            verificationStatus: "trusted",
            manifestSha256: envelope.manifest.contentSha256,
            envelopeSha256: envelope.contentSha256,
            systemPromptSha256: envelope.manifest.systemPromptSha256,
            observedSystemPromptSha256: envelope.manifest.systemPromptSha256,
            observedAgentId: agent.id,
            observedAgentRevision: agent.revision,
          }),
        }),
        expect.objectContaining({
          payload: expect.objectContaining({
            status: "prompt_drift",
            verificationStatus: "trusted",
            manifestSha256: envelope.manifest.contentSha256,
            envelopeSha256: envelope.contentSha256,
            systemPromptSha256: envelope.manifest.systemPromptSha256,
            observedAgentId: agent.id,
            observedAgentRevision: agent.revision + 1,
          }),
        }),
      ]),
    );
    expect(
      JSON.stringify(qualifiedEvents.map((event) => event.payload)),
    ).not.toContain(privatePrompt);
  });
});
