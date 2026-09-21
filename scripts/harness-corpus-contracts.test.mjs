import { it, expect } from "vitest";
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { prepareHarnessSuite } from "./harness-suite.mjs";
const base = path.resolve("benchmarks/harness-optimization");
async function workspace(name, fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "napier-corpus-contract-"));
  try {
    const source = path.join(base, name);
    await cp(path.join(source, "fixture"), root, { recursive: true });
    await cp(path.join(source, "outcome.mjs"), path.join(root, "grade.mjs"));
    return await fn(root, source);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const run = (root, args) =>
  spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 15000,
  });
for (const name of ["path-glob-selection-v2", "binary-frame-decoder-v2"])
  it(
    name +
      " keeps the original defective input and accepts its reference and public tests",
    async () =>
      workspace(name, async (root, source) => {
        expect(run(root, ["grade.mjs"]).status).not.toBe(0);
        await cp(path.join(source, "expected"), root, { recursive: true });
        const result = run(root, ["grade.mjs"]);
        expect(result.status, result.stderr).toBe(0);
        const publicTests = run(root, ["--test", "test/public.test.mjs"]);
        expect(
          publicTests.status,
          publicTests.stderr + publicTests.stdout,
        ).toBe(0);
      }),
  );
it("documents glob tokens as literal code and agrees with the reference on star versus underscore", async () =>
  workspace("path-glob-selection-v2", async (root, source) => {
    const readme = await readFile(path.join(root, "README.md"), "utf8");
    expect(readme).toContain("`*` zero or more");
    expect(readme).toContain("File paths cannot contain `*` or `?`");
    expect(readme).not.toContain("'_' zero or more");
    await cp(path.join(source, "expected"), root, { recursive: true });
    const probe = run(root, [
      "--input-type=module",
      "-e",
      "import assert from 'node:assert/strict';import {matchesPath} from './src/glob.mjs';assert.equal(matchesPath('a*','abc'),true);assert.equal(matchesPath('a_','abc'),false);assert.equal(matchesPath('a_','a_'),true);assert.throws(()=>matchesPath('**','a*'),TypeError)",
    ]);
    expect(probe.status, probe.stderr).toBe(0);
  }));
it("accepts owned Buffer payloads while rejecting arrays and retained input aliases", async () =>
  workspace("binary-frame-decoder-v2", async (root, source) => {
    await cp(path.join(source, "expected"), root, { recursive: true });
    const file = path.join(root, "src/decoder.mjs"),
      original = await readFile(file, "utf8");
    const wrap = (transform) =>
      original +
      `\nconst originalPush=FrameDecoder.prototype.push;FrameDecoder.prototype.push=function(chunk){return originalPush.call(this,chunk).map(payload=>${transform});};\n`;
    await writeFile(file, wrap("Buffer.from(payload)"));
    let result = run(root, ["grade.mjs"]);
    expect(result.status, result.stderr).toBe(0);
    // Establish why the earlier prototype-sensitive grade was too restrictive.
    await cp(
      path.join(base, "binary-frame-decoder-v1/outcome.mjs"),
      path.join(root, "legacy-grade.mjs"),
    );
    expect(run(root, ["legacy-grade.mjs"]).status).not.toBe(0);
    await writeFile(file, wrap("Array.from(payload)"));
    result = run(root, ["grade.mjs"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Payload must be a Uint8Array");
    await writeFile(
      file,
      original +
        `\nconst originalPush=FrameDecoder.prototype.push;FrameDecoder.prototype.push=function(chunk){const result=originalPush.call(this,chunk);if(chunk.length>=8&&result.length===1)return [chunk.subarray(4,chunk.length-4)];return result;};\n`,
    );
    // A coalesced frame must not alias the caller's bytes even if byte contents match.
    const aliasProbe = run(root, [
      "--input-type=module",
      "-e",
      "import assert from 'node:assert/strict';import {FrameDecoder} from './src/decoder.mjs';import {checksum} from './src/checksum.mjs';const wire=Buffer.alloc(11);wire.writeUInt32BE(3);wire.set([1,2,3],4);wire.writeUInt32BE(checksum(wire.subarray(4,7)),7);const [payload]=new FrameDecoder().push(wire);wire[4]=99;assert.equal(payload[0],1)",
    ]);
      expect(aliasProbe.status).not.toBe(0);
      expect(run(root, ["grade.mjs"]).status).not.toBe(0);
  }));
it("the corrected full suite has thirty distinct cases and keeps superseded cases out", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "napier-corpus-suite-"));
  try {
    const inputs = await prepareHarnessSuite(
      path.resolve("benchmarks/harness-core-quality-suite-v2.json"),
      path.join(root, "cases"),
    );
    expect(inputs.cases).toHaveLength(30);
    expect(new Set(inputs.cases.map((c) => c.inputSha256)).size).toBe(30);
    expect(inputs.cases.map((c) => c.id)).toEqual(
      expect.arrayContaining([
        "path_glob_selection_v2",
        "binary_frame_decoder_v2",
      ]),
    );
    expect(inputs.cases.map((c) => c.id)).not.toEqual(
      expect.arrayContaining(["path_glob_selection_v1"]),
    );
    expect(inputs.cases.map((c) => c.id)).not.toEqual(
      expect.arrayContaining(["binary_frame_decoder_v1"]),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
