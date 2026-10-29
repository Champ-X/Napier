#!/usr/bin/env python3
"""Verify the exact2 duplicate-revision evidence with Python's standard library.

No Git, Node, network, extraction, archived-code execution or historical /tmp
directory is required. --workspace optionally checks only the two changed files.
"""
from __future__ import annotations

import argparse
from collections import Counter
import difflib
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import sys
import tarfile

BASE = "e10a7bd39b71dc74dfb4bbd05f6c5254bedd5696"
SOURCE = "0699f1c456c9b69b52246a83b3afc4715c6179538d9f67181b0e0e5aeb9700ee"
PREVIOUS = "1b17a9b04688c0d5e513de69aee518fc714008f7f9710fb6f55f7b578abf3323"
PREFIX = "model-accounting-duplicate-revision"
DATE = "2026-10-30"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def git_id(kind, data):
    return hashlib.sha1(f"{kind} {len(data)}\0".encode() + data).hexdigest()


def safe_path(value):
    require(isinstance(value, str) and value and "\\" not in value, "invalid path")
    require(not PurePosixPath(value).is_absolute() and all(p not in ("", ".", "..") for p in value.split("/")),
            f"unsafe path: {value}")
    return value


def check(data, item, label):
    require(len(data) == item["bytes"] and sha(data) == item["sha256"], f"size or SHA256 mismatch: {label}")


def read(data, path):
    return json.loads(data[path])


def archive_data(index, directory):
    raw = (directory / safe_path(index["archive"]["path"])).read_bytes()
    check(raw, index["archive"], "archive")
    expected = {}
    for entry in index["members"]:
        path = safe_path(entry["path"])
        require(path not in expected, "duplicate indexed member")
        expected[path] = entry
    data = {}
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as archive:
        for member in archive:
            path = safe_path(member.name)
            require(member.isfile() and not member.issym() and not member.islnk(), f"non-regular member: {path}")
            require(path in expected and path not in data, f"unindexed or duplicate member: {path}")
            require(member.size == expected[path]["bytes"], f"member size mismatch: {path}")
            stream = archive.extractfile(member)
            require(stream is not None, f"unreadable member: {path}")
            data[path] = stream.read()
            check(data[path], expected[path], path)
    require(set(data) == set(expected) and len(data) == index["memberCount"], "missing member or incorrect count")
    return data


def git_base(data):
    commit = data["git-proof/commit"]
    require(git_id("commit", commit) == BASE, "base commit identity mismatch")
    root = commit.splitlines()[0].decode().removeprefix("tree ")
    require(re.fullmatch(r"[0-9a-f]{40}", root), "invalid root tree")
    files, seen = {}, set()

    def walk(tree, prefix="", ancestors=()):
        require(tree not in ancestors, "cyclic Git tree")
        raw = data["git-proof/" + tree]
        require(git_id("tree", raw) == tree, "tree object mismatch")
        seen.add(tree)
        offset = 0
        while offset < len(raw):
            space, nul = raw.index(b" ", offset), raw.index(b"\0", offset)
            mode, name = raw[offset:space].decode(), raw[space + 1:nul].decode()
            require("/" not in name and nul + 21 <= len(raw), "invalid tree entry")
            path = safe_path(prefix + name)
            child = raw[nul + 1:nul + 21].hex()
            offset = nul + 21
            if mode == "40000":
                walk(child, path + "/", (*ancestors, tree))
            else:
                require(mode in ("100644", "100755", "120000") and path not in files, "invalid base file")
                files[path] = (mode, child)

    walk(root)
    members = {p.removeprefix("git-proof/") for p in data if p.startswith("git-proof/") and p != "git-proof/commit"}
    require(seen == members and len(seen) == 421, "incomplete base tree proof")
    return files


def indexed_bindings(data, prefix, index_name):
    index = read(data, prefix + index_name)
    if "artifacts" in index:
        entries = index["artifacts"]
    else:
        raise ValueError("invalid inner evidence index")
    if "sourceManifest" in index:
        entries = [index["sourceManifest"], index["verification"], *entries]
    for entry in entries:
        path = prefix + safe_path(entry["path"])
        require(sha(data[path]) == entry["sha256"], f"inner binding mismatch: {path}")
        if "bytes" in entry:
            require(len(data[path]) == entry["bytes"], f"inner size mismatch: {path}")


