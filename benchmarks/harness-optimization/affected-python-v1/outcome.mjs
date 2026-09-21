import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const script = `from shipping import shipping
assert shipping(0) == 5
assert shipping(49.99) == 5
assert shipping(50) == 0
assert shipping(50, True) == 8
assert shipping(49.99, True) == 13
assert shipping(100) == 0
for invalid in [-1, float('nan'), float('inf'), True, '50']:
    try: shipping(invalid)
    except ValueError: pass
    else: raise AssertionError(repr(invalid))
`;
const python = spawnSync('/usr/bin/python3', ['-B', '-c', script], { cwd: process.cwd(), encoding: 'utf8', timeout: 10000 });
assert.equal(python.status, 0, python.stderr);
const node = spawnSync(process.execPath, ['node_test.cjs'], { cwd: process.cwd(), encoding: 'utf8', timeout: 10000 });
assert.equal(node.status, 0, node.stderr);
console.log('External Python boundary, validation and Node regression checks passed');
