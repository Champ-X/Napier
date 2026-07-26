import { generateKeyPairSync } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import {
  createExtensionPublisherTrustAnchor,
  revokeExtensionPublisherTrustAnchor,
} from "../src/extension-packages.js";
import {
  createInspectorCatalogFingerprint,
  hashInspectorCatalog,
  qualifyInspectorPackage,
  signInspectorPackage,
  verifySignedInspectorPackageEnvelope,
} from "../src/inspector-packages.js";

const SIGNING_KEY_ENV = "NAPIER_TEST_INSPECTOR_PACKAGE_KEY";

afterEach(() => {
  delete process.env[SIGNING_KEY_ENV];
});

function createAnchor() {
  const { privateKey } = generateKeyPairSync("ed25519");
  process.env[SIGNING_KEY_ENV] = privateKey
    .export({ format: "pem", type: "pkcs8" })
    .toString();
  return createExtensionPublisherTrustAnchor({
    threadId: "thread_inspectorpkg",
    label: "Inspector publisher",
    source: { type: "environment", variable: SIGNING_KEY_ENV },
  });
}

describe("signed Inspector packages", () => {
  it("signs Workbench Inspector catalog evidence and qualifies drift", () => {
    const anchor = createAnchor();

    const envelope = signInspectorPackage("Inspector Registry", anchor);

    expect(envelope).toEqual(
      expect.objectContaining({
        kind: "napier.signed-inspector-package",
        manifest: expect.objectContaining({
          kind: "napier.inspector-package-manifest",
          publisher: "Inspector Registry",
          defaultPanelId: "trace",
          inspectorCatalogSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          panels: expect.arrayContaining([
            expect.objectContaining({
              id: "trace",
              capabilities: expect.arrayContaining(["event-ledger"]),
            }),
            expect.objectContaining({
              id: "context",
              capabilities: expect.arrayContaining(["prompt-package"]),
            }),
          ]),
        }),
      }),
    );
    expect(verifySignedInspectorPackageEnvelope(envelope, [anchor])).toEqual(
      expect.objectContaining({
        status: "trusted",
        panelCount: envelope.manifest.panels.length,
        manifestSha256: envelope.manifest.contentSha256,
        envelopeSha256: envelope.contentSha256,
        keyId: anchor.keyId,
      }),
    );
    expect(verifySignedInspectorPackageEnvelope(envelope, [])).toEqual(
      expect.objectContaining({
        status: "unknown_key",
        panelCount: envelope.manifest.panels.length,
        keyId: anchor.keyId,
      }),
    );
    expect(
      verifySignedInspectorPackageEnvelope(envelope, [
        revokeExtensionPublisherTrustAnchor(anchor),
      ]),
    ).toEqual(
      expect.objectContaining({
        status: "revoked",
        keyId: anchor.keyId,
      }),
    );
    expect(qualifyInspectorPackage(envelope, [anchor])).toEqual(
      expect.objectContaining({
        status: "qualified",
        verificationStatus: "trusted",
        inspectorCatalogSha256: envelope.manifest.inspectorCatalogSha256,
        observedInspectorCatalogSha256:
          envelope.manifest.inspectorCatalogSha256,
      }),
    );

    const drifted = createInspectorCatalogFingerprint();
    drifted.panels[0] = {
      ...drifted.panels[0]!,
      capabilities: [...drifted.panels[0]!.capabilities, "debug-export"],
    };
    drifted.inspectorCatalogSha256 = hashInspectorCatalog(
      drifted.panels,
      drifted.defaultPanelId,
    );
    expect(
      qualifyInspectorPackage(envelope, [anchor], new Date(), drifted),
    ).toEqual(
      expect.objectContaining({
        status: "inspector_drift",
        verificationStatus: "trusted",
        inspectorCatalogSha256: envelope.manifest.inspectorCatalogSha256,
        observedInspectorCatalogSha256: drifted.inspectorCatalogSha256,
      }),
    );

    const missing = createInspectorCatalogFingerprint();
    missing.panels = missing.panels.filter((panel) => panel.id !== "context");
    missing.inspectorCatalogSha256 = hashInspectorCatalog(
      missing.panels,
      missing.defaultPanelId,
    );
    expect(
      qualifyInspectorPackage(envelope, [anchor], new Date(), missing),
    ).toEqual(
      expect.objectContaining({
        status: "missing_inspector",
        verificationStatus: "trusted",
      }),
    );

    const tampered = structuredClone(envelope);
    tampered.manifest.panels[0]!.label = "Changed Trace";
    expect(verifySignedInspectorPackageEnvelope(tampered, [anchor])).toEqual(
      expect.objectContaining({
        status: "invalid",
      }),
    );
  });
});
