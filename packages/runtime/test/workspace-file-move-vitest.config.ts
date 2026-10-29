import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const contracts = new URL("../../contracts/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("package.json", contracts), "utf8")) as {
  exports: Record<string, { import: string }>;
};
const alias = Object.entries(manifest.exports).map(([subpath, target]) => ({
  find: `@napier/contracts${subpath === "." ? "" : subpath.slice(1)}`,
  replacement: fileURLToPath(new URL(target.import.replace("./dist/", "./src/").replace(/\.js$/u, ".ts"), contracts)),
})).sort((left, right) => right.find.length - left.find.length);

export default defineConfig({ root: fileURLToPath(new URL("../", import.meta.url)), resolve: { alias },
  test: { maxWorkers: 2, testTimeout: 30_000 } });
