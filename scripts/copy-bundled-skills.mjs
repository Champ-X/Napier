import { cp, lstat, mkdir, opendir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");

export const BUNDLED_SKILL_NAMES = Object.freeze([
  "artifact-studio",
  "browser-automation",
  "data-analysis",
  "frontend-design",
  "research-brief",
  "software-delivery",
]);

export async function copyBundledSkills(root = repositoryRoot) {
  const sourceRoot = path.join(root, "skills");
  const destinationRoot = path.join(
    root,
    "packages/runtime/dist/bundled-skills",
  );
  const destination = path.join(destinationRoot, "skills");
  await rm(destinationRoot, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  for (const name of BUNDLED_SKILL_NAMES) {
    const source = path.join(sourceRoot, name);
    await assertRegularTree(source);
    await cp(source, path.join(destination, name), {
      recursive: true,
      dereference: false,
    });
  }
}

async function assertRegularTree(root) {
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`Bundled Skill root is not a regular directory: ${root}`);
  }
  const directory = await opendir(root);
  try {
    for await (const entry of directory) {
      const absolute = path.join(root, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Bundled Skill tree contains a symlink: ${absolute}`);
      }
      if (entry.isDirectory()) {
        await assertRegularTree(absolute);
      } else if (!entry.isFile()) {
        throw new Error(
          `Bundled Skill tree contains a special file: ${absolute}`,
        );
      }
    }
  } finally {
    await directory.close().catch(() => undefined);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  await copyBundledSkills();
}
