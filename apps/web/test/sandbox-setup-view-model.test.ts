import type { SandboxSetupPreview } from "@napier/contracts/sandbox-setup";
import { describe, expect, it } from "vitest";

import {
  sandboxSetupCopy,
  sandboxSetupReady,
} from "../src/sandbox-setup-view-model";

describe("Sandbox setup view model", () => {
  it("offers exact-preview activation only for ready or buildable states", () => {
    expect(sandboxSetupCopy(preview("buildable"))).toEqual(
      expect.objectContaining({
        title: "Build required",
        action: "Build & activate",
        actionable: true,
      }),
    );
    expect(sandboxSetupCopy(preview("ready"))).toEqual(
      expect.objectContaining({
        title: "Image found",
        action: "Verify & activate",
        actionable: true,
      }),
    );
    expect(sandboxSetupCopy(preview("runtime_unavailable"))).toEqual(
      expect.objectContaining({
        title: "Docker offline",
        actionable: false,
      }),
    );
  });

  it("does not claim active readiness from an unverified image tag", () => {
    expect(sandboxSetupReady(preview("buildable"))).toBe(false);
    expect(sandboxSetupReady(preview("ready"))).toBe(false);
    expect(sandboxSetupReady({ ...preview("ready"), active: true })).toBe(true);
    const { imageId: _imageId, ...withoutImage } = preview("ready");
    expect(sandboxSetupReady(withoutImage)).toBe(false);
  });
});

function preview(status: SandboxSetupPreview["status"]): SandboxSetupPreview {
  return {
    kind: "napier.sandbox-runtime-setup-preview",
    schemaVersion: 1,
    component: "sandbox",
    status,
    active: false,
    imageReference: "napier-sandbox:0.1.0",
    ...(status === "ready" ? { imageId: `sha256:${"a".repeat(64)}` } : {}),
    dockerfileSha256: "b".repeat(64),
    contextSha256: "c".repeat(64),
    platform: "linux",
    arch: "x64",
    contentSha256: "d".repeat(64),
  };
}
