from pathlib import Path
import json,hashlib,shutil,datetime
repo=Path('/Users/champ/orca/Napier');out=repo/'docs/artifacts/artifact-consumer-version-binding-2026-10-30';out.mkdir(parents=True,exist_ok=True)
index=out/'archive-manifest.json';old=json.loads(index.read_text()) if index.exists() else {'files':{}}
files=old['files']
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def copy(src,relative,origin=None):
 src=Path(src)
 if not src.is_file() or src.is_symlink():return
 target=out/relative;sha=digest(src)
 if target.exists() and digest(target)!=sha:target=target.with_name(target.stem+'--'+sha[:12]+target.suffix)
 target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,target)
 rel=str(target.relative_to(out));files[rel]={'sha256':sha,'bytes':target.stat().st_size,'originalPath':str(origin or src)}
def tree(src,relative):
 src=Path(src)
 for p in sorted(src.rglob('*')):
  if not p.is_file() or p.is_symlink() or any(x in {'node_modules','.git','dist'} for x in p.relative_to(src).parts):continue
  copy(p,Path(relative)/p.relative_to(src))
for v in (1,2,3):
 tree(f'/tmp/napier-g01-consumer-source-freeze-20261030-v{v}',f'owner/frozen-v{v}')
 copy(f'/tmp/napier-g01-consumer-handoff-20261030-v{v}.json',f'owner/handoff-v{v}.json')
 # Receipt snapshots retain their original /tmp identities in addition to frozen paths.
 hp=Path(f'/tmp/napier-g01-consumer-handoff-20261030-v{v}.json');h=json.loads(hp.read_text())
 for r in h.get('receipts',[]):
  p=Path(f'/tmp/napier-g01-consumer-source-freeze-20261030-v{v}/receipts')/Path(r['path']).name
  if p.is_file():copy(p,f'owner/frozen-v{v}/receipts/{p.name}',r['path'])
for p in sorted(Path('/tmp').glob('napier-g01-consumer-*')):
 if p.is_file():copy(p,'development/'+p.name)
for p in [Path('/tmp/napier-host-accounting-vitest-v6.config.mts'),Path('/tmp/napier-overlay-preserved-user-files-20261029.json'),Path('/tmp/napier-g03-agent-runtime-baseline-strict.log')]:copy(p,'development/'+p.name)
for name in ['before','candidate']:
 root=Path(f'/tmp/napier-g01-conversation-{name}-20261030')
 for p in root.iterdir():
  if p.is_file() and p.name not in {'package.json','package-lock.json','tsconfig.base.json'}:copy(p,f'projection/{name}/{p.name}')
 copy(f'/tmp/napier-g01-conversation-{name}-20261030.py',f'projection/{name}/setup.py')
 # The candidate v2 manifest exactly matches these bytes. Older v1 manifests remain historical records.
 manifest=json.loads(Path('/tmp/napier-g01-conversation-candidate-20261030/source-manifest-v2.json').read_text())
 for p in manifest['files']:copy(root/p,f'projection/{name}/source/{p}')
tree('/tmp/napier-g01-conversation-adversarial-20261030','projection/independent-review')
for source in sorted(Path('/tmp').glob('napier-g01-consumer-integrated-result-v*-20261030')):
 if (source/'regression.json').exists():
  v=source.name.split('-result-v')[1].split('-')[0];tree(source,f'integration/result-v{v}')
for source in sorted(Path('/tmp').glob('napier-g01-consumer-browser-result-v*-20261030')):
 if not source.is_dir() or not (source/'receipt.json').exists():continue
 receipt=json.loads((source/'receipt.json').read_text())
 if not receipt.get('finishedAt'):continue
 v=source.name.split('-result-v')[1].split('-')[0]
 tree(source,f'browser/result-v{v}')
 copy(f'/tmp/napier-g01-consumer-browser-result-v{v}-20261030.log',f'browser/result-v{v}/run.log')
# Preserve current browser build/source receipts without copying generated runtime directories.
root=Path('/tmp/napier-g01-consumer-browser-20261030')
for p in root.iterdir():
 if p.is_file() and (p.name.endswith('.log') or 'receipt' in p.name or p.name.startswith('focus-')):copy(p,'browser/build/'+p.name)
root=Path('/tmp/napier-g01-consumer-integrated-20261030')
for p in root.iterdir():
 if p.is_file() and p.name.startswith('focus-'):copy(p,'integration/focus/'+p.name)
index.write_text(json.dumps({'kind':'napier.artifact-consumer-archive','schemaVersion':1,'status':'draft-awaiting-final-provenance','generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'files':dict(sorted(files.items()))},indent=2)+'\n')
print(json.dumps({'archivedFiles':len(files),'bytes':sum(v['bytes'] for v in files.values()),'manifest':str(index)},indent=2))
