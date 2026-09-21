import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Validate using the same Runtime that will execute the arm. A profile file
 * is explicit configuration; it cannot silently merge with other selectors. */
export function assertProfileFileSelection(values) {
  if (values["profile-file"] === undefined) return;
  if (
    typeof values["profile-file"] !== "string" ||
    !values["profile-file"].trim()
  )
    throw new Error("Explicit profile file path must be nonempty");
  if (
    values["profile-mode"] === "default" ||
    [
      "policy",
      "context-delivery",
      "finalization",
      "edit-dialect",
      "calibration-catalog",
    ].some((name) => values[name] !== undefined)
  )
    throw new Error(
      "Explicit profile file cannot be combined with default mode, presets or profile overrides",
    );
}

export async function readCampaignProfile(
  file,
  runtimeRoot,
  expectedFileSha256,
) {
  const bytes = await readFile(file);
  if (expectedFileSha256 !== undefined && hash(bytes) !== expectedFileSha256)
    throw new Error("Frozen campaign profile changed before execution");
  if (bytes.length > 256 * 1024)
    throw new Error("Campaign profile file exceeds 256 KiB");
  const { validateModelHarnessExperimentProfile } = await import(
    pathToFileURL(
      path.resolve(
        runtimeRoot,
        "packages/runtime/dist/model-harness-experiment-profile.js",
      ),
    )
  );
  return {
    profile: validateModelHarnessExperimentProfile(
      JSON.parse(bytes.toString("utf8")),
    ),
    sourceSha256: hash(bytes),
  };
}

export async function freezeCampaignProfile(file, runtimeRoot, output) {
  const { profile, sourceSha256 } = await readCampaignProfile(
    file,
    runtimeRoot,
  );
  const bytes = JSON.stringify(profile, null, 2) + "\n";
  await writeFile(output, bytes, { flag: "wx", mode: 0o600 });
  return {
    path: path.resolve(output),
    sourceSha256,
    fileSha256: hash(bytes),
    profileSha256: profile.contentSha256,
  };
}

/** The receipt is checked at each job launch; later file edits cannot silently
 * replace the reviewed suite composition between cases. */
export async function assertFrozenCampaignProfile(receipt) {
  if (hash(await readFile(receipt.path)) !== receipt.fileSha256)
    throw new Error("Frozen campaign profile changed before execution");
}
