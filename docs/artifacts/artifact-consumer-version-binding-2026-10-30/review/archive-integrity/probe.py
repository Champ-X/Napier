#!/usr/bin/env python3
"""Independent probes; mutations occur only in a temporary copied archive."""
from pathlib import Path
import argparse,hashlib,json,shutil,subprocess,tempfile
p=argparse.ArgumentParser();p.add_argument('archive',type=Path);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
root=Path(tempfile.mkdtemp(prefix='napier-g01-archive-independent-'));copy=root/'archive';shutil.copytree(a.archive,copy);a.output.mkdir(parents=True,exist_ok=True)
script=copy/'tools/reconcile.py';summary0=json.loads((copy/'review-summary.json').read_text());results=[]
def run(name):
 result=subprocess.run(['python3',str(script),'--archive',str(copy),'--allow-draft'],cwd='/',capture_output=True,text=True)
 (a.output/(name+'.stdout.json')).write_text(result.stdout);(a.output/(name+'.stderr.txt')).write_text(result.stderr)
 parsed=json.loads(result.stdout) if result.stdout else {'error':result.stderr}
 results.append({'probe':name,'exitCode':result.returncode,**parsed})
def summary(value):(copy/'review-summary.json').write_text(json.dumps(value))
run('relocated-original')
regression=json.loads((copy/summary0['functionalRegression']).read_text());regression['stagedSourceManifest']['files']={};regression['stagedSourceManifest']['fileCount']=0
(copy/'unindexed-regression.json').write_text(json.dumps(regression));summary({**summary0,'functionalRegression':'unindexed-regression.json'});run('unindexed-functional-reference')
(copy/'unindexed-browser-pass.json').write_text(json.dumps({'status':'passed','paidModelCalls':0,'screenshots':[]}));summary({**summary0,'finalBrowserReceipt':'unindexed-browser-pass.json'});run('unindexed-browser-reference')
summary(summary0)
manifest=json.loads((copy/'archive-manifest.json').read_text());artifact=next(name for name in manifest['files'] if name.endswith('.log'))
with (copy/artifact).open('ab') as f:f.write(b'\nINDEPENDENT HASH FAILURE PROBE\n')
run('tampered-indexed-artifact')
report={'root':str(root),'scriptSha256':hashlib.sha256(script.read_bytes()).hexdigest(),'sourceArchive':str(a.archive),'probes':results}
(a.output/'probe-summary.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'output':str(a.output),'scriptSha256':report['scriptSha256'],'outcomes':[(r['probe'],r['exitCode']) for r in results]},indent=2))
