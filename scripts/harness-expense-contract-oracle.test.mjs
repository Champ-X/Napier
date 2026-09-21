import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
const base = path.resolve('benchmarks/harness-optimization/weighted-expense-allocation-v1');
async function check(mutation, originalPasses = true) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'napier-expense-oracle-'));
  try {
    await cp(`${base}/expected`, root, { recursive: true });
    await cp(`${base}/outcome.mjs`, `${root}/original.mjs`);
    await cp('benchmarks/harness-supplemental/weighted-expense-allocation-v1.mjs', `${root}/supplemental.mjs`);
    if (mutation) {
      const file = `${root}/src/allocation.py`, content = await readFile(file, 'utf8');
      assert.ok(content.includes(mutation[0]));
      await writeFile(file, content.replace(mutation[0], mutation[1]));
    }
    const grade = name => spawnSync(process.execPath, [`${name}.mjs`], { cwd: root, encoding: 'utf8', timeout: 15000, env: { PATH: path.dirname(process.execPath) } });
    const original = grade('original'); assert.equal(original.status, originalPasses ? 0 : 1, original.stderr);
    const supplemental = grade('supplemental'); assert.equal(supplemental.status, mutation ? 1 : 0, supplemental.stderr);
  } finally { await rm(root, { recursive: true, force: true }); }
}
test('expense reference satisfies original and supplemental contracts', () => check());
test('supplement catches insertion order that dictionary equality misses', () => check(['out={k:0 for k in sorted(weights)}', 'out={k:0 for k in weights}']));
test('supplement catches boolean capacities missed by original grader', () => check(['type(c) is not int', 'not isinstance(c,int)']));
test('supplement catches omitted participant ID validation', () => check(['not isinstance(k,str) or not k or ', '']));
