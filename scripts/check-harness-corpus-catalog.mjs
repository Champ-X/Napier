import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildHarnessCorpusInventory, corpusDigest } from "./harness-corpus-inventory.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(repoRoot, "benchmarks/harness-corpus-catalog-v1.json");
let retained;
try { retained = JSON.parse(await readFile(target, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
const { catalog, audit } = await buildHarnessCorpusInventory(repoRoot, retained);
if (process.argv.includes("--write")) await writeFile(target, `${JSON.stringify(catalog, null, 2)}\n`, { flag: "wx" });
else assert.equal(corpusDigest(catalog), corpusDigest(retained), "Corpus source or exposure provenance drifted; preserve this version and create an explicit successor");
const { validateHarnessCorpusCatalog } = await import("../packages/harness-eval/dist/harness-experiments.js");
validateHarnessCorpusCatalog(catalog);
console.log(JSON.stringify({ valid: true, contentSha256: catalog.contentSha256, ...audit }));