def sources(data, workspace):
    require(sha(data["frozen/source-manifest.json"]) == SOURCE, "wrong exact2 freeze")
    require(sha(data["previous-frozen/source-manifest.json"]) == PREVIOUS, "wrong frozen17 predecessor")
    require(data["frozen/previous-source-manifest.json"] == data["previous-frozen/source-manifest.json"], "predecessor manifest differs")
    indexed_bindings(data, "frozen/", "evidence-index.json")
    indexed_bindings(data, "previous-frozen/", "evidence-index.json")
    current = read(data, "frozen/source-manifest.json")
    prior = read(data, "previous-frozen/source-manifest.json")
    require(current["baseSha"] == BASE and current["previousFrozenSourceManifestSha256"] == PREVIOUS, "incorrect source lineage")
    owned = {v["path"]: v for v in current["files"]}
    previous = {v["path"]: v for v in prior["files"]}
    require(len(owned) == 2 and len(previous) == 17, "wrong source scope")
    expected_delta = {"packages/runtime/src/model-accounting-repository.ts",
                      "packages/runtime/test/model-accounting-reconciliation-revision.test.ts"}
    require(set(owned) == expected_delta, "unexpected exact2 paths")
    base = git_base(data)
    manifest = read(data, "candidate-tree.json")
    require(manifest["baseSha"] == BASE and manifest["sourceManifestSha256"] == SOURCE and
            manifest["previousSourceManifestSha256"] == PREVIOUS, "candidate manifest binding differs")
    candidate = {v["path"]: v for v in manifest["files"]}
    require(len(candidate) == len(manifest["files"]) == manifest["fileCount"] == 6424, "candidate file count differs")
    require(set(candidate) == set(base) | set(previous) | set(owned), "candidate added/deleted unexpected files")
    require(len(set(previous) - set(base)) == 3 and len(set(owned) - set(base) - set(previous)) == 1, "wrong added-file scope")
    changed, prior_changed = set(), set()
    for path, item in candidate.items():
        safe_path(path)
        mode, blob = base.get(path, ("100644", None))
        previous_blob = git_id("blob", data["previous-frozen/source/" + path]) if path in previous else blob
        require(item["mode"] == mode and item["baseBlobSha1"] == blob and item["previousBlobSha1"] == previous_blob,
                f"base/predecessor identity differs: {path}")
        if previous_blob != blob:
            prior_changed.add(path)
        if item["candidateBlobSha1"] != previous_blob:
            changed.add(path)
    require(changed == expected_delta and prior_changed == set(previous), "source delta differs from exact2 over frozen17")
    for path, item in previous.items():
        check(data["previous-frozen/source/" + path], item, path)
        if item["baseSha256"] is None:
            require(path not in base, "predecessor added file existed at base")
        else:
            raw = data["base-owned-source/" + path]
            require(sha(raw) == item["baseSha256"] and git_id("blob", raw) == base[path][1], "predecessor base bytes differ")
    patch = ""
    for item in current["files"]:
        path = item["path"]
        raw = data["frozen/source/" + path]
        check(raw, item, path)
        check(raw, candidate[path], path)
        require(git_id("blob", raw) == candidate[path]["candidateBlobSha1"], "candidate source Git identity differs")
        old = data["previous-frozen/source/" + path] if path in previous else b""
        require(item["previousFrozenSha256"] == (sha(old) if path in previous else None), "previous file hash differs")
        if path in previous:
            require(data["frozen/previous/" + path] == old, "patch predecessor bytes differ")
        patch += "".join(difflib.unified_diff(old.decode().splitlines(keepends=True), raw.decode().splitlines(keepends=True),
                                            fromfile="a/" + path if path in previous else "/dev/null", tofile="b/" + path))
        if workspace:
            check((workspace / path).read_bytes(), item, "workspace/" + path)
    require(patch.encode() == data["frozen/change.patch"] and sha(patch.encode()) == current["patchSha256"], "patch does not describe exact2 bytes")
    integration = read(data, "root-integration/source-manifest.json")
    require(integration["files"] == {path: item["sha256"] for path, item in owned.items()}, "root integration exact2 source differs")
    require(integration["base"] == "bf6a34cdeede8e95e7932339de736f209954ecc5" and
            integration["tree"] == "9d9061fd9938344be72491de7635956d325a62c1", "root integration identity differs")
    for path, raw in data.items():
        if path.startswith("candidate-context/"):
            name = path.removeprefix("candidate-context/")
            check(raw, candidate[name], name)
            require(git_id("blob", raw) == candidate[name]["candidateBlobSha1"], "context blob differs")
    return candidate


