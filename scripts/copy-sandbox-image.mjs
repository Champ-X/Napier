import { copyFile, mkdir, readFile } from "node:fs/promises";
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
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  await copySandboxImageAsset();
}
