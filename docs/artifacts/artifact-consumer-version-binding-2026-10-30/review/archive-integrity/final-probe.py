#!/usr/bin/env python3
from pathlib import Path
import argparse,copy,hashlib,json,shutil,subprocess,tempfile
p=argparse.ArgumentParser();p.add_argument('archive',type=Path);p.add_argument('--repo',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
root=Path(tempfile.mkdtemp(prefix='napier-g01-final-archive-review-'));r=root/'archive';shutil.copytree(a.archive,r);script=r/'tools/reconcile.py';original={str(p.relative_to(r)):p.read_bytes() for p in r.rglob('*') if p.is_file()};results=[]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def read(name):return json.loads((r/name).read_text())
def restore():
 for name,data in original.items():(r/name).write_bytes(data)
 for p in r.rglob('*'):
  if p.is_file() and str(p.relative_to(r)) not in original:p.unlink()
def write(name,value,index=True):
 (r/name).parent.mkdir(parents=True,exist_ok=True);(r/name).write_text(json.dumps(value,indent=2)+'\n')
 if index:
  manifest=read('archive-manifest.json');manifest['files'][name]['sha256']=sha(r/name);manifest['files'][name]['bytes']=(r/name).stat().st_size;(r/'archive-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
def run(name,live=False):
 args=['python3',str(script),'--archive',str(r)]+(['--source-root',str(a.repo)] if live else [])
 p=subprocess.run(args,cwd='/',capture_output=True,text=True,timeout=20);(a.output/(name+'.stdout.json')).write_text(p.stdout);(a.output/(name+'.stderr.json')).write_text(p.stderr)
 value=json.loads(p.stdout) if p.stdout else {'error':p.stderr};results.append({'probe':name,'exitCode':p.returncode,**value})
run('relocated-sealed');run('relocated-live-source',True)
s=read('review-summary.json');f=read(s['functionalRegression']);write('unindexed-result.json',f,index=False);s['functionalRegression']='unindexed-result.json';write('review-summary.json',s);run('unindexed-semantic-reference');restore()
s=read('review-summary.json');f=read(s['functionalRegression']);m=read('archive-manifest.json');ref=f['sourceAfterManifest'];name=next(k for k,v in m['files'].items() if v.get('originalPath')==ref['path'] and v['sha256']==ref['sha256']);sources=read(name);del sources['apps/web/src/artifact-consumer-responsive.css'];write(name,sources);f['sourceAfterManifest']['sha256']=sha(r/name);write(s['functionalRegression'],f);run('missing-final-css-source-map');restore()
s=read('review-summary.json');name=s['browserProvenance']['verification'];v=read(name);v['sourceManifest']['files']['apps/web/src/artifact-consumer-responsive.css']='0'*64;write(name,v);run('browser-wrong-source-manifest');restore()
s=read('review-summary.json');name=s['browserProvenance']['verification'];v=read(name);v['scriptSha256']='0'*64;write(name,v);run('browser-wrong-script-binding');restore()
s=read('review-summary.json');name=s['browserProvenance']['emittedAfter'];v=read(name);v['apps/web/dist/index.html']='0'*64;write(name,v);run('browser-emitted-drift');restore()
s=read('review-summary.json');name=s['finalBrowserReceipt'];v=read(name);v['cases']=v['cases'][:-1];write(name,v);bn=s['browserProvenance']['verification'];b=read(bn);b['receiptSha256']=sha(r/name);write(bn,b);run('browser-declared-count-mismatch');restore()
commit=read('review-summary.json')['implementationCommit'];stage=read(read('review-summary.json')['sourceManifest']);commit_mismatches=[]
for name,expected in stage['files'].items():
 p=subprocess.run(['git','show',commit+':'+name],cwd=a.repo,capture_output=True)
 if p.returncode or hashlib.sha256(p.stdout).hexdigest()!=expected:commit_mismatches.append(name)
report={'root':str(root),'sourceArchive':str(a.archive),'scriptSha256':sha(script),'commit':commit,'commitFiles':len(stage['files']),'commitMismatches':commit_mismatches,'probes':results}
(a.output/'probe-summary.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'output':str(a.output),'scriptSha256':report['scriptSha256'],'commitFiles':len(stage['files']),'commitMismatches':commit_mismatches,'outcomes':[(r['probe'],r['exitCode']) for r in results]},indent=2))
