import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Supplement only explicit README requirements. Original grader remains intact.
const code = String.raw`
import sys, copy
sys.path.insert(0, 'src')
from allocation import allocate
weights = {'z': 2, 'a': 3, 'm': 1}
caps = {'m': 8, 'z': 8, 'a': 8}
initial_weights, initial_caps = copy.deepcopy(weights), copy.deepcopy(caps)
for total in [0, 1, 7, 23, -1, -7, -23]:
    result = allocate(total, weights, caps)
    assert list(result) == ['a', 'm', 'z'], 'Shares must be sorted by participant ID'
    assert sum(result.values()) == total
    assert all(type(value) is int for value in result.values())
    assert all(abs(value) <= caps[key] for key, value in result.items())
    if total < 0:
        positive = allocate(-total, weights, caps)
        assert result == {key: -value for key, value in positive.items()}
assert weights == initial_weights and caps == initial_caps, 'Input mutation'
for invalid in [lambda: allocate(0, {'a': 1}, {'a': True}),
                lambda: allocate(0, {'a': 1}, {'a': -1}),
                lambda: allocate(0, {'': 1}),
                lambda: allocate(0, {1: 1}),
                lambda: allocate(0, {'a': 0})]:
    try:
        invalid()
    except Exception:
        pass
    else:
        raise AssertionError('Zero total must still validate all inputs')
`;
const result = spawnSync('/usr/bin/python3', ['-B', '-c', code], {
  encoding: 'utf8', timeout: 15000,
});
assert.equal(result.status, 0, result.stderr);
console.log('Supplemental expense contract checks passed');
