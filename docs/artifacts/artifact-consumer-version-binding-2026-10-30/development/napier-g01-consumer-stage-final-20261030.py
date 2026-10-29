from pathlib import Path
import json,hashlib,subprocess
w=Path('/Users/champ/orca/Napier');p=Path('/tmp/napier-g01-consumer-source-stage-20261030.json');m=json.load(open(p))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
assert subprocess.check_output(['git','diff','--cached','--name-only'],cwd=w,text=True)==''
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=w,text=True).strip()==m['baseHead']
assert all(sha(w/p)==h for p,h in m['files'].items())
protected=json.load(open('/tmp/napier-overlay-preserved-user-files-20261029.json'));assert all(sha(w/p)==h for p,h in protected.items());assert not set(protected)&set(m['files'])
assert json.load(open('/tmp/napier-g01-consumer-integrated-result-v5-20261030/regression.json'))['passedRequiredChecks']
assert json.load(open('/tmp/napier-g01-consumer-browser-final-verification-v9-20261030/verification.json'))['passed']
subprocess.run(['git','add','--',*sorted(m['files'])],cwd=w,check=True)
paths=subprocess.check_output(['git','diff','--cached','--name-only'],cwd=w,text=True).splitlines();assert paths==sorted(m['files'])
subprocess.run(['git','diff','--cached','--check'],cwd=w,check=True)
tree=subprocess.check_output(['git','write-tree'],cwd=w,text=True).strip();assert tree==m['tree']
print({'stagedFiles':len(paths),'tree':tree,'protectedUnchanged':len(protected)})
