import { cp, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(
  new URL("../integrations/tessmora/", import.meta.url),
);

export async function installTessmoraSkill(userHome = homedir()) {
  const destination = path.join(userHome, ".agents", "skills", "mma-rag");
  for (const directory of [
    userHome,
    path.join(userHome, ".agents"),
    path.dirname(destination),
    destination,
  ]) {
    const info = await lstat(directory).catch((error) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (info && (!info.isDirectory() || info.isSymbolicLink())) {
      throw new Error(
        `Skill destination must be a regular directory: ${directory}`,
      );
    }
  }
  await mkdir(destination, { recursive: true });
  for (const resource of ["scripts", "references", "agents"]) {
    await cp(path.join(source, resource), path.join(destination, resource), {
      recursive: true,
    });
  }
  const text = await readFile(path.join(source, "SKILL.md"), "utf8");
  const launcher = path.join(destination, "scripts", "mma-rag.mjs");
  await writeFile(
    path.join(destination, "SKILL.md"),
    text.replace('"__TESSMORA_CLI__"', JSON.stringify(launcher)),
  );
  return destination;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const destination = await installTessmoraSkill();
  console.log(`Installed Tessmora Skill: ${destination}`);
  console.log("Enable mma-rag on the selected Agent in each Napier workspace.");
}
