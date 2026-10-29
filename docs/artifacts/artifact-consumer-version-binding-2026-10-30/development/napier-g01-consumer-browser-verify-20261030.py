from pathlib import Path
import subprocess,json,hashlib,datetime
w=Path('/Users/champ/orca/Napier');r=Path('/private/tmp/napier-g01-consumer-browser-20261030');out=Path('/tmp/napier-g01-consumer-browser-final-verification-v9-20261030');out.mkdir()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def manifest(folders):return {str(p.relative_to(r)):sha(p) for folder in folders for p in sorted((r/folder).rglob('*')) if p.is_file()}
sourceFolders=['packages/contracts/src','packages/runtime/src','apps/server/src','apps/web/src','apps/web/test'];emitFolders=['packages/contracts/dist','packages/runtime/dist','apps/server/dist','apps/web/dist']
sources=manifest(sourceFolders);emitted=manifest(emitFolders);stage=json.load(open('/tmp/napier-g01-consumer-source-stage-20261030.json'));protected=json.load(open('/tmp/napier-overlay-preserved-user-files-20261029.json'))
assert all(sha(r/p)==h for p,h in stage['files'].items());assert all(sha(w/p)==h and sha(r/p)==h for p,h in protected.items())
for name,data in [('source-before.json',sources),('emitted-before.json',emitted)]: (out/name).write_text(json.dumps(data,indent=2)+'\n')
args=['node','/tmp/napier-g01-consumer-browser-20261030.mjs',str(r),'/tmp/napier-g01-consumer-browser-result-v9-20261030'];start=datetime.datetime.now(datetime.timezone.utc).isoformat()
with Path('/tmp/napier-g01-consumer-browser-result-v9-20261030.log').open('w') as f:x=subprocess.run(args,cwd=w,stdout=f,stderr=subprocess.STDOUT)
after=manifest(sourceFolders);emitAfter=manifest(emitFolders)
for name,data in [('source-after.json',after),('emitted-after.json',emitAfter)]: (out/name).write_text(json.dumps(data,indent=2)+'\n')
receipt=Path('/tmp/napier-g01-consumer-browser-result-v9-20261030/receipt.json');b=json.load(open(receipt));entry=b.get('productionEntry',{})
d={'snapshot':str(r),'sourceManifest':stage,'protectedOverlay':protected,'command':args,'startedAt':start,'exitCode':x.returncode,'sourceCount':len(sources),'emittedCount':len(emitted),'sourceStable':sources==after,'emittedStable':emitted==emitAfter,'scriptSha256':sha(Path(args[1])),'receipt':str(receipt),'receiptSha256':sha(receipt),'productionEntryHashesMatch':entry.get('serverSha256')==sha(r/'apps/server/dist/index.js') and entry.get('webIndexSha256')==sha(r/'apps/web/dist/index.html'),'builds':{'initial':str(r/'build-receipt.json'),'finalWebLog':'/tmp/napier-g01-consumer-browser-build-v4-20261030.log','finalWebLogSha256':sha(Path('/tmp/napier-g01-consumer-browser-build-v4-20261030.log'))},'passed':x.returncode==0 and sources==after and emitted==emitAfter}
(out/'verification.json').write_text(json.dumps(d,indent=2)+'\n');print({k:d[k] for k in ['exitCode','sourceCount','emittedCount','sourceStable','emittedStable','productionEntryHashesMatch','passed']})
