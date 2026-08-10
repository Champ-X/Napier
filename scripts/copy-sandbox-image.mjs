import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");

export async function copySandboxImageAsset(root = repoRoot) {
  const source = path.join(root, "docker/napier-sandbox/Dockerfile");
  const destinationDirectory = path.join(
    root,
    "packages/runtime/dist/sandbox-image",
  );
  const content = await readFile(source);
  if (content.byteLength <= 0 || content.byteLength > 64 * 1024) {
    throw new Error("Sandbox Dockerfile asset is invalid");
  }
  await mkdir(destinationDirectory, { recursive: true });
  await copyFile(source, path.join(destinationDirectory, "Dockerfile"));
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  await copySandboxImageAsset();
}
