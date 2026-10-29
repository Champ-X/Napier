from pathlib import Path
import json,hashlib,subprocess,shutil
w=Path('/Users/champ/orca/Napier');r=Path('/private/tmp/napier-g01-consumer-integrated-20261030');mp=Path('/tmp/napier-g01-consumer-source-stage-20261030.json');old=json.loads(mp.read_text());shutil.copy2(mp,mp.with_name('napier-g01-consumer-source-stage-v1-20261030.json'))
hp=Path('/tmp/napier-g01-consumer-handoff-20261030-v3.json');h=json.loads(hp.read_text())
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
for f in h['ownedFiles']:assert sha(w/f['path'])==f['sha256'],f['path']
p=w/'docs/architecture-budget.json';s=p.read_text();assert '"apps/web/test/api.test.ts": 2488,' in s;p.write_text(s.replace('"apps/web/test/api.test.ts": 2488,','"apps/web/test/api.test.ts": 2393,'))
files=sorted(set(old['files'])|{f['path'] for f in h['ownedFiles']}|{'docs/architecture-budget.json'})
for f in files:shutil.copy2(w/f,r/f)
subprocess.run(['git','add','--',*files],cwd=r,check=True)
m={**old,'tree':subprocess.check_output(['git','write-tree'],cwd=r,text=True).strip(),'files':{f:sha(r/f) for f in files},'fileCount':len(files),'consumerHandoff':str(hp),'consumerHandoffSha256':sha(hp),'architectureBudgetChange':'Tighten api.test line override 2488 to 2393 after extracting download API tests'}
mp.write_text(json.dumps(m,indent=2)+'\n')
s=json.loads((r/'strict-tests.json').read_text());s['include']=sorted(set(s['include'])|{str(r/f) for f in files if '/test/' in f and f.endswith(('.ts','.tsx'))});(r/'strict-tests.json').write_text(json.dumps(s,indent=2)+'\n')
p=Path('/tmp/napier-g01-consumer-regression-v2-20261030.py');s=p.read_text().replace('artifact-version|task-', 'artifact-file-download-api|artifact-version|task-');p.write_text(s)
print({'files':len(files),'tree':m['tree'],'strictIncludes':len(json.loads((r/'strict-tests.json').read_text())['include'])})
