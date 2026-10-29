import pathlib,hashlib,json,subprocess,datetime,concurrent.futures,re,sys,collections
root=pathlib.Path('/Users/champ/orca/Napier')
base=pathlib.Path(sys.argv[1]);base.mkdir(parents=True,exist_ok=False)
node=subprocess.check_output(['which','node'],text=True).strip()
def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def manifest(folders, extra=()):
    paths=set()
    for folder in folders: paths.update(p for p in (root/folder).rglob('*') if p.is_file() and not p.name.endswith('.tsbuildinfo'))
    paths.update(root/p for p in extra)
    return {str(p.relative_to(root)):digest(p) for p in sorted(paths) if p.is_file()}
def save(name,value): (base/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
def check(name,argv,required=True,cwd=root):
    started=datetime.datetime.now(datetime.timezone.utc).isoformat()
    with (base/(name+'.log')).open('w') as log: result=subprocess.run(argv,cwd=cwd,stdout=log,stderr=subprocess.STDOUT)
    r={'name':name,'argv':argv,'cwd':str(cwd),'required':required,'exitCode':result.returncode,'startedAt':started,'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'log':str(base/(name+'.log')),'logSha256':digest(base/(name+'.log'))}
    print(json.dumps({'name':name,'exitCode':result.returncode}),flush=True);return r
source_dirs=['packages/contracts/src','packages/runtime/src','packages/runtime/test','apps/server/src','apps/server/test','apps/web/src','apps/web/test','scripts']
configs=['package.json','package-lock.json','tsconfig.base.json','packages/contracts/package.json','packages/contracts/tsconfig.json','packages/runtime/package.json','packages/runtime/tsconfig.json','apps/server/package.json','apps/server/tsconfig.json','apps/web/tsconfig.json','docs/architecture-budget.json']
before=manifest(source_dirs,configs);save('source-before.json',before)
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
preserved=json.load(open('/tmp/napier-overlay-preserved-user-files-20261029.json'))
checks=[]
checks.append(check('contracts-runtime-emit',[node,str(root/'node_modules/typescript/bin/tsc'),'-b','packages/runtime','--force']))
checks.append(check('server-emit',[node,str(root/'node_modules/typescript/bin/tsc'),'-p','apps/server/tsconfig.json']))
if any(c['exitCode'] for c in checks): save('compile-failure.json',checks);sys.exit(1)
emitted=manifest(['packages/contracts/dist','packages/runtime/dist','apps/server/dist']);save('emitted-before.json',emitted)
pattern=r'^(agent-runtime|local-agent-runtime|models\.test|model-(accounting|usage|adapters|call-admission|session|invocation)|subagent-(model|child|context|checkpoint|continuation|completion|working|outcome)|run-(budget|context-compaction|recovery-checkpoint)|replay-evaluation|evaluation-|independent-model-advisor|context-compaction-workbench|store(-run-usage|-event-idempotency|-compatibility-projections|-snapshot-consistency)?\.test|sqlite-ledger-migration|thread-bundles|blueprint-outcome-review|replan-review)'
runtime=sorted(str(p.relative_to(root)) for p in (root/'packages/runtime/test').glob('*.test.ts') if re.search(pattern,p.name))
server=sorted(str(p.relative_to(root)) for p in (root/'apps/server/test').glob('workspace-model-*.test.ts'))+['apps/server/test/workspace-runtime-host.test.ts','apps/server/test/context-compaction-http.test.ts','apps/server/test/evaluation-http-validation.test.ts']
strict_paths=sorted({str(root/p) for p in subprocess.check_output(['git','ls-files','-m','--others','--exclude-standard','packages/runtime/test','apps/server/test'],cwd=root,text=True).splitlines() if p.endswith('.ts')})
legacy=str(root/'packages/runtime/test/agent-runtime.test.ts')
strict_paths=[p for p in strict_paths if p!=legacy]
strict={'extends':str(root/'tsconfig.base.json'),'compilerOptions':{'noEmit':True,'composite':False,'declaration':False,'declarationMap':False,'rootDir':str(root),'typeRoots':[str(root/'node_modules/@types')]},'files':strict_paths,'include':[]}
save('strict-tests.json',strict)
legacy_strict={**strict,'files':[legacy]};save('legacy-strict-tests.json',legacy_strict)
save('selected-tests.json',{'runtime':runtime,'server':server,'strictFiles':strict_paths})
vitest=[node,str(root/'node_modules/vitest/vitest.mjs'),'run']
jobs=[('runtime-tests',vitest+runtime+['--maxWorkers=2','--testTimeout=30000','--reporter=json','--outputFile='+str(base/'runtime.json')],True),('server-tests',vitest+server+['--maxWorkers=2','--testTimeout=30000','--reporter=json','--outputFile='+str(base/'server.json')],True),('strict-tests',[node,str(root/'node_modules/typescript/bin/tsc'),'-p',str(base/'strict-tests.json')],True),('legacy-strict-tests',[node,str(root/'node_modules/typescript/bin/tsc'),'-p',str(base/'legacy-strict-tests.json')],False),('web-types',[node,str(root/'node_modules/typescript/bin/tsc'),'-p','apps/web/tsconfig.json','--noEmit'],True),('harness-types',[node,str(root/'node_modules/typescript/bin/tsc'),'-p','packages/harness-eval/tsconfig.json','--noEmit'],True),('benchmark-types',[node,str(root/'node_modules/typescript/bin/tsc'),'-p','packages/benchmark-kit/tsconfig.json','--noEmit'],True),('architecture',[node,'scripts/check-architecture.mjs'],False),('public-api',[node,'scripts/check-public-api.mjs'],False),('diff-check',['git','diff','--check'],True)]
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool: checks.extend(pool.map(lambda j:check(*j),jobs))
def diagnostics(text):
    parts=re.split(r'(?=^[^\n]+\(\d+,\d+\): error TS)',text,flags=re.M)
    return collections.Counter(re.sub(r'^[^\n]+\(\d+,\d+\): ', '',p).strip() for p in parts if p.strip())
legacy_baseline=pathlib.Path('/tmp/napier-g03-agent-runtime-baseline-strict.log')
old=diagnostics(legacy_baseline.read_text());current=diagnostics((base/'legacy-strict-tests.log').read_text())
legacy_result={'baselineHead':'d2e33ac341f19bbefd112c27a1d254075c6f4287','baselineLog':str(legacy_baseline),'baselineSha256':digest(legacy_baseline),'baselineCount':sum(old.values()),'currentCount':sum(current.values()),'sameNormalizedDiagnosticMultiset':old==current,'added':list((current-old).elements()),'removed':list((old-current).elements()),'normalization':'strip file path and line,column, retain full error code/message/continuations with multiplicity'}
save('legacy-strict-baseline-comparison.json',legacy_result)
checks.append({'name':'legacy-strict-baseline-nonregression','required':True,'exitCode':0 if old==current else 1,'log':str(base/'legacy-strict-baseline-comparison.json'),'logSha256':digest(base/'legacy-strict-baseline-comparison.json')})
after=manifest(source_dirs,configs);emitted_after=manifest(['packages/contracts/dist','packages/runtime/dist','apps/server/dist'])
save('source-after.json',after);save('emitted-after.json',emitted_after)
def changes(a,b):return [p for p in sorted(a.keys()|b.keys()) if a.get(p)!=b.get(p)]
counts=[]
for name in ['runtime','server']:
    p=base/(name+'.json')
    if p.exists():
        report=json.load(open(p));counts.append({'suite':name,'files':len(report['testResults']),'total':report['numTotalTests'],'passed':report['numPassedTests'],'failed':report['numFailedTests'],'skipped':report['numPendingTests']})
result={'kind':'napier.model-physical-usage-regression','schemaVersion':1,'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'head':head,'cwd':str(root),'node':subprocess.check_output([node,'--version'],text=True).strip(),'providerMode':'local faux and loopback HTTP only; no external model calls','checks':checks,'testCounts':counts,'sourceCount':len(before),'emittedCount':len(emitted),'sourceDrift':changes(before,after),'emittedDrift':changes(emitted,emitted_after),'preservedUserFiles':{'count':len(preserved),'changed':[p for p,h in preserved.items() if not (root/p).is_file() or digest(root/p)!=h]}}
result['passedRequiredChecks']=all(c['exitCode']==0 for c in checks if c['required']) and not result['sourceDrift'] and not result['emittedDrift'] and not result['preservedUserFiles']['changed']
save('regression.json',result);print(json.dumps({k:v for k,v in result.items() if k!='checks'},ensure_ascii=False,indent=2),flush=True)
