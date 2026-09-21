const assert = require('node:assert/strict');
const { tax } = require('./tax.cjs');
assert.equal(tax(50), 10);
assert.equal(tax(49.99), 10);
console.log('Node tax regression passed');
