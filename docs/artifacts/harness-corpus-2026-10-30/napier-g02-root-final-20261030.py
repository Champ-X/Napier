import datetime, hashlib, json, pathlib, subprocess, tempfile

root = pathlib.Path('/Users/champ/orca/Napier')
out = root / 'docs/artifacts/harness-corpus-regression-2026-10-30.json'
assert not out.exists()
raw = pathlib.Path(tempfile.mkdtemp(prefix='napier-g02-root-final-'))
handoff = json.loads(pathlib.Path('/tmp/napier-g02-corpus-handoff-20261030.json').read_text())
sha = lambda p: hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
checks = []

def check(name, command):
    start = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with (raw / (name + '.log')).open('wb') as log:
        p = subprocess.run(command, cwd=root, stdout=log, stderr=subprocess.STDOUT)
    checks.append(dict(name=name, command=command, exitCode=p.returncode,
        startedAt=start, finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        log=str(raw / (name + '.log')), logSha256=sha(raw / (name + '.log'))))
    print(name, p.returncode, flush=True)
    return p.returncode

assert all(sha(root / p['path']) == p['sha256'] for p in handoff['ownedFiles'])
check('harness-compile', ['node','node_modules/typescript/bin/tsc','-p','packages/harness-eval/tsconfig.json','--pretty','false'])
check('harness-strict-test-types', ['node','node_modules/typescript/bin/tsc','-p','/tmp/napier-harness-corpus-strict-types.json','--pretty','false'])
paths = subprocess.check_output(['rg','--files','packages','apps','scripts','benchmarks','-g','*.ts','-g','*.tsx','-g','*.mjs','-g','*.json'], cwd=root, text=True).splitlines()
paths += ['package.json','package-lock.json','tsconfig.base.json','docs/architecture-budget.json']
paths = sorted(set(paths))
snapshot = lambda: {p:sha(root / p) for p in paths}
before = snapshot()
emitted_paths = sorted(p.relative_to(root).as_posix() for package in ['contracts','runtime','harness-eval'] for p in (root / 'packages' / package / 'dist').rglob('*') if p.is_file() and p.suffix in ['.js','.ts','.map'])
emitted_snapshot = lambda: {p:sha(root / p) for p in emitted_paths}
emitted_before = emitted_snapshot()
historical = 'docs/artifacts/harness-experiment-release-evidence-0.1.3.json'
historical_before = sha(root / historical)
check('read-only-corpus-inventory', ['node','scripts/check-harness-corpus-catalog.mjs'])
check('historical-contract-verification', ['node','scripts/create-harness-experiment-release-evidence.mjs','--verify',historical])
tests = handoff['commands']['focusedRegression'].split(' run ',1)[1].split(' --reporter=',1)[0].split()
report = raw / 'focused-tests.json'
check('focused-tests', ['node','node_modules/vitest/vitest.mjs','run',*tests,'--maxWorkers=2','--testTimeout=30000','--reporter=json',f'--outputFile={report}'])
check('new-local-contract-evidence', ['node','scripts/create-harness-experiment-release-evidence.mjs'])
new_receipt = 'docs/artifacts/harness-experiment-contract-evidence-0.1.5.json'
check('new-contract-verification', ['node','scripts/create-harness-experiment-release-evidence.mjs','--verify',new_receipt])
check('tracked-diff-check', ['git','diff','--check'])
after = snapshot()
emitted_after = emitted_snapshot()
preserved = json.loads(pathlib.Path('/tmp/napier-overlay-preserved-user-files-20261029.json').read_text())
preserved_drift = [p for p,digest in preserved.items() if sha(root / p) != digest]
drift = [p for p in paths if before[p] != after[p]]
emitted_drift = [p for p in emitted_paths if emitted_before[p] != emitted_after[p]]
parsed = json.loads(report.read_text())
content = dict(schemaVersion=1,kind='napier.harness-corpus-regression',generatedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
    root=str(root),head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),
    checks=checks,raw=str(raw),providerMode='local faux provider; no external model calls',externalModelCalls=0,
    tests=dict(files=len(parsed['testResults']),passed=parsed['numPassedTests'],failed=parsed['numFailedTests'],skipped=parsed['numPendingTests'],report=str(report),reportSha256=sha(report)),
    sourceManifest=before,sourceCount=len(before),sourceDrift=drift,emittedManifest=emitted_before,emittedCount=len(emitted_before),emittedDrift=emitted_drift,
    historical=dict(path=historical,sha256=historical_before,unchanged=sha(root / historical)==historical_before),
    newContractEvidence=dict(path=new_receipt,sha256=sha(root / new_receipt) if (root / new_receipt).is_file() else None),
    preserved=dict(count=len(preserved),changed=preserved_drift),releaseAccepted=False,
    passedRequiredChecks=all(c['exitCode']==0 for c in checks) and parsed['numFailedTests']==0 and parsed['numPendingTests']==0 and not drift and not emitted_drift and not preserved_drift and sha(root / historical)==historical_before,
    limitations=['Real catalog has zero holdout; no real unseen-family or live-quality claim.','The new receipt is deterministic contract-only evidence and cannot authorize release.','Existing 50 release fixture failures were independently reproduced at original HEAD, retained separately, and not counted as passing consumer coverage.','Architecture, public API and release source-manifest blockers remain.'])
content['contentSha256'] = hashlib.sha256(json.dumps(content,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
with out.open('x') as f: json.dump(content,f,indent=2,ensure_ascii=False); f.write('\n')
print(json.dumps({k:content[k] for k in ['passedRequiredChecks','tests','sourceCount','sourceDrift','emittedCount','emittedDrift','preserved']}), flush=True)
raise SystemExit(0 if content['passedRequiredChecks'] else 1)
