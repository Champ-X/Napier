import { describe, expect, it } from "vitest";

import {
  createKernelPluginManifest,
  validateKernelPluginManifest,
} from "../src/kernel-plugin-manifest.js";

describe("Kernel plugin manifest", () => {
  it("creates a strict hash-bound first-party manifest", () => {
    const manifest = fixture();

    expect(validateKernelPluginManifest(manifest)).toEqual(manifest);
    expect(manifest).toEqual(
      expect.objectContaining({
        kind: "napier.kernel-plugin-manifest",
        schemaVersion: 1,
        id: "plugin.fixture",
        version: "1.2.3",
        trust: "first_party",
        capabilities: ["projection", "tool", "ui_slot"],
        permissions: ["workspace.read"],
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
  });

  it("rejects extra keys, hash drift, unsorted values, and missing UI entry", () => {
    expect(() =>
      validateKernelPluginManifest({ ...fixture(), extra: true }),
    ).toThrow("keys");
    expect(() =>
      validateKernelPluginManifest({
        ...fixture(),
        displayName: "Drifted",
      }),
    ).toThrow("hash mismatch");
    expect(() =>
      createKernelPluginManifest({
        ...input(),
        capabilities: ["tool", "projection", "ui_slot"],
      }),
    ).toThrow("sorted");
    expect(() =>
      createKernelPluginManifest({
        ...input(),
        entries: { host: input().entries.host },
      }),
    ).toThrow("client entry");
  });

  it("requires capabilities to exactly match declared contributions", () => {
    expect(() =>
      createKernelPluginManifest({
        ...input(),
        capabilities: ["projection", "tool"],
      }),
    ).toThrow("do not match contributions");
  });
});

function fixture() {
  return createKernelPluginManifest(input());
}

function input() {
  return {
    id: "plugin.fixture",
    version: "1.2.3",
    displayName: "Fixture Plugin",
    description: "Provides one tool, projection, and inspector contribution.",
    trust: "first_party" as const,
    dependencies: [{ id: "plugin.foundation", versionRange: "^1.0.0" }],
    capabilities: ["projection", "tool", "ui_slot"] as const,
    permissions: ["workspace.read"] as const,
    entries: {
      host: { package: "@napier/plugin-fixture", export: "./host" },
      client: { package: "@napier/plugin-fixture", export: "./client" },
    },
    contributions: {
      tools: ["fixture.read"],
      providers: [],
      prompts: [],
      projections: ["fixture.summary"],
      uiSlots: ["inspector.panel"] as const,
    },
  };
}
