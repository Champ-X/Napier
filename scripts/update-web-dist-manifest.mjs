import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { generateWebDistManifest } from "./check-web-dist.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "..");

try {
  await runCli();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function runCli() {
  const options = parseCliOptions(process.argv.slice(2));
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const manifestPath = path.resolve(
    repoRoot,
    options.manifestPath ?? "docs/artifacts/web-dist-0.1.0.sha256",
  );
  const generated = await generateWebDistManifest({
    repoRoot,
    ...(options.manifestRoot ? { manifestRoot: options.manifestRoot } : {}),
  });

  if (options.check) {
    const current = await readFile(manifestPath, "utf8").catch(() => "");
    if (current !== generated.manifestText) {
      console.error(
        `${relativePath(repoRoot, manifestPath)} is stale; run npm run update:web-dist-manifest after building the Web workspace.`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      `Web dist manifest is current: ${generated.fileCount} files dist ${generated.distContentSha256.slice(0, 16)}`,
    );
    return;
  }

  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, generated.manifestText);
  console.log(
    `Wrote ${relativePath(repoRoot, manifestPath)}: ${generated.fileCount} files dist ${generated.distContentSha256.slice(0, 16)}`,
  );
}

function parseCliOptions(args) {
  const options = { check: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--check") {
      options.check = true;
      continue;
    }
    if (arg === "--repo-root") {
      options.repoRoot = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--manifest-root") {
      options.manifestRoot = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--manifest-path") {
      options.manifestPath = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function readCliValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function relativePath(repoRoot, filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join("/");
}
