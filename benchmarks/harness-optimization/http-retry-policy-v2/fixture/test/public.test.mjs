import {test} from 'node:test';import assert from 'node:assert/strict';import {retryDelay} from '../src/retry.mjs';
test('429 honors Retry-After',()=>assert.equal(retryDelay({method:'GET',status:429,attempt:0,retryAfter:'2',nowMs:0}),2000));
