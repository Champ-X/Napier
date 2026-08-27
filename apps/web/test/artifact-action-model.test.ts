import type { ArtifactManifestEntry } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  artifactActionAvailability,
  workspaceTrashActionAvailability,
} from "../src/artifact-action-model";

describe("artifactActionAvailability", () => {
  it("offers one shared inspect flow for produced and verified files", () => {
    expect(artifactActionAvailability(artifact())).toEqual({
      primary: "open",
      actions: ["open", "preview", "diff", "copy_path"],
    });
    expect(
      artifactActionAvailability(artifact({ status: "produced" })),
    ).toEqual({
      primary: "open",
      actions: ["open", "preview", "diff", "copy_path"],
    });
  });

  it("only opens settled safe URLs and never invents host actions", () => {
    expect(
      artifactActionAvailability(
        artifact({ kind: "url", path: "https://example.com/result" }),
      ),
    ).toEqual({ primary: "open", actions: ["open", "copy_path"] });
    expect(
      artifactActionAvailability(
        artifact({
          kind: "url",
          path: "javascript:alert(1)",
          status: "produced",
        }),
      ),
    ).toEqual({ actions: ["copy_path"] });
    expect(
      artifactActionAvailability(
        artifact({
          kind: "url",
          path: "https://example.com/future",
          status: "expected",
        }),
      ),
    ).toEqual({ actions: ["copy_path"] });
    expect(artifactActionAvailability(artifact()).actions).not.toEqual(
      expect.arrayContaining(["reveal", "restore", "apply"]),
    );
  });

  it("shows protocol-gated actions only when the caller supplies capability", () => {
    expect(
      artifactActionAvailability(artifact(), {
        reveal: true,
        restore: true,
        apply: true,
      }).actions,
    ).toEqual([
      "open",
      "preview",
      "diff",
      "reveal",
      "copy_path",
      "restore",
      "apply",
    ]);
  });

  it("uses the shared action vocabulary for reversible workspace trash", () => {
    expect(workspaceTrashActionAvailability()).toEqual({
      actions: ["copy_path"],
    });
    expect(workspaceTrashActionAvailability({ restore: true })).toEqual({
      primary: "restore",
      actions: ["copy_path", "restore"],
    });
  });
});

function artifact(
  overrides: Partial<ArtifactManifestEntry> = {},
): ArtifactManifestEntry {
  return {
    id: "artifact_report",
    path: "artifacts/report.md",
    kind: "file",
    description: "Verified report",
    status: "verified",
    evidence: "Verified by the runtime.",
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
    ...overrides,
  };
}
