#!/usr/bin/env python3
"""Reconcile the retained G07 evidence without extraction, builds or model calls."""
import argparse
import collections
import hashlib
import json
import pathlib
import re
import tarfile


def digest(data):
    return hashlib.sha256(data).hexdigest()


def check(condition, message):
    if not condition:
        raise ValueError(message)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--index', type=pathlib.Path,
                        default=pathlib.Path(__file__).with_name('invocation-context-cursor-evidence-index-2026-10-30.json'))
    parser.add_argument('--workspace', type=pathlib.Path, help='Also compare the six implementation files in this checkout')
    parser.add_argument('--list', action='store_true', help='Print archive member names, sizes and SHA-256 digests')
    args = parser.parse_args()
    index_path = args.index.resolve()
    repo = index_path.parents[2]
    index = json.loads(index_path.read_bytes())
    for relative, entry in index['artifacts'].items():
        data = (repo / relative).read_bytes()
        check(len(data) == entry['bytes'] and digest(data) == entry['sha256'], 'Changed artifact: ' + relative)
    archive = repo / index['archive']['path']
    check(digest(archive.read_bytes()) == index['archive']['sha256'], 'Archive hash changed')
    found, documents, logs, fact_hashes = {}, {}, {}, {}
    with tarfile.open(archive, 'r:gz') as stream:
        for member in stream:
            name = pathlib.PurePosixPath(member.name)
            check(member.isfile() and not name.is_absolute() and '..' not in name.parts,
                  'Unsafe archive member: ' + member.name)
            check(member.name not in found, 'Duplicate archive member: ' + member.name)
            check(member.name in index['members'], 'Unindexed member: ' + member.name)
            expected = index['members'][member.name]
            check(member.size == expected['bytes'], 'Member size changed: ' + member.name)
            payload = stream.extractfile(member)
            check(payload is not None, 'Unreadable member: ' + member.name)
            data = payload.read()
            check(digest(data) == expected['sha256'], 'Member hash changed: ' + member.name)
            found[member.name] = expected
            if member.name.endswith('.json'):
                documents[member.name] = json.loads(data)
            if member.name.endswith('.log'):
                logs[member.name] = data.decode('utf8')
            if member.name.endswith('.facts.json'):
                fact_hashes[member.name] = digest(data.removesuffix(b'\n'))
            if args.list:
                print(expected['sha256'], expected['bytes'], member.name)
    check(set(found) == set(index['members']), 'Missing archive members')

    def measurement_name(original):
        value = original.removeprefix('/private')
        prefix = '/tmp/napier-g07-frozen-20261030-v1/'
        check(value.startswith(prefix), 'Unknown original measurement path: ' + original)
        return 'measurement/' + value[len(prefix):]

    original = documents['measurement/evidence-index.json']
    check(len(original['artifacts']) == 82, 'Original evidence inventory changed')
    for entry in original['artifacts']:
        name = measurement_name(entry['path'])
        check(found[name]['sha256'] == entry['sha256'] and found[name]['bytes'] == entry['bytes'],
              'Original measurement artifact differs: ' + name)
    freeze = documents['measurement/freeze-manifest.json']
    check(freeze['base'] == index['measurementBase'], 'Measurement baseline changed')
    for entry in freeze['owned']:
        check(found['candidate-source/' + entry['path']]['sha256'] == entry['sha256'], 'Frozen owned source differs')
        if args.workspace:
            check(digest((args.workspace / entry['path']).read_bytes()) == entry['sha256'],
                  'Current implementation differs: ' + entry['path'])

    observations = []
    for capture, expected_pairs in [('smoke', 24), ('full', 36)]:
        receipt = documents[f'measurement/{capture}/receipt.json']
        check(receipt['success'] and receipt['bindingsBefore'] == receipt['bindingsAfter'], 'Capture failed or changed bindings')
        check(receipt['base'] == index['measurementBase'], 'Capture baseline changed')
        for arm in receipt['bindingsBefore']['arms']:
            for tree in arm['trees']:
                encoded = json.dumps(tree['files'], ensure_ascii=False, separators=(',', ':')).encode()
                check(digest(encoded) == tree['sha256'], 'Captured tree manifest digest differs')
        pairs, adverse, higher_rss = 0, 0, 0
        for instrumented in [True, False]:
            for order in ['AB', 'BA']:
                workers = {}
                for arm in ['baseline', 'candidate']:
                    worker_id = f'{"on" if instrumented else "off"}-{order}-{arm}'
                    raw = documents[f'measurement/{capture}/{worker_id}.json']
                    embedded = next(w for w in receipt['workers'] if w['id'] == worker_id)
                    check(found[f'measurement/{capture}/{worker_id}.json']['sha256'] == embedded['resultSha256'], 'Raw worker digest differs')
                    check(all(embedded[k] == v for k, v in raw.items()), 'Embedded worker differs from raw bytes')
                    check(raw['success'] and embedded['process']['exitCode'] == 0, 'Worker failed')
                    workers[arm] = raw
                check(len(workers['baseline']['samples']) == len(workers['candidate']['samples']), 'Unpaired samples')
                for a, b in zip(workers['baseline']['samples'], workers['candidate']['samples']):
                    for sample in [a, b]:
                        semantic = {**sample['receipt'], 'payload': {k: v for k, v in sample['receipt']['payload'].items()
                                    if k not in ['index', 'dependencyValidation']}}
                        check(semantic == sample['receiptSemantic'], 'Receipt semantics were not derived from the raw receipt')
                    for field in ['phase', 'workload', 'iteration', 'output', 'receiptSemantic']:
                        check(a[field] == b[field], 'Paired semantics differ: ' + field)
                    check(a['eventReads']['full'] == 1 and a['eventReads']['head'] == 0, 'Baseline did not use full replay')
                    check(b['eventReads']['full'] == 0 and b['eventReads']['head'] == 1 and b['eventReads']['range'] == 1,
                          'Candidate native cursor path missing')
                    if b['iteration'] > 0:
                        check(b['eventReads']['deltaRows'] == 0, 'Warm candidate returned typed input')
                        if instrumented:
                            check(b['metrics']['worker']['eventReturnedRows'] == 1, 'Warm durable head row missing')
                    if capture == 'full' and instrumented and b['iteration'] == 0:
                        check(a['metrics']['worker']['eventReturnedRows'] == 100001 and
                              b['metrics']['worker']['eventReturnedRows'] == 1002, 'Cold row counts differ')
                    pairs += 1
                    adverse += b['wallMs'] > a['wallMs']
                    higher_rss += b['sampledPeakRss'] > a['sampledPeakRss']
        check(pairs == expected_pairs, 'Paired sample count differs')
        for seed in receipt['fixture']['seeds']:
            check(found[measurement_name(seed['database'])]['sha256'] == seed['databaseSha256'], 'Original SQLite seed changed')
        for workload in receipt['fixture']['workloads']:
            # Original facts use JSON.stringify; archived raw bytes end in one newline.
            name = measurement_name(workload['factsFile'])
            check(fact_hashes[name] == workload['factsSha256'], 'Original memory fact bytes differ')
        for file in receipt['fixture']['contents']:
            name = measurement_name(receipt['fixture']['workspaceRoot'] + '/' + file['path'])
            check(found[name]['sha256'] == file['sha256'], 'Original workspace fixture changed')
        observations.append({'capture': capture, 'pairedEqual': pairs, 'adverseWallPairs': adverse,
                             'higherSampledPeakRssPairs': higher_rss})
    check(observations[0]['adverseWallPairs'] == 1 and observations[0]['higherSampledPeakRssPairs'] == 12,
          'Unfavorable smoke observations were not retained')

    final = documents['final-v1/regression.json']
    check(final == json.loads((repo / index['regressionPath']).read_bytes()), 'Published regression differs from raw')
    check(final['head'] == index['verificationBase'] and final['stagedTree'] == index['implementationTree'], 'Final verification identity differs')
    check(final['passedRequiredChecks'], 'Required final checks failed')
    for key in ['sourceDrift', 'emittedDrift', 'stagedWorkspaceDrift']:
        check(final[key] == [], 'Final ' + key)
    check(final['preservedUserFiles'] == {'count': 28, 'changed': []}, 'Protected user file result differs')
    check(documents['final-v1/source-before.json'] == documents['final-v1/source-after.json'], 'Source manifest drift')
    check(documents['final-v1/emitted-before.json'] == documents['final-v1/emitted-after.json'], 'Emitted manifest drift')
    check(sum(c['passed'] for c in final['testCounts']) == 306 and
          sum(c['failed'] + c['skipped'] for c in final['testCounts']) == 0, 'Final test counts differ')
    for row in final['checks']:
        name = 'final-v1/' + pathlib.PurePosixPath(row['log']).name
        check(found[name]['sha256'] == row['logSha256'], 'Final check artifact differs: ' + name)
    comparison = documents['final-v1/legacy-strict-baseline-comparison.json']
    check(comparison['sameNormalizedDiagnosticMultiset'] and comparison['baselineCount'] == comparison['currentCount'] == 48,
          'Legacy strict baseline differs')
    check(found['root-setup/napier-g03-agent-runtime-baseline-strict.log']['sha256'] == comparison['baselineSha256'], 'Missing retained strict baseline')
    def diagnostics(value):
        parts = re.split(r'(?=^[^\n]+\(\d+,\d+\): error TS)', value, flags=re.M)
        return collections.Counter(re.sub(r'^[^\n]+\(\d+,\d+\): ', '', part).strip()
                                   for part in parts if part.strip())
    old = diagnostics(logs['root-setup/napier-g03-agent-runtime-baseline-strict.log'])
    current = diagnostics(logs['final-v1/legacy-strict-tests.log'])
    check(old == current and sum(old.values()) == 48, 'Actual legacy strict diagnostics differ')
    for name, count in [('architecture', 7), ('public-api', 4)]:
        check(sum(line.startswith('- ') for line in logs[f'final-v1/{name}.log'].splitlines()) == count,
              'Retained gate diagnostics differ: ' + name)
    check({e['path']: e['sha256'] for e in freeze['owned']} == final['stagedSourceManifest']['files'], 'Integration source differs from measured source')
    review = documents['review/napier-g07-independent-review-20261030.json']
    check(review['blockingFindings'] == [] and review['independentEvidenceChecks']['artifactHashesChecked'] == 82,
          'Independent review differs')
    print(json.dumps({'valid': True, 'archiveMembers': len(found), 'originalArtifacts': 82,
                      'measurementBase': index['measurementBase'], 'verificationBase': index['verificationBase'],
                      'implementationCommit': index['implementationCommit'], 'finalTestsPassed': 306,
                      'observations': observations, 'measurementModelCalls': 0,
                      'externalModelCalls': 0}, indent=2))


if __name__ == '__main__':
    main()
