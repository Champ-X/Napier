from pathlib import Path
import json,hashlib,shutil,datetime
repo=Path('/Users/champ/orca/Napier');r=repo/'docs/artifacts/artifact-consumer-version-binding-2026-10-30';m=json.loads((r/'archive-manifest.json').read_text())
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def add(src,name):
 src=Path(src);out=r/name;out.parent.mkdir(parents=True,exist_ok=True)
 if out.exists():assert sha(out)==sha(src),(src,out)
 else:shutil.copy2(src,out)
 m['files'][name]={'sha256':sha(out),'bytes':out.stat().st_size,'originalPath':str(src)}
def tree(src,name):
 src=Path(src)
 for p in sorted(src.rglob('*')):
  if p.is_file() and not p.is_symlink():add(p,str(Path(name)/p.relative_to(src)))
stage=Path('/tmp/napier-g01-consumer-source-stage-20261030.json');d=json.loads(stage.read_text());add(stage,'final/source-manifest.json')
for name,h in d['files'].items():
 p=Path(d['snapshot'])/name;assert sha(p)==h;add(p,'final/source/'+name)
tree('/tmp/napier-g01-consumer-browser-final-verification-v9-20261030','browser/final-verification-v9')
tree('/tmp/napier-g01-consumer-browser-top-capture-20261030','browser/supplementary-en320')
add('/tmp/napier-g01-consumer-final-review-20261030.json','final/review.json')
add('/tmp/napier-g01-consumer-browser-20261030.mjs','browser/final/script.mjs')
for name in ['apps/server/dist/index.js','apps/web/dist/index.html']:add(Path('/tmp/napier-g01-consumer-browser-20261030')/name,'browser/final/entries/'+name)
add('/tmp/napier-g01-consumer-seal-20261030.py','development/napier-g01-consumer-seal-20261030.py')
s=json.loads((r/'review-summary.json').read_text());s.update(status='sealed',implementationCommit='c3734a07f1abc93357f2becf8e255c35d60dbce3',implementationTree=d['tree'],functionalRegression='integration/result-v5/regression.json',sourceManifest='final/source-manifest.json',sourceSnapshot='final/source',finalBrowserReceipt='browser/result-v9/receipt.json',pending=[])
s['browserProvenance']={'verification':'browser/final-verification-v9/verification.json','protectedOverlayManifest':'development/napier-overlay-preserved-user-files-20261029.json','sourceBefore':'browser/final-verification-v9/source-before.json','sourceAfter':'browser/final-verification-v9/source-after.json','emittedBefore':'browser/final-verification-v9/emitted-before.json','emittedAfter':'browser/final-verification-v9/emitted-after.json','buildReceipt':'browser/build/build-receipt.json','entryArtifacts':{'serverSha256':'browser/final/entries/apps/server/dist/index.js','webIndexSha256':'browser/final/entries/apps/web/dist/index.html'},'script':'browser/final/script.mjs','visualReview':'final/review.json'}
s['browserCounts']={'uniqueScenarios':7,'acceptedScreenshots':11,'supplementaryUniqueScenarios':0,'themes':['light'],'locales':['en','zh'],'widths':[320,390,1440]}
s['boundaries'] += ['Version mismatch cases perturb a UI response while recomputing its transport body digest; they are not new native ledger receipts. All other final fixtures use native LocalStore.','The supplementary EN320 block:start screenshot repeats an accepted scenario and is excluded from unique scenario count.','Functional503 is a deduplicated incremental consolidation; CSS plus stylesheet imports reused existing assertions after strict source/test and web-design checks, with browser layout acceptance.']
s['historicalFailures'] += ['Browser v5 verified focus fallback then exposed clipped EN320 filename/inspector controls; scoped responsive CSS fixed them.','Browser v6 historical-response route did not intercept bootstrap; perturbations remained empty.','Browser v7 modified bootstrap without updating transport digest, so the response was correctly rejected and no card appeared; initialization was also restricted to the top window.','Browser v8 later-revision response retained an old transport digest and was correctly rejected by the earlier hash guard; v9 updates the transport digest to exercise the intended version check.']
(r/'review-summary.json').write_text(json.dumps(s,indent=2)+'\n')
for name in ['review-summary.json','tools/reconcile.py']:
 p=r/name;m['files'][name]={'sha256':sha(p),'bytes':p.stat().st_size,'origin':'authored_evidence'}
m.update(status='sealed',generatedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),implementationCommit=s['implementationCommit']);(r/'archive-manifest.json').write_text(json.dumps(m,indent=2)+'\n')
print({'files':len(m['files']),'sourceFiles':d['fileCount'],'status':m['status']})
