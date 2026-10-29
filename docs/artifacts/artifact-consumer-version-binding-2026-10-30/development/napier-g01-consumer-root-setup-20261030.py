from pathlib import Path
import json,hashlib,subprocess,shutil
w=Path('/Users/champ/orca/Napier');r=Path('/tmp/napier-g01-consumer-integrated-20261030').resolve()
rootfiles=['packages/contracts/src/conversation-artifact-projection.ts','packages/contracts/src/task-artifact-history.ts','packages/runtime/src/conversation-artifacts-projection.ts','packages/runtime/src/kernel-detail-projections.ts','packages/runtime/src/kernel-projections.ts','packages/runtime/test/conversation-artifact-version-binding.test.ts','packages/runtime/test/kernel-projections.test.ts','packages/runtime/test/subagent-child-run-projection.test.ts','apps/web/src/conversation-artifact-view-model.ts','apps/web/src/conversation-feed-projection.ts','apps/web/test/conversation-artifact-view-model.test.ts','apps/web/src/task-narrative-protocol.ts','apps/web/test/task-narrative-protocol.test.ts']
subprocess.run(['node','node_modules/prettier/bin/prettier.cjs','--write',*rootfiles],cwd=w,check=True)
handoff=json.load(open('/tmp/napier-g01-consumer-handoff-20261030-v2.json'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
for item in handoff['ownedFiles']:assert sha(w/item['path'])==item['sha256'],item['path']
files=sorted(set(rootfiles+[item['path'] for item in handoff['ownedFiles']]))
base=subprocess.check_output(['git','rev-parse','HEAD'],cwd=w,text=True).strip()
subprocess.run(['git','worktree','add','--detach',str(r),base],cwd=w,check=True)
for f in files:shutil.copy2(w/f,r/f)
n=r/'node_modules';n.mkdir()
for p in (w/'node_modules').iterdir():
 if p.name!='@napier':(n/p.name).symlink_to(p,target_is_directory=p.is_dir())
(n/'@napier').mkdir()
for p in (w/'node_modules/@napier').iterdir():(n/'@napier'/p.name).symlink_to(r/p.resolve().relative_to(w),target_is_directory=True)
subprocess.run(['git','add','--',*files],cwd=r,check=True)
manifest={'baseHead':base,'tree':subprocess.check_output(['git','write-tree'],cwd=r,text=True).strip(),'files':{f:sha(r/f) for f in files},'fileCount':len(files),'snapshot':str(r),'consumerHandoff':'/tmp/napier-g01-consumer-handoff-20261030-v2.json','consumerHandoffSha256':sha(Path('/tmp/napier-g01-consumer-handoff-20261030-v2.json'))}
Path('/tmp/napier-g01-consumer-source-stage-20261030.json').write_text(json.dumps(manifest,indent=2)+'\n')
strict=json.loads(Path('/tmp/napier-g01-consumer-tsconfig.json').read_text().replace(str(w),str(r)))
strict['include']+= [str(r/f) for f in rootfiles if '/test/' in f]
(r/'strict-tests.json').write_text(json.dumps(strict,indent=2)+'\n')
print({'files':len(files),'tree':manifest['tree'],'snapshot':str(r)})
