import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");

export async function copySandboxImageAsset(root = repoRoot) {
  const sourceDirectory = path.join(root, "docker/napier-sandbox");
  const destinationDirectory = path.join(
    root,
    "packages/runtime/dist/sandbox-image",
  );
  await mkdir(destinationDirectory, { recursive: true });
  for (const [fileName, maximumBytes] of [
    ["Dockerfile", 64 * 1024],
    ["package.json", 64 * 1024],
    ["package-lock.json", 4 * 1024 * 1024],
  ]) {
    const source = path.join(sourceDirectory, fileName);
    const content = await readFile(source);
    if (content.byteLength <= 0 || content.byteLength > maximumBytes) {
      throw new Error(`Sandbox ${fileName} asset is invalid`);
    }
    await copyFile(source, path.join(destinationDirectory, fileName));
  }
  const releaseSource = path.join(
    root,
    "docs/artifacts/sandbox-external-publication-0.1.0.json",
  );
  const releaseDestination = path.join(
    destinationDirectory,
    "external-publication.json",
  );
  await rm(releaseDestination, { force: true });
  try {
    const content = await readFile(releaseSource);
    if (content.byteLength <= 0 || content.byteLength > 128 * 1024) {
      throw new Error("Sandbox external publication receipt asset is invalid");
    }
    await copyFile(releaseSource, releaseDestination);
  } catch (error) {
    if (!missing(error)) throw error;
  }
}

function missing(error) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT",
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  await copySandboxImageAsset();
}
