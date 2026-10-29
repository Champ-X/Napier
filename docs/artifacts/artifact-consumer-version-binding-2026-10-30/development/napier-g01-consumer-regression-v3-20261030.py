from pathlib import Path
import json,subprocess,hashlib,concurrent.futures,datetime
r=Path('/private/tmp/napier-g01-consumer-integrated-20261030');old=Path('/tmp/napier-g01-consumer-integrated-result-v2-20261030');out=Path('/tmp/napier-g01-consumer-integrated-result-v3-20261030');out.mkdir()
d=json.load(open(old/'regression.json'));selected=json.load(open(old/'selected-tests.json'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def check(name):
 argv=['node',str(r/'node_modules/vitest/vitest.mjs'),'run','--dir',{'runtime':'packages/runtime/test','server':'apps/server/test'}[name],*selected[name],'--maxWorkers=2','--testTimeout=30000','--reporter=json','--outputFile='+str(out/(name+'.json'))]
 p=out/(name+'-tests.log');start=datetime.datetime.now(datetime.timezone.utc).isoformat()
 with p.open('w') as f:x=subprocess.run(argv,cwd=r,stdout=f,stderr=subprocess.STDOUT)
 return {'name':name+'-tests','argv':argv,'cwd':str(r),'required':True,'exitCode':x.returncode,'startedAt':start,'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'log':str(p),'logSha256':sha(p)}
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:new=list(pool.map(check,['runtime','server']))
d['checks']=[next((x for x in new if x['name']==c['name']),c) for c in d['checks']]
d['testCounts']=[];d['testReports']={}
for name in ['runtime','server','web','cli']:
 p=(out if name in ['runtime','server'] else old)/(name+'.json');j=json.load(open(p));d['testCounts'].append({'suite':name,'files':len(j['testResults']),'total':j['numTotalTests'],'passed':j['numPassedTests'],'failed':j['numFailedTests'],'skipped':j['numPendingTests']});d['testReports'][name]={'path':str(p),'sha256':sha(p)}
for category,filename in [('source','source-after.json'),('emitted','emitted-after.json')]:
 previous=json.load(open(old/filename));changed=[p for p,h in previous.items() if not (r/p).is_file() or sha(r/p)!=h];assert not changed,changed
d['consolidatedFrom']={'path':str(old/'regression.json'),'sha256':sha(old/'regression.json'),'reason':'Retain unchanged successful build/type/web/CLI/gate checks; rerun only runtime and server with explicit test search directories after Vitest matched archived source copies.'}
d['generatedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();d['passedRequiredChecks']=all(c['exitCode']==0 for c in d['checks'] if c['required']) and not any(d[k] for k in ['sourceDrift','emittedDrift','stagedWorkspaceDrift']) and not d['preservedUserFiles']['changed']
(out/'regression.json').write_text(json.dumps(d,indent=2)+'\n');print(json.dumps({'passed':d['passedRequiredChecks'],'testCounts':d['testCounts'],'newChecks':new},indent=2))
