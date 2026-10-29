from pathlib import Path
import subprocess,tarfile,io,shutil,json,hashlib
w=Path('/Users/champ/orca/Napier');r=Path('/tmp/napier-g01-conversation-before-20261030').resolve();r.mkdir()
base='e10a7bd39b71dc74dfb4bbd05f6c5254bedd5696'
data=subprocess.check_output(['git','archive',base,'packages/runtime','packages/contracts','scripts','package.json','package-lock.json','tsconfig.base.json'],cwd=w)
with tarfile.open(fileobj=io.BytesIO(data)) as tf:tf.extractall(r,filter='data')
f='packages/runtime/test/conversation-artifact-version-binding.test.ts';shutil.copy2(w/f,r/f)
n=r/'node_modules';n.mkdir()
for p in (w/'node_modules').iterdir():
 if p.name!='@napier':(n/p.name).symlink_to(p,target_is_directory=p.is_dir())
(n/'@napier').mkdir()
for k in ['contracts','runtime']:(n/'@napier'/k).symlink_to(r/'packages'/k,target_is_directory=True)
c=r/'probe.config.mts';c.write_text(Path('/tmp/napier-g07-frozen-20261030-v1/frozen-vitest.config.mts').read_text().replace('/tmp/napier-g07-frozen-20261030-v1/candidate',str(r)))
with (r/'before.log').open('w') as log:
 result=subprocess.run(['node',str(n/'vitest/vitest.mjs'),'run','--config',str(c),f,'--reporter=json','--outputFile='+str(r/'before.json')],cwd=r,stdout=log,stderr=subprocess.STDOUT)
print({'base':base,'exit':result.returncode,'root':str(r),'testSha256':hashlib.sha256((r/f).read_bytes()).hexdigest()})
