#!/usr/bin/env python3
"""Check archived evidence without its original /tmp paths or installed packages."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import sys


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path: Path):
    return json.loads(path.read_text())


def normalize(path: str) -> str:
    return path.replace('/private/tmp/', '/tmp/')


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--source-root', type=Path, help='Optionally compare the final source files with a checkout')
    parser.add_argument('--allow-draft', action='store_true', help='Check draft evidence without claiming completion')
    args = parser.parse_args()
    root = args.archive.resolve()
    manifest = read(root / 'archive-manifest.json')
    errors: list[str] = []
    evidence = manifest['files']

    def archive_path(relative: str) -> Path:
        target = (root / relative).resolve()
        if not target.is_relative_to(root):
            raise ValueError(f'Archive reference escapes root: {relative}')
        return target

    def indexed_path(relative: str) -> Path:
        if relative not in evidence:
            raise ValueError(f'Unindexed semantic evidence: {relative}')
        return archive_path(relative)

    def indexed_read(relative: str):
        return read(indexed_path(relative))

    def reference(original: str, expected: str | None = None) -> Path:
        matches = [(name, item) for name, item in evidence.items()
                   if normalize(item.get('originalPath', '')) == normalize(original)
                   and (expected is None or item['sha256'] == expected)]
        if not matches:
            raise ValueError(f'No archived reference: {original}, hash={expected}')
        hashes = {item['sha256'] for _, item in matches}
        if len(hashes) != 1:
            raise ValueError(f'Ambiguous historical reference requires its hash: {original}')
        return archive_path(matches[0][0])

    for name, item in evidence.items():
        path = archive_path(name)
        if not path.is_file():
            errors.append(f'Missing artifact: {name}')
        elif digest(path) != item['sha256'] or path.stat().st_size != item['bytes']:
            errors.append(f'Artifact hash/size differs: {name}')

    summary = indexed_read('review-summary.json')
    if summary['status'] != manifest['status']:
        errors.append('Summary and archive status differ')
    for frozen in summary.get('ownerFreezes', []):
        handoff = indexed_read(frozen['handoff'])
        for item in handoff['ownedFiles']:
            path = indexed_path(frozen['source'] + '/' + item['path'])
            if digest(path) != item['sha256']:
                errors.append(f'Owner frozen source differs: {item["path"]}')
        for item in handoff.get('receipts', []):
            reference(item['path'], item['sha256'])
        if handoff.get('previousHandoff'):
            previous = handoff['previousHandoff']
            reference(previous['path'], previous['sha256'])
    for frozen in summary.get('sourceBindings', []):
        value = indexed_read(frozen['manifest'])
        hashes = value['files'] if frozen.get('filesKey') else value
        if isinstance(hashes, list):
            hashes = {item['path']: item['sha256'] for item in hashes}
        for name, expected in hashes.items():
            if digest(indexed_path(frozen['source'] + '/' + name)) != expected:
                errors.append(f'Projection source snapshot differs: {name}')
    final = indexed_read(summary['functionalRegression'])
    for check in final['checks']:
        if check.get('required') and check['exitCode'] != 0:
            errors.append(f'Required check failed: {check["name"]}')
        if check.get('log') and check.get('logSha256'):
            reference(check['log'], check['logSha256'])
    for field in ('sourceDrift', 'emittedDrift', 'stagedWorkspaceDrift'):
        if final[field]:
            errors.append(f'Recorded verification drift: {field}')
    if final['preservedUserFiles']['changed']:
        errors.append('Recorded protected user files changed')
    if not final['passedRequiredChecks']:
        errors.append('Functional regression did not pass required checks')

    case_results: dict[tuple[str, str], str] = {}
    source_files: set[str] = set()
    counts = []
    baseline_refs = []
    for suite in final['testCounts']:
        report_ref = final['testReports'][suite['suite']]
        baseline_refs.append(report_ref)
        report = read(reference(report_ref['path'], report_ref['sha256']))
        actual = {'suite': suite['suite'], 'files': len(report['testResults']),
                  'total': report['numTotalTests'], 'passed': report['numPassedTests'],
                  'failed': report['numFailedTests'], 'skipped': report['numPendingTests']}
        if actual != suite:
            errors.append(f'Test count mismatch: {suite["suite"]}')
        counts.append(actual)
    unique = final.get('uniqueFinalAssertions')
    reports = unique['reports'] if unique else baseline_refs
    replaced_cases = 0
    for report_ref in reports:
        report = read(reference(report_ref['path'], report_ref['sha256']))
        local_cases: set[tuple[str, str]] = set()
        for result in report['testResults']:
            absolute = normalize(result['name'])
            prefix = normalize(final['cwd']).rstrip('/') + '/'
            if not absolute.startswith(prefix):
                raise ValueError(f'Test result is outside recorded snapshot: {absolute}')
            filename = absolute[len(prefix):]
            if not filename.startswith(('packages/', 'apps/')) or '..' in Path(filename).parts:
                raise ValueError(f'Test result is outside production test roots: {filename}')
            source_files.add(filename)
            if result['status'] != 'passed':
                errors.append(f'Final test file is not passed: {filename}')
            for assertion in result['assertionResults']:
                identity = (filename, assertion['fullName'])
                if identity in local_cases:
                    errors.append(f'Duplicate test identity within report: {identity}')
                local_cases.add(identity)
                if identity in case_results:
                    replaced_cases += 1
                    if not unique:
                        errors.append(f'Duplicate final test identity: {identity}')
                case_results[identity] = assertion['status']
        if len(local_cases) != report['numTotalTests']:
            errors.append(f'Assertion count differs from report: {report_ref["path"]}')
    for identity, status in case_results.items():
        if status != 'passed':
            errors.append(f'Final test is not passed: {identity}')
    expected_total = unique['passed'] if unique else sum(item['total'] for item in counts)
    expected_files = unique['files'] if unique else sum(item['files'] for item in counts)
    if expected_total != len(case_results) or (unique and (unique['failed'] or unique['skipped'])):
        errors.append('Unique final case count differs from report total')
    if len(source_files) != expected_files:
        errors.append('Unique final test file count differs from report total')

    for pair in summary.get('stableManifests', []):
        before, after = indexed_read(pair['before']), indexed_read(pair['after'])
        if before != after:
            errors.append(f'Before/after manifest differs: {pair["kind"]}')
        if len(before) != pair['count']:
            errors.append(f'Manifest count differs: {pair["kind"]}')

    current = final
    while current.get('incrementalResponsiveValidation') or current.get('incrementalValidation'):
        responsive = current.get('incrementalResponsiveValidation')
        incremental = responsive or current['incrementalValidation']
        prior = read(reference(incremental['prior'], incremental['priorSha256']))
        before_ref = prior.get('sourceAfterManifest')
        before = (read(reference(before_ref['path'], before_ref['sha256'])) if before_ref
                  else indexed_read(summary['incrementalSourceBefore']))
        after_ref = current['sourceAfterManifest']
        after = read(reference(after_ref['path'], after_ref['sha256']))
        changed = sorted(name for name in before.keys() | after.keys() if before.get(name) != after.get(name))
        declared = incremental['changedFiles'] if responsive else incremental['changedSourceFiles']
        if changed != sorted(declared):
            errors.append('Incremental source delta differs from retained before/after maps')
        if prior['stagedSourceManifest']['baseHead'] != current['stagedSourceManifest']['baseHead']:
            errors.append('Incremental verification changed its base without recording it')
        current = prior
    if final.get('sourceAfterManifest'):
        after_ref = final['sourceAfterManifest']
        after = read(reference(after_ref['path'], after_ref['sha256']))
        if len(after) != final['sourceCount']:
            errors.append('Final source manifest count differs')
        for name, expected in final['stagedSourceManifest']['files'].items():
            if name in after or '/src/' in name or '/test/' in name:
                if after.get(name) != expected:
                    errors.append(f'Final source map omits or differs from staged source: {name}')

    stage = final['stagedSourceManifest']
    if stage['tree'] != final['stagedTree'] or stage['fileCount'] != len(stage['files']):
        errors.append('Final source tree or file count is inconsistent')
    if summary['status'] == 'sealed' and not (summary.get('sourceManifest') and summary.get('sourceSnapshot')):
        errors.append('Sealed archive requires final source manifest and source bytes')
    if summary.get('sourceManifest'):
        stage = indexed_read(summary['sourceManifest'])
        if stage['files'] != final['stagedSourceManifest']['files']:
            errors.append('Final source manifest differs from functional verification')
    if summary.get('sourceSnapshot'):
        for name, expected in stage['files'].items():
            path = indexed_path(summary['sourceSnapshot'] + '/' + name)
            if not path.is_file() or digest(path) != expected:
                errors.append(f'Archived final source differs: {name}')
    if args.source_root:
        for name, expected in stage['files'].items():
            if Path(name).is_absolute() or '..' in Path(name).parts:
                raise ValueError(f'Source path is not repository-relative: {name}')
            path = args.source_root / name
            if not path.is_file() or digest(path) != expected:
                errors.append(f'Checkout source differs: {name}')

    browser = None
    if summary.get('finalBrowserReceipt'):
        browser = indexed_read(summary['finalBrowserReceipt'])
        if browser.get('status') != 'passed':
            errors.append('Final browser receipt is not passed')
        if browser.get('paidModelCalls') != 0:
            errors.append('Browser receipt has external/paid model calls')
        if not browser.get('cases') or not browser.get('screenshots'):
            errors.append('Passing browser evidence requires executed cases and screenshots')
        for screenshot in browser.get('screenshots', []):
            reference(screenshot)
        if not browser.get('browserClosed') or not browser.get('serverClosed'):
            errors.append('Browser/server cleanup is not recorded')
        for case in browser.get('cases', []):
            if case.get('geometry', {}).get('violations'):
                errors.append(f'Browser geometry violations: {case["name"]}')
        for focus in browser.get('focusRestoration', []):
            if focus.get('tag') in {'BODY', 'HTML'} or focus.get('inactive'):
                errors.append('Browser focus restoration is not interactive')
        binding = summary.get('browserProvenance')
        if not binding:
            errors.append('Browser evidence lacks indexed source/build provenance')
        else:
            verification = indexed_read(binding['verification'])
            if (not verification['passed'] or verification['exitCode'] != 0
                    or not verification['sourceStable'] or not verification['emittedStable']
                    or not verification['productionEntryHashesMatch']):
                errors.append('Browser provenance verification did not pass')
            if reference(verification['receipt'], verification['receiptSha256']) != indexed_path(summary['finalBrowserReceipt']):
                errors.append('Browser verification points to a different final receipt')
            if verification['sourceManifest']['files'] != stage['files']:
                errors.append('Browser source manifest differs from functional source')
            protected = indexed_read(binding['protectedOverlayManifest'])
            if verification['protectedOverlay'] != protected or len(protected) != final['preservedUserFiles']['count']:
                errors.append('Browser protected overlay differs from preserved user files')
            sources = indexed_read(binding['sourceBefore'])
            emitted = indexed_read(binding['emittedBefore'])
            if sources != indexed_read(binding['sourceAfter']) or len(sources) != verification['sourceCount']:
                errors.append('Browser source changed or count differs')
            if emitted != indexed_read(binding['emittedAfter']) or len(emitted) != verification['emittedCount']:
                errors.append('Browser emitted bytes changed or count differs')
            expected_sources = {k:v for k,v in stage['files'].items() if '/src/' in k}
            expected_sources.update({k:v for k,v in protected.items() if k in sources})
            for name, expected in expected_sources.items():
                if sources.get(name) != expected:
                    errors.append(f'Browser source/overlay hash differs: {name}')
            build = indexed_read(binding['buildReceipt'])
            if not build or any(check['exitCode'] != 0 for check in build):
                errors.append('Initial browser build did not pass')
            reference(verification['builds']['finalWebLog'], verification['builds']['finalWebLogSha256'])
            entries = {'serverSha256': 'apps/server/dist/index.js', 'webIndexSha256': 'apps/web/dist/index.html'}
            for field, name in binding['entryArtifacts'].items():
                actual = digest(indexed_path(name))
                if actual != browser['productionEntry'][field] or actual != emitted[entries[field]]:
                    errors.append(f'Browser entry hash differs: {field}')
            if set(binding['entryArtifacts']) != set(entries):
                errors.append('Browser entry bindings are incomplete')
            if digest(indexed_path(binding['script'])) != verification['scriptSha256']:
                errors.append('Browser script hash differs from verification')
            visual = indexed_read(binding['visualReview'])
            if (visual['tree'] != stage['tree'] or visual['sourceFiles'] != len(stage['files'])
                    or visual['visualAcceptance']['status'] != 'accepted'):
                errors.append('Final visual review is not bound to the verified source')
            for screenshot in visual['visualAcceptance']['screenshots']:
                reference(screenshot['path'], screenshot['sha256'])
    elif summary['status'] == 'sealed':
        errors.append('Sealed archive has no passing browser receipt')

    if summary['status'] != 'sealed' and not args.allow_draft:
        errors.append('Archive is a draft; final provenance is pending')
    result = {'kind': 'napier.artifact-consumer-portable-reconciliation',
              'status': 'passed' if not errors else 'failed', 'archiveStatus': summary['status'],
              'artifactCount': len(evidence), 'functionalSourceFiles': len(stage['files']),
              'uniqueFinalTests': len(case_results), 'uniqueFinalTestFiles': len(source_files),
              'baseTestCounts': counts, 'repeatedCasesMerged': replaced_cases, 'protectedUserFiles': final['preservedUserFiles'],
              'browserStatus': None if browser is None else browser['status'],
              'liveSourceChecked': args.source_root is not None,
              'fullG01Complete': False,
              'boundary': 'Reconciles retained evidence; does not rerun tests or browser acceptance.',
              'errors': errors}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if not errors else 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (KeyError, ValueError, OSError) as exc:
        print(json.dumps({'status': 'failed', 'error': str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
