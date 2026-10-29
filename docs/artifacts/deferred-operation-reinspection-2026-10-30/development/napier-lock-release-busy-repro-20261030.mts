import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { withWorkspacePathLocks } from '/Users/champ/orca/Napier/packages/runtime/src/workspace-write-lock.ts';
const root=await mkdtemp(path.join(tmpdir(),'napier-release-busy-repro-'));
const target=path.join(root,'target');
let blocker: DatabaseSync|undefined;
const result:{pid:number;first?:unknown;lock?:unknown;retries:unknown[]}={pid:process.pid,retries:[]};
try {
  try {
    await withWorkspacePathLocks(root,[target],'Ordinary mutation',async()=>{
      blocker=new DatabaseSync(path.join(root,'file-edit-locks.sqlite'));
      blocker.exec('BEGIN IMMEDIATE');
      return 'ordinary-operation-returned';
    });
    result.first={returned:true};
  } catch(error) { result.first={returned:false,name:(error as Error).constructor.name,message:(error as Error).message}; }
  blocker!.exec('COMMIT'); blocker!.close();blocker=undefined;
  const names=await readdir(path.join(root,'file-edit-locks'));
  result.lock=JSON.parse(await readFile(path.join(root,'file-edit-locks',names[0]!), 'utf8'));
  for(const waitMs of [0,100,1000]) {
    await delay(waitMs);
    try { await withWorkspacePathLocks(root,[target],'Subsequent ordinary mutation',async()=>undefined); result.retries.push({waitMs,acquired:true}); }
    catch(error){result.retries.push({waitMs,acquired:false,name:(error as Error).constructor.name,message:(error as Error).message});}
  }
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
} finally {
  if(blocker){if(blocker.isTransaction)blocker.exec('ROLLBACK');blocker.close();}
  await rm(root,{recursive:true,force:true});
}
