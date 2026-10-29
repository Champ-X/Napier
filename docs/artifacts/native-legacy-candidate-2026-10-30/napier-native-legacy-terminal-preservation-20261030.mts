import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { LocalStore } from '/Users/champ/orca/Napier/packages/runtime/src/store.ts';
import { canonicalJson, sha256 } from '/Users/champ/orca/Napier/packages/runtime/src/ed25519.ts';
const cases=[];
for(const mode of ['outcome','typed']) {
 const fixturePath=`/tmp/napier-native-legacy-${mode}-acceptance-v2-fixture-20261030.json`;
 const fixture=JSON.parse(await readFile(fixturePath,'utf8'));
 const store=new LocalStore({workspaceRoot:fixture.workspaceRoot,dataRoot:fixture.dataRoot});
 await store.initialize();
 try {
  const childEvents=await store.listRunEvents(fixture.childRunId);
  const terminal=childEvents.find(event=>event.id===fixture.childTerminalEvent.id);
  assert.deepEqual(terminal,fixture.childTerminalEvent);
  const parentEvents=await store.listRunEvents(fixture.parentRunId);
  const migrated=parentEvents.filter(event=>event.type==='subagent.candidate.legacy_migrated');
  assert.equal(migrated.length,1);
  assert.equal(migrated[0]!.payload.terminalEventSha256,sha256(canonicalJson(terminal)));
  cases.push({mode,fixturePath,originalChildTerminalUnchanged:true,terminalSha256:sha256(canonicalJson(terminal)),migrationBoundOriginalTerminal:true});
 } finally {store.close();}
}
const report={schemaVersion:1,kind:'napier.native-legacy-terminal-preservation',generatedAt:new Date().toISOString(),cases,externalModelCalls:0,scope:'Read-only comparison after v2 apply/reopen/repeat against exact original producer terminal event. Complements parent-event and Task/Run preservation in v2; does not retroactively claim a full child event baseline.'};
await writeFile('/tmp/napier-native-legacy-terminal-preservation-20261030.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report));
