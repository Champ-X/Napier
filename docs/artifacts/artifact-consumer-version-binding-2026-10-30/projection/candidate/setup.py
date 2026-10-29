from pathlib import Path
import subprocess,tarfile,io,shutil,json,hashlib
w=Path('/Users/champ/orca/Napier');r=Path('/tmp/napier-g01-conversation-candidate-20261030').resolve();r.mkdir()
base='e10a7bd39b71dc74dfb4bbd05f6c5254bedd5696'
data=subprocess.check_output(['git','archive',base,'packages/runtime','packages/contracts','apps/web','scripts','package.json','package-lock.json','tsconfig.base.json'],cwd=w)
with tarfile.open(fileobj=io.BytesIO(data)) as tf:tf.extractall(r,filter='data')
files=['packages/contracts/src/conversation-artifact-projection.ts','packages/contracts/src/task-narrative.ts','packages/contracts/src/task-artifact-facts.ts','packages/runtime/src/conversation-artifacts-projection.ts','packages/runtime/src/kernel-detail-projections.ts','packages/runtime/test/conversation-artifact-version-binding.test.ts','packages/runtime/test/kernel-projections.test.ts','packages/runtime/test/subagent-child-run-projection.test.ts','apps/web/src/conversation-artifact-view-model.ts','apps/web/test/conversation-artifact-view-model.test.ts']
for f in files:shutil.copy2(w/f,r/f)
n=r/'node_modules';n.mkdir()
for p in (w/'node_modules').iterdir():
 if p.name!='@napier':(n/p.name).symlink_to(p,target_is_directory=p.is_dir())
(n/'@napier').mkdir()
for k in ['contracts','runtime']:(n/'@napier'/k).symlink_to(r/'packages'/k,target_is_directory=True)
c=r/'probe.config.mts';c.write_text(Path('/tmp/napier-g07-frozen-20261030-v1/frozen-vitest.config.mts').read_text().replace('/tmp/napier-g07-frozen-20261030-v1/candidate',str(r)))
(r/'source-manifest.json').write_text(json.dumps({'base':base,'files':{f:hashlib.sha256((r/f).read_bytes()).hexdigest() for f in files}},indent=2)+'\n')
with (r/'tests-v1.log').open('w') as log:
 result=subprocess.run(['node',str(n/'vitest/vitest.mjs'),'run','--config',str(c),'packages/runtime/test/conversation-artifact-version-binding.test.ts','packages/runtime/test/kernel-projections.test.ts','packages/runtime/test/subagent-child-run-projection.test.ts','apps/web/test/conversation-artifact-view-model.test.ts','--reporter=json','--outputFile='+str(r/'tests-v1.json')],cwd=r,stdout=log,stderr=subprocess.STDOUT)
print({'base':base,'exit':result.returncode,'root':str(r)})
