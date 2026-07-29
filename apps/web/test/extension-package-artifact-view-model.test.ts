import type { SignedExtensionPackageEnvelope } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { signedExtensionPackageFilename } from "../src/extension-package-artifact-view-model";

describe("extension package artifact view model", () => {
  it("builds safe signed extension package filenames", () => {
    expect(
      signedExtensionPackageFilename(
        "portable/records",
        signedEnvelope("abcdef1234567890".padEnd(64, "0")),
      ),
    ).toBe("portable_records-abcdef123456.napier-extension.json");
  });
});

function signedEnvelope(
  contentSha256: string,
): Pick<SignedExtensionPackageEnvelope, "contentSha256"> {
  return { contentSha256 };
}
