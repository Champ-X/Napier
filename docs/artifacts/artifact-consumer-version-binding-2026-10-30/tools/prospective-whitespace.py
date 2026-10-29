from pathlib import Path
import tempfile,subprocess,os,hashlib,json,re,sys,datetime
repo=Path('/Users/champ/orca/Napier');target=Path(sys.argv[1])
paths=[p for p in [repo/'docs/artifact-consumer-version-binding.md',repo/'docs/artifacts/artifact-consumer-version-binding-regression-2026-10-30.json',repo/'docs/artifacts/artifact-consumer-version-binding-evidence-index-2026-10-30.json'] if p.exists()]
paths += [p for p in (repo/'docs/artifacts/artifact-consumer-version-binding-2026-10-30').rglob('*') if p.is_file()]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
files={str(p.relative_to(repo)):sha(p) for p in sorted(paths)}
index=Path(subprocess.check_output(['git','rev-parse','--git-path','index'],cwd=repo,text=True).strip());index=index if index.is_absolute() else repo/index;before=sha(index)
with tempfile.TemporaryDirectory(prefix='napier-g01-docs-index-') as folder:
 env=os.environ.copy();env['GIT_INDEX_FILE']=str(Path(folder)/'index')
 subprocess.run(['git','read-tree','HEAD'],cwd=repo,env=env,check=True,capture_output=True)
 staged=subprocess.run(['git','add','--',*files],cwd=repo,env=env,capture_output=True,text=True)
 setup={'exitCode':staged.returncode,'stderr':staged.stderr}
 if staged.returncode:subprocess.run(['git','add','-f','--',*files],cwd=repo,env=env,check=True,capture_output=True)
 result=subprocess.run(['git','diff','--cached','--check','--',*files],cwd=repo,env=env,capture_output=True,text=True)
 tree=subprocess.check_output(['git','write-tree'],cwd=repo,env=env,text=True).strip()
assert sha(index)==before,'Main index changed during scan'
assert all(sha(repo/p)==h for p,h in files.items()),'Docs changed during scan'
raw=result.stdout+result.stderr
entries=[]
for line in raw.splitlines():
 m=re.match(r'^(.*):(\d+): (.*)\.$',line)
 if m:entries.append({'path':m.group(1),'line':int(m.group(2)),'type':m.group(3),'sha256':files.get(m.group(1))})
data={'kind':'napier.artifact-consumer-prospective-doc-whitespace','generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'baseHead':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),'temporaryIndexTree':tree,'mainIndexUnchanged':True,'temporaryIndexSetup':setup,'exitCode':result.returncode,'diagnostics':entries,'rawOutput':raw,'rawOutputSha256':hashlib.sha256(raw.encode()).hexdigest(),'files':files,'policy':'Historical raw evidence bytes remain unchanged. This receipt discloses prospective Git whitespace diagnostics; it does not suppress the Git check.'}
target.write_text(json.dumps(data,indent=2)+'\n');print(json.dumps({'fileCount':len(files),'exitCode':result.returncode,'diagnosticCount':len(entries),'diagnostics':entries[:40],'mainIndexUnchanged':True},indent=2))
