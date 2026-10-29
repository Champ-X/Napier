from pathlib import Path
import json,subprocess,hashlib,shutil,io,tarfile
w=Path('/Users/champ/orca/Napier');m=json.load(open('/tmp/napier-g01-consumer-source-stage-20261030.json'));source=Path(m['snapshot']);r=Path('/tmp/napier-g01-consumer-browser-20261030').resolve();r.mkdir()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
assert all(sha(source/p)==h for p,h in m['files'].items())
data=subprocess.check_output(['git','archive',m['tree']],cwd=source)
with tarfile.open(fileobj=io.BytesIO(data)) as t:t.extractall(r,filter='data')
protected=json.load(open('/tmp/napier-overlay-preserved-user-files-20261029.json'))
for p,h in protected.items():
 assert sha(w/p)==h;shutil.copy2(w/p,r/p)
n=r/'node_modules';n.mkdir()
for p in (w/'node_modules').iterdir():
 if p.name!='@napier':(n/p.name).symlink_to(p,target_is_directory=p.is_dir())
(n/'@napier').mkdir()
for p in (w/'node_modules/@napier').iterdir():(n/'@napier'/p.name).symlink_to(r/p.resolve().relative_to(w),target_is_directory=True)
(r/'browser-source-receipt.json').write_text(json.dumps({'sourceManifest':m,'protectedOverlay':protected,'files':{str(p.relative_to(r)):sha(p) for folder in ['packages/contracts/src','packages/runtime/src','apps/server/src','apps/web/src','apps/web/test'] for p in (r/folder).rglob('*') if p.is_file()}},indent=2)+'\n')
checks=[]
for name,args in [('compile',['node','node_modules/typescript/bin/tsc','-b','packages/runtime','apps/cli','apps/server','--force']),('skills',['node','scripts/copy-bundled-skills.mjs']),('sandbox',['node','scripts/copy-sandbox-image.mjs']),('web-build',['npm','run','build','-w','@napier/web'])]:
 log=r/(name+'.log')
 with log.open('w') as f:result=subprocess.run(args,cwd=r,stdout=f,stderr=subprocess.STDOUT)
 checks.append({'name':name,'argv':args,'exitCode':result.returncode,'logSha256':sha(log)})
 (r/'build-receipt.json').write_text(json.dumps(checks,indent=2)+'\n');print(checks[-1],flush=True)
 if result.returncode:raise SystemExit(result.returncode)
