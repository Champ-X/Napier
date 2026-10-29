from pathlib import Path
import json,hashlib,datetime,subprocess
w=Path('/Users/champ/orca/Napier');r=Path('/private/tmp/napier-g01-consumer-integrated-20261030');prior=Path('/tmp/napier-g01-consumer-integrated-result-v3-20261030/regression.json');d=json.loads(prior.read_text());o=Path('/tmp/napier-g01-consumer-integrated-result-v4-20261030');o.mkdir()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
m=json.load(open('/tmp/napier-g01-consumer-source-stage-20261030.json'));assert all(sha(w/p)==h and sha(r/p)==h for p,h in m['files'].items());assert subprocess.check_output(['git','write-tree'],cwd=r,text=True).strip()==m['tree'];subprocess.run(['git','diff','--cached','--check'],cwd=r,check=True)
old=json.load(open('/tmp/napier-g01-consumer-integrated-result-v2-20261030/source-after.json'));delta=[p for p,h in old.items() if sha(r/p)!=h];assert set(delta)=={'apps/web/src/workbench-overlay-focus.ts','apps/web/test/workbench-overlay-suspension.test.tsx'},delta
emit=json.load(open('/tmp/napier-g01-consumer-integrated-result-v2-20261030/emitted-after.json'));assert all(sha(r/p)==h for p,h in emit.items())
reports=[Path(v['path']) for v in d['testReports'].values()]+[Path('/tmp/napier-g01-consumer-focus-after-v2-20261030.json')]
cases={};files=set()
for p in reports:
 j=json.load(open(p));assert j['numFailedTests']==0
 for t in j['testResults']:
  assert t['status']=='passed';name=t['name'].removeprefix(str(r)+'/');files.add(name)
  for a in t['assertionResults']:assert a['status']=='passed';cases[(name,a['fullName'])]=a['status']
source={p:sha(r/p) for p in old};(o/'source-after.json').write_text(json.dumps(source,indent=2)+'\n')
for name,log,code,required in [('strict-tests','/tmp/napier-g01-consumer-focus-strict-20261030.log',0,True),('architecture','/tmp/napier-g01-consumer-focus-architecture-20261030.log',1,False)]:
 d['checks']=[c for c in d['checks'] if c['name']!=name];d['checks'].append({'name':name,'log':log,'logSha256':sha(Path(log)),'exitCode':code,'required':required,'cwd':str(r),'phase':'after focus correction'})
assert Path('/tmp/napier-g01-consumer-focus-architecture-20261030.log').read_bytes()==Path('/tmp/napier-g01-consumer-integrated-result-v2-20261030/architecture.log').read_bytes()
d['stagedTree']=m['tree'];d['stagedSourceManifest']=m;d['generatedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();d['uniqueFinalAssertions']={'files':len(files),'passed':len(cases),'failed':0,'skipped':0,'reports':[{'path':str(p),'sha256':sha(p)} for p in reports],'deduplication':'test path relative to snapshot plus fullName; latest repeated test report replaces earlier result'}
d['incrementalValidation']={'prior':str(prior),'priorSha256':sha(prior),'changedSourceFiles':delta,'additionalFunctionalReport':str(reports[-1]),'beforeReport':'/tmp/napier-g01-consumer-focus-before-20261030.json','reason':'Observed production-browser focus loss; reject body/html return targets, validate fallback and overlay state. Existing artifact suspension fixture now carries exact selected revision/path digest. Backend emissions unchanged.'}
d['sourceAfterManifest']={'path':str(o/'source-after.json'),'sha256':sha(o/'source-after.json')};d['sourceDrift']=[];d['stagedWorkspaceDrift']=[];d['passedRequiredChecks']=all(c['exitCode']==0 for c in d['checks'] if c['required'])
(o/'regression.json').write_text(json.dumps(d,indent=2)+'\n');print({'passed':d['passedRequiredChecks'],'uniqueFiles':len(files),'uniqueCases':len(cases),'sourceFiles':m['fileCount'],'tree':m['tree']})
