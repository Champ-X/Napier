import { describe, expect, it } from "vitest";

import rootPackage from "../package.json" with { type: "json" };
import runtimePackage from "../packages/runtime/package.json" with {
  type: "json",
};

const RELEASE_SOURCE_GATE = "release-product-source-manifest.mjs";

describe("development and release build boundary", () => {
  it("keeps release source attestation on the publishable runtime build", () => {
    expect(runtimePackage.scripts.build).toContain(RELEASE_SOURCE_GATE);
    expect(runtimePackage.scripts.build.indexOf(RELEASE_SOURCE_GATE)).toBeLessThan(
      runtimePackage.scripts.build.indexOf("npm run build:compile"),
    );
    expect(rootPackage.scripts["build:core"]).toContain(
      "npm run build -w @napier/runtime",
    );
    expect(rootPackage.scripts["build:core"]).not.toContain("build:compile");
    expect(rootPackage.scripts.build).toMatch(/^npm run build:core\b/);
    expect(rootPackage.scripts.build).not.toContain("build:core:development");
  });

  it("gives development a compilation-only bootstrap", () => {
    expect(runtimePackage.scripts["build:compile"]).not.toContain(
      RELEASE_SOURCE_GATE,
    );
    expect(rootPackage.scripts["build:core:development"]).toContain(
      "npm run build:compile -w @napier/runtime",
    );
    expect(rootPackage.scripts["build:core:development"]).not.toContain(
      RELEASE_SOURCE_GATE,
    );
    expect(rootPackage.scripts.dev).toMatch(
      /^npm run build:core:development\b/,
    );
    expect(rootPackage.scripts.dev).not.toContain("npm run build:core &&");
    expect(rootPackage.scripts.dev).not.toContain(RELEASE_SOURCE_GATE);
  });
});