def cases(report, passed, failed, files, review=False):
    require(report["numPassedTests"] == passed and report["numFailedTests"] == failed and
            report["numTotalTests"] == passed + failed, "test summary count differs")
    require(report["numPendingTests"] == report["numTodoTests"] == 0 and report["success"] is (failed == 0), "test skip/success differs")
    rows, paths = {}, set()
    for suite in report["testResults"]:
        if review:
            require(suite["name"].endswith("/review.test.ts"), "unexpected reviewer test file")
            path = "review.test.ts"
        else:
            match = re.search(r"/(packages/runtime/test/[^/]+|apps/server/test/[^/]+)$", suite["name"])
            require(match is not None, "unexpected regression test file")
            path = match.group(1)
        require(path not in paths, "duplicate test suite")
        paths.add(path)
        for assertion in suite["assertionResults"]:
            key = (path, assertion["fullName"])
            require(key not in rows and assertion["status"] in ("passed", "failed"), "duplicate or skipped assertion")
            require(bool(assertion["failureMessages"]) is (assertion["status"] == "failed"), "assertion status differs from failure payload")
            rows[key] = assertion["status"]
    require(len(paths) == files and Counter(rows.values()) == Counter({"passed": passed, "failed": failed}), "actual assertion counts differ")
    return rows, paths


def tests(data, candidate):
    old_runtime, runtime_files = cases(read(data, "previous-frozen/evidence/v1-runtime-results.json"), 156, 0, 17)
    old_host, host_files = cases(read(data, "previous-frozen/evidence/v1-host-results.json"), 37, 0, 6)
    require(not set(old_runtime) & set(old_host), "original case overlap")
    original = set(old_runtime) | set(old_host)
    old_files = runtime_files | host_files
    previous_sources = read(data, "previous-test-sources.json")
    require(len(previous_sources) == 23 and {v["path"] for v in previous_sources} == old_files, "original test source set differs")
    for item in previous_sources:
        raw = data["previous-test-source/" + safe_path(item["path"])]
        check(raw, item, item["path"])
        check(raw, candidate[item["path"]], "unchanged original test/" + item["path"])
    before, _ = cases(read(data, "frozen/evidence/regression-before.json"), 0, 4, 1)
    after, _ = cases(read(data, "frozen/evidence/regression-after.json"), 4, 0, 1)
    final, final_files = cases(read(data, "frozen/evidence/final-results.json"), 197, 0, 24)
    require(set(before) == set(after) and not set(after) & original, "new regression case set differs")
    require(set(final) == original | set(after), "final197 is not unchanged original193 plus new4")
    require(set(read(data, "frozen/evidence/final-test-files.json")) == final_files, "final selected file set differs")
    review_before, _ = cases(read(data, "frozen/evidence/review-before.json"), 5, 1, 1, review=True)
    review_after, _ = cases(read(data, "frozen/evidence/review-after.json"), 6, 0, 1, review=True)
    require(set(review_before) == set(review_after), "supplementary reviewer cases differ")
    require([key[1] for key, value in review_before.items() if value == "failed"] ==
            ["duplicate reconciliation reports the committed revision if another Store settles after queue refresh"], "unexpected baseline reviewer failure")
    integrated, _ = cases(read(data, "root-integration/tests.json"), 31, 0, 3)
    require(set(integrated) <= set(final), "supplementary root integration is not a subset of final197")
    observed = {}
    for line in data["frozen/evidence/regression-after.log"].decode().splitlines():
        if line.startswith('{"case":'):
            item = json.loads(line)
            require(item["case"] not in observed, "duplicate revision observation")
            observed[item["case"]] = item
    require(set(observed) == {"run", "child", "undispatched-run", "undispatched-child"}, "revision observations incomplete")
    for name, stale, current, parent in [("run", 2, 3, None), ("child", 2, 3, 6),
                                        ("undispatched-run", 1, 2, None), ("undispatched-child", 1, 2, 2)]:
        item = observed[name]
        require(item["stale"] == stale and item["accountingRevision"] == current and
                item.get("parentAccountingRevision") == parent, "observed coherent revisions differ")
        require(item["nativeCounts"]["claims"] == item["nativeCounts"]["events"] == (2 if name == "child" else 1),
                "observed native claim/event counts differ")
    return {"finalFiles": 24, "finalUniqueCases": 197, "unchangedOriginalCases": 193, "unchangedOriginalTestFiles": 23,
            "newBeforeFailed": 4, "newAfterPassed": 4, "supplementaryReviewBefore": {"passed": 5, "failed": 1},
            "supplementaryReviewAfter": {"passed": 6, "failed": 0}, "supplementaryAddedToFinal197": 0,
            "supplementaryRootIntegration": {"files": 3, "passed": 31, "addedToFinal197": 0},
            "revisionObservations": observed}


