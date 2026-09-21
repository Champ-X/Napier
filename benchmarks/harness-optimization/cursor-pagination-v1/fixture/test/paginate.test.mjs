import {test} from 'node:test';import assert from 'node:assert/strict';import {paginate} from '../src/paginate.mjs';
test('matching rows fill a page and equal timestamps use ids',()=>{
 const rows=[{id:'b',createdAt:20,status:'open'},{id:'z',createdAt:30,status:'closed'},{id:'a',createdAt:20,status:'open'}];
 const page=paginate(rows,{limit:2,status:'open'});assert.deepEqual(page.items.map(r=>r.id),['a','b']);assert.equal(page.nextCursor,null);
});