def gates(data):
    commands = read(data, "frozen/evidence/build-commands.json")
    require([v["name"] for v in commands] == ["build", "test-types"] and all(v["exitCode"] == 0 for v in commands), "build/types command failed")
    require(data["frozen/evidence/build.log"] == data["frozen/evidence/test-types.log"] == b"", "unexpected build/type diagnostics")
    command = read(data, "frozen/evidence/final-command.json")
    require(command["exitCode"] == 0 and command["networkGuard"] == "network-guard.mjs" and
            command["networkAudit"] == "final-network.jsonl", "final command/guard binding differs")
    records = [json.loads(line) for line in data["frozen/evidence/final-network.jsonl"].splitlines()]
    installs = [v for v in records if v["event"] == "installed"]
    connections = [v for v in records if v["event"] == "connection"]
    contexts = {(v["pid"], v["threadId"]) for v in installs}
    require(len(installs) == len(contexts) == 40 and len({v["pid"] for v in installs}) == 37 and
            len(records) == len(installs) + len(connections), "network record counts differ")
    require(all(v["policy"] == "node-sockets-loopback-only-v1" for v in installs), "network policy differs")
    require(all((v["pid"], v["threadId"]) in contexts and v["allowed"] is True and v["kind"] == "tcp" and
                v["destination"] in ("unix-socket", "127.0.0.1") for v in connections), "nonlocal or unguarded connection")
    require(Counter(v["destination"] for v in connections) == {"unix-socket": 24, "127.0.0.1": 3}, "local network counts differ")
    require(read(data, "frozen/evidence/review-before-environment.json")["numFailedTests"] == 2,
            "initial standalone probe environment failure missing")
    return {"contractsAndRuntimeBuild": "passed", "strictNewTestTypes": "passed", "guardedNodeProcesses": 37,
            "guardInstallContexts": 40,
            "unixConnections": 24, "loopbackTcpConnections": 3, "nonLoopbackAttempts": 0,
            "networkBoundary": "inherited Node TCP/UDP socket guard; not OS packet capture or independent provider-traffic measurement"}


def integration(data):
    prefix = "root-integration/"
    result = read(data, prefix + "regression.json")
    require(result["sourceManifest"] == read(data, prefix + "source-manifest.json"), "integration summary source differs")
    receipt = read(data, prefix + "source-commit.json")
    commit = data[prefix + "commit-object"]
    require(receipt["commit"] == git_id("commit", commit) == "bf3b1c7843811766c70b66625f59b872c8806b79" and
            receipt["sourceManifest"] == result["sourceManifest"] and receipt["push"] is False, "source commit receipt differs")
    headers = commit.split(b"\n\n", 1)[0].decode().splitlines()
    tree = next(line.removeprefix("tree ") for line in headers if line.startswith("tree "))
    require(tree == result["sourceManifest"]["tree"] and
            [line.removeprefix("parent ") for line in headers if line.startswith("parent ")] == [result["sourceManifest"]["base"]],
            "source commit tree/parent differs")
    visited = set()
    for path in result["sourceManifest"]["files"]:
        current = tree
        parts = safe_path(path).split("/")
        for index, part in enumerate(parts):
            raw = data[prefix + "git-proof/" + current]
            require(git_id("tree", raw) == current, "integration tree object differs")
            visited.add(current)
            entries, offset = {}, 0
            while offset < len(raw):
                space, nul = raw.index(b" ", offset), raw.index(b"\0", offset)
                mode, name = raw[offset:space].decode(), raw[space + 1:nul].decode()
                require(name not in entries and nul + 21 <= len(raw), "invalid integration tree entry")
                entries[name] = (mode, raw[nul + 1:nul + 21].hex())
                offset = nul + 21
            mode, current = entries[part]
            require(mode == ("100644" if index == len(parts) - 1 else "40000"), "source commit path mode differs")
        require(current == git_id("blob", data["frozen/source/" + path]), "committed exact2 source blob differs")
    require(visited == {name.removeprefix(prefix + "git-proof/") for name in data if name.startswith(prefix + "git-proof/")},
            "unneeded or missing integration proof tree")
    checks = result["checks"]
    expected = {"full-compile": 0, "tests": 0, "strict-new-test": 0, "architecture": 1, "public-api": 1, "diff-check": 0}
    require(len(checks) == len(expected) and {v["name"] for v in checks} == set(expected), "root check selection differs")
    for item in checks:
        name = item["name"]
        require(item["exitCode"] == expected[name] and PurePosixPath(item["log"]).name == name + ".log", "root command disposition differs")
        require(sha(data[prefix + name + ".log"]) == item["sha256"], "root command log binding differs")
    for kind, count in [("source", 2481), ("emitted", 5110)]:
        before, after = read(data, prefix + kind + "-before.json"), read(data, prefix + kind + "-after.json")
        require(before == after and len(before) == count and result[kind + "Stable"] is True and
                result[kind + "Count"] == count, "root source/emitted identity drift")
    require(data[prefix + "architecture.log"] == data["previous-frozen/evidence/v1-architecture.log"], "architecture raw failures changed")
    require(sum(line.startswith(b"- ") for line in data[prefix + "architecture.log"].splitlines()) == 7, "architecture failure count differs")
    require(data[prefix + "public-api.log"] == data["previous-frozen/evidence/v1-public-api.log"], "public API raw failures changed")
    require(len(read(data, "previous-frozen/evidence/api-comparison.json")["candidate"]["errors"]) == 4, "public API failure count differs")
    return {"sourceCommit": receipt["commit"], "committedExact2BlobsVerified": True,
            "runtimeCliServerCompile": "passed", "strictNewTestTypes": "passed", "sourceIdentitiesStable": 2481,
            "emittedIdentitiesStable": 5110, "architectureFailures": 7, "publicApiFailures": 4,
            "gateRawLogsEqualFrozen17": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--index", type=Path, default=Path(__file__).with_name(f"{PREFIX}-evidence-index-{DATE}.json"))
    parser.add_argument("--workspace", type=Path, help="compare only the exact2 changed files in a candidate/integrated checkout")
    parser.add_argument("--list", action="store_true", help="include verified archive member names")
    args = parser.parse_args()
    index = json.loads(args.index.read_bytes())
    require(index["schemaVersion"] == 1 and index["baseSha"] == BASE and index["sourceManifestSha256"] == SOURCE,
            "wrong evidence index identity")
    companions = {}
    for item in index["companionArtifacts"]:
        path = safe_path(item["path"])
        require(path not in companions, "duplicate companion")
        companions[path] = item
        check((args.index.parent / path).read_bytes(), item, path)
    summary_path = safe_path(index["regressionPath"])
    require(summary_path in companions, "regression is not a hash-bound companion")
    summary = json.loads((args.index.parent / summary_path).read_bytes())
    require(summary["finalUniqueCases"] == 197 and summary["fullG03Complete"] is False and summary["sourceFilesChanged"] == 2,
            "regression summary scope differs")
    data = archive_data(index, args.index.parent)
    candidate = sources(data, args.workspace)
    require(read(data, "frozen/verification.json")["sourceManifestSha256"] == SOURCE, "frozen verification source binding differs")
    result = {"ok": True, "baseSha": BASE, "sourceManifestSha256": SOURCE, "previousFrozen17Sha256": PREVIOUS,
              "changedSourceFiles": 2, "candidateTrackedFiles": len(candidate), "archiveMembers": len(data),
              "tests": tests(data, candidate), "validation": gates(data), "workspaceExact2Checked": args.workspace is not None,
              "rootIntegration": integration(data),
              "limits": ["supplementary reviewer6 is not added to final197", "tests assert snapshot/usage stability; no archived SQLite re-execution",
                         "integration status tracked separately; whole G03 and universal physical/invoice guarantees remain incomplete"]}
    if args.list:
        result["members"] = sorted(data)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, tarfile.TarError) as error:
        print(json.dumps({"ok": False, "error": str(error)}), file=sys.stderr)
        sys.exit(1)
