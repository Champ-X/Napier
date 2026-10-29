#!/usr/bin/env python3
"""Reconcile the frozen G03 candidate without extracting or executing its archive.

Python 3.11+ and its SQLite deserialize API are required. No Git, Node, network,
old /tmp checkout, or fixture directory is used. --workspace checks only the 17
owned files; it does not assert that the entire current checkout is the candidate.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import sqlite3
import sys
import tarfile


BASE = "a056a3b1bf3b503353b19e47c9a981363dc58f68"
FREEZE = "1b17a9b04688c0d5e513de69aee518fc714008f7f9710fb6f55f7b578abf3323"
STEM = "shared-run-model-allowance"
DATE = "2026-10-30"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def git_id(kind, data):
    return hashlib.sha1(f"{kind} {len(data)}\0".encode() + data).hexdigest()


def safe_path(value):
    require(isinstance(value, str) and value and "\\" not in value, "invalid archive path")
    path = PurePosixPath(value)
    require(not path.is_absolute() and all(p not in ("", ".", "..") for p in value.split("/")),
            f"unsafe archive path: {value}")
    return value


def check_bytes(data, item, label):
    require(len(data) == item["bytes"], f"size mismatch: {label}")
    require(sha256(data) == item["sha256"], f"SHA256 mismatch: {label}")


def load_archive(index, directory):
    spec = index["archive"]
    raw = (directory / safe_path(spec["path"])).read_bytes()
    check_bytes(raw, spec, "archive")
    expected = {}
    for item in index["members"]:
        name = safe_path(item["path"])
        require(name not in expected, f"duplicate index member: {name}")
        expected[name] = item
    data = {}
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as archive:
        for member in archive:
            name = safe_path(member.name)
            require(member.isfile() and not member.issym() and not member.islnk(),
                    f"non-regular archive member: {name}")
            require(name in expected and name not in data, f"unindexed or duplicate member: {name}")
            require(member.size == expected[name]["bytes"], f"member size mismatch: {name}")
            stream = archive.extractfile(member)
            require(stream is not None, f"unreadable member: {name}")
            data[name] = stream.read()
            check_bytes(data[name], expected[name], name)
    require(set(data) == set(expected), "missing archive member")
    return data


def read_json(data, path):
    return json.loads(data[path])


def validate_source(data, workspace):
    manifest = read_json(data, "frozen/source-manifest.json")
    require(sha256(data["frozen/source-manifest.json"]) == FREEZE, "unexpected source freeze")
    require(manifest["baseSha"] == BASE and manifest["sourceFileCount"] == 17, "wrong source scope")
    frozen_index = read_json(data, "frozen/evidence-index.json")
    for item in [frozen_index["sourceManifest"], frozen_index["verification"], *frozen_index["artifacts"]]:
        name = "frozen/" + safe_path(item["path"])
        require(sha256(data[name]) == item["sha256"], f"original evidence binding changed: {name}")
        if "bytes" in item:
            require(len(data[name]) == item["bytes"], f"original evidence size changed: {name}")
    commit = data["git-proof/commit"]
    require(git_id("commit", commit) == BASE, "base Git commit object mismatch")
    tree_id = commit.splitlines()[0].decode().removeprefix("tree ")
    require(re.fullmatch(r"[0-9a-f]{40}", tree_id), "invalid base tree")
    base_files, seen_trees = {}, set()

    def walk(tree, prefix="", ancestors=()):
        require(tree not in ancestors, "cyclic Git tree")
        raw = data["git-proof/" + tree]
        require(git_id("tree", raw) == tree, "base Git tree object mismatch")
        seen_trees.add(tree)
        offset = 0
        while offset < len(raw):
            space = raw.index(b" ", offset)
            nul = raw.index(b"\0", space)
            mode = raw[offset:space].decode()
            name = raw[space + 1:nul].decode()
            require("/" not in name, "invalid Git tree entry")
            path = safe_path(prefix + name)
            require(nul + 21 <= len(raw), "truncated Git tree entry")
            object_id = raw[nul + 1:nul + 21].hex()
            offset = nul + 21
            if mode == "40000":
                walk(object_id, path + "/", (*ancestors, tree))
            else:
                require(mode in ("100644", "100755", "120000"), "unsupported Git tree mode")
                require(path not in base_files, "duplicate base file")
                base_files[path] = (mode, object_id)

    walk(tree_id)
    tree_members = {p.removeprefix("git-proof/") for p in data if p.startswith("git-proof/") and p != "git-proof/commit"}
    require(seen_trees == tree_members and len(seen_trees) == 371, "base tree proof incomplete")
    before = read_json(data, "candidate-tree-before.json")
    after = read_json(data, "candidate-tree-after.json")
    require(before == after, "candidate source changed during network validation")
    require(before["baseSha"] == BASE and before["fileCount"] == 6165, "wrong candidate tree")
    candidate = {v["path"]: v for v in before["files"]}
    require(len(candidate) == len(before["files"]) == 6165, "duplicate candidate source path")
    owned = {v["path"]: v for v in manifest["files"]}
    require(len(owned) == 17, "duplicate frozen source path")
    added = {p for p, v in owned.items() if v["baseSha256"] is None}
    require(len(added) == 3 and set(candidate) == set(base_files) | added, "unexpected added/deleted candidate files")
    changed = set()
    for path, entry in candidate.items():
        safe_path(path)
        base_mode, base_blob = base_files.get(path, ("100644", None))
        require(entry["baseBlobSha1"] == base_blob and entry["mode"] == base_mode, f"candidate base identity mismatch: {path}")
        if entry["candidateBlobSha1"] != base_blob:
            changed.add(path)
    require(changed == set(owned), "candidate changes exceed frozen exact17")
    for path, item in owned.items():
        blob = data["frozen/source/" + path]
        check_bytes(blob, item, path)
        check_bytes(blob, candidate[path], path)
        require(git_id("blob", blob) == candidate[path]["candidateBlobSha1"], f"candidate Git blob mismatch: {path}")
        if path not in added:
            baseline = data["baseline-source/" + path]
            require(sha256(baseline) == item["baseSha256"] and git_id("blob", baseline) == base_files[path][1],
                    f"base owned source mismatch: {path}")
        else:
            require(path not in base_files and "baseline-source/" + path not in data, f"new file existed at base: {path}")
        if workspace:
            check_bytes((workspace / path).read_bytes(), item, "workspace/" + path)
    for name, blob in data.items():
        if name.startswith("candidate-context/"):
            path = name.removeprefix("candidate-context/")
            check_bytes(blob, candidate[path], path)
            require(git_id("blob", blob) == candidate[path]["candidateBlobSha1"], f"candidate context mismatch: {path}")
    require(read_json(data, "network-validation/emitted-before.json") == read_json(data, "network-validation/emitted-after.json"),
            "emitted modules changed during network validation")
    return owned


def test_keys(report, expected_tests, expected_files):
    require(report["success"] is True, "final test report not successful")
    require(report["numTotalTests"] == report["numPassedTests"] == expected_tests, "test total mismatch")
    require(all(report[k] == 0 for k in ("numFailedTests", "numPendingTests", "numTodoTests")), "non-passing final test")
    keys, files = set(), set()
    for suite in report["testResults"]:
        match = re.search(r"/(packages/runtime/test/[^/]+|apps/server/test/[^/]+)$", suite["name"])
        require(match is not None, "unexpected test path")
        path = match.group(1)
        require(path not in files, "duplicate test file")
        files.add(path)
        require(suite["status"] == "passed", "non-passing final test suite")
        for assertion in suite["assertionResults"]:
            key = (path, assertion["fullName"])
            require(key not in keys and assertion["status"] == "passed" and not assertion["failureMessages"],
                    "duplicate or non-passing final test assertion")
            keys.add(key)
    require(len(keys) == expected_tests and len(files) == expected_files, "unique test/file count mismatch")
    return keys, files


def validate_network(data, final_keys, final_files):
    repeated, files = test_keys(read_json(data, "network-validation/results.json"), 193, 23)
    require(repeated == final_keys and files == final_files, "network repeat is not the same 193 cases")
    require(set(read_json(data, "network-validation/test-files.json")) == final_files, "network file selection differs")
    commands = read_json(data, "network-validation/commands.json")
    require([v["name"] for v in commands] == ["contracts-build", "runtime-build", "strict-test-types", "guard-selfcheck", "guarded-tests"],
            "unexpected network validation commands")
    require(all(v["exitCode"] == 0 and "network-validation/" + safe_path(v["log"]) in data for v in commands),
            "build/typecheck/network command failed or lacks log")
    records = [json.loads(line) for line in data["network-validation/network.jsonl"].splitlines()]
    installed = [r for r in records if r["event"] == "installed"]
    connections = [r for r in records if r["event"] == "connection"]
    require(len(installed) == 36 and len({r["pid"] for r in installed}) == 36, "unexpected Node guard install count")
    require(len(records) == len(installed) + len(connections), "unknown guard event")
    require(all(r["policy"] == "node-sockets-loopback-only-v1" for r in installed), "unknown guard policy")
    pids = {r["pid"] for r in installed}
    require(all(r["pid"] in pids and r["allowed"] is True and r["kind"] == "tcp" and
                r["destination"] in ("unix-socket", "127.0.0.1") for r in connections), "external or unguarded test connection")
    counts = Counter(r["destination"] for r in connections)
    require(counts == {"unix-socket": 24, "127.0.0.1": 3}, "unexpected local connection counts")
    selfcheck = [json.loads(line) for line in data["network-validation/selfcheck-network.jsonl"].splitlines()]
    denied = [r for r in selfcheck if r["event"] == "connection"]
    require(len(denied) == 1 and denied[0]["allowed"] is False and denied[0]["destination"] == "203.0.113.1",
            "external guard selfcheck missing")
    require(read_json(data, "network-validation/guard-selfcheck.log") == {"deniedBeforeConnect": True}, "selfcheck did not reject before connect")
    return {"installedNodeProcesses": 36, "unixConnections": 24, "loopbackTcpConnections": 3,
            "nonLoopbackTestAttempts": 0, "sameCasesRepeated": 193,
            "boundary": "controlled Node TCP/UDP guard; not OS packet capture or independent provider-traffic measurement"}


def database(blob):
    require(blob[:16] == b"SQLite format 3\0", "invalid SQLite evidence")
    # The archived databases were closed/checkpointed with no WAL files. A private
    # in-memory copy needs rollback-journal header flags for deserialize; original
    # archived bytes remain untouched and were SHA256-checked before this point.
    copied = bytearray(blob)
    copied[18] = copied[19] = 1
    connection = sqlite3.connect(":memory:")
    connection.deserialize(copied)
    connection.execute("PRAGMA query_only=ON")
    require(connection.execute("PRAGMA integrity_check").fetchall() == [("ok",)], "SQLite evidence integrity failure")
    return connection


def validate_budget(data, variant, dispatches, tokens):
    report = read_json(data, f"frozen/evidence/budget-{variant}.json")
    require(report["base"] == BASE and report["network"] == "forbidden", "wrong budget reproduction identity")
    require(report["parentLimitTokens"] == 1200 and report["perCallOutputCap"] == 700, "wrong reproduction limits")
    require(report["providerEntriesBeforeFirstReceipt"] == report["dispatchIntents"] == dispatches, "provider/dispatch reproduction differs")
    require(report["before"]["usage"]["outputTokens"] == 0 and report["after"]["usage"]["outputTokens"] == tokens,
            "wrong before/after canonical usage")
    require(report["after"]["summary"]["budgetTokens"] == tokens and report["after"]["usageStatus"] == "complete",
            "wrong final accounting summary")
    require(report["observedOversubscription"] is (variant == "before"), "wrong oversubscription disposition")
    ledger = database(data[f"databases/budget-{variant}/data/ledger.sqlite"])
    source = database(data[f"databases/budget-{variant}/usage.sqlite"])
    try:
        counts = dict(ledger.execute("SELECT event_type,COUNT(*) FROM ledger_events WHERE event_type LIKE 'model.%' GROUP BY event_type"))
        require(counts == {"model.accounting.prepared": 2, "model.accounting.dispatch_intent": dispatches, "model.usage.reconciled": 2},
                "ledger event counts differ from reproduction")
        state = json.loads(ledger.execute("SELECT state_json FROM workspace_state WHERE singleton=1").fetchone()[0])
        run = next(r for r in state["runs"] if r["id"] == report["after"]["runId"])
        require(run["usage"] == report["after"]["usage"] and run["accounting"] == report["after"]["summary"],
                "persisted parent usage differs from reproduction")
        require(run["limits"]["maxTotalTokens"] == 1200, "persisted limit changed")
        claims = {r[0]: json.loads(r[1]) for r in ledger.execute("SELECT physical_id,receipt_json FROM model_usage_claims")}
        receipts = {r[0]: json.loads(r[1]) for r in source.execute("SELECT physical_id,observation_json FROM model_usage_receipts")}
        require(claims == receipts and len(claims) == 2, "native source/ledger receipts differ")
        require(source.execute("SELECT COUNT(*) FROM model_usage_reservations").fetchone()[0] == 2, "wrong source reservation count")
        require(sum(r["usage"]["output"] for r in claims.values()) == tokens, "native receipt output differs")
        require(Counter(r["terminal"] for r in claims.values()) ==
                ({"response": 2} if variant == "before" else {"response": 1, "undispatched": 1}), "wrong native receipt terminals")
        if variant == "after":
            require(next(r for r in claims.values() if r["terminal"] == "undispatched")["usageStatus"] == "known_zero_undispatched",
                    "missing affirmative undispatched proof")
    finally:
        ledger.close()
        source.close()
    return {"dispatchIntents": dispatches, "providerEntriesBeforeFirstReceipt": dispatches, "canonicalOutputTokens": tokens,
            "nativeReceipts": 2, "sqliteEvidenceMatches": True}


def validate_gates(data):
    architecture = data["frozen/evidence/v1-architecture.log"]
    require(architecture == data["frozen/evidence/base-architecture.log"], "architecture failures changed")
    require(sum(line.startswith(b"- ") for line in architecture.splitlines()) == 7, "wrong architecture failure count")
    comparison = read_json(data, "frozen/evidence/api-comparison.json")
    require(comparison["observedEqual"] is True and comparison["errorsEqual"] is True, "public API differs")
    for key in ("observed", "errors", "budget"):
        require(comparison["base"][key] == comparison["candidate"][key], f"public API {key} changed")
    require(len(comparison["base"]["errors"]) == 4, "wrong public API failure count")
    require(data["frozen/evidence/v1-public-api.log"] == data["frozen/evidence/base-public-api.log"], "public API raw failures differ")
    race = read_json(data, "frozen/evidence/settlement-race-before-results.json")
    require(race["numFailedTests"] == 2 and race["numPendingTests"] == 11 and race["success"] is False,
            "base deterministic race failures missing")
    intermediate = read_json(data, "frozen/evidence/settlement-race-after-results.json")
    require(intermediate["success"] is False, "intermediate failed after report was replaced")
    return {"architectureBaselineFailures": 7, "architectureCandidateFailures": 7,
            "publicApiBaselineFailures": 4, "publicApiCandidateFailures": 4,
            "publicApiObservedAndBudgetsEqual": True}


def validate_review(data):
    prefix = "independent-review/"
    review = read_json(data, prefix + "independent-review-v1.json")
    require(review["sourceManifestSha256"] == FREEZE and review["baselineSha"] == BASE,
            "independent review source binding differs")
    require(review["frozen17MatchBeforeAndAfter"] is True and review["sourceEdits"] is False,
            "review changed frozen source")
    for item in review["evidence"]:
        check_bytes(data[prefix + safe_path(item["path"])], item, "review/" + item["path"])
    candidate = {v["path"]: v for v in read_json(data, "candidate-tree-before.json")["files"]}
    for dependency in read_json(data, prefix + "isolated-source-dependencies.json"):
        require(candidate[dependency["path"]]["sha256"] == dependency["sha256"],
                "independent review dependency differs from candidate")
    result = read_json(data, prefix + "results-v4.json")
    baseline = read_json(data, prefix + "baseline-results-v1.json")
    require(result["numTotalTests"] == 6 and result["numPassedTests"] == 5 and result["numFailedTests"] == 1,
            "independent candidate review disposition differs")
    require(baseline["numTotalTests"] == baseline["numFailedTests"] == 1 and baseline["numPassedTests"] == 0,
            "independent baseline review disposition differs")
    failures = []
    for report in (result, baseline):
        assertions = [a for s in report["testResults"] for a in s["assertionResults"]]
        failed = [a for a in assertions if a["status"] == "failed"]
        require(len(failed) == 1 and "expected 2 to be 3" in "\n".join(failed[0]["failureMessages"]),
                "stale duplicate response revision failure missing")
        failures.append(failed[0]["fullName"])
    require(failures[0] == failures[1], "candidate/baseline metadata failures differ")
    return {"candidatePassed": 5, "candidateFailedPreExisting": 1, "baselineFailedSameCase": 1,
            "addedToOriginal193": 0, "openIssue": "duplicate response accountingRevision 2 while durable revision 3"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--index", type=Path, default=Path(__file__).with_name(f"{STEM}-evidence-index-{DATE}.json"))
    parser.add_argument("--workspace", type=Path, help="optionally verify only the frozen 17 current source/test files")
    parser.add_argument("--list", action="store_true", help="include all verified archive member paths")
    args = parser.parse_args()
    index = json.loads(args.index.read_bytes())
    require(index["schemaVersion"] == 1 and index["baseSha"] == BASE and index["sourceManifestSha256"] == FREEZE, "wrong evidence index")
    companions = {}
    for item in index["companionArtifacts"]:
        path = safe_path(item["path"])
        require(path not in companions, "duplicate companion artifact")
        companions[path] = item
        check_bytes((args.index.parent / path).read_bytes(), item, path)
    regression_path = safe_path(index["regressionPath"])
    require(regression_path in companions, "regression summary is not a hash-bound companion")
    data = load_archive(index, args.index.parent)
    require(len(data) == index["memberCount"], "index member count differs")
    require(sha256(data["frozen/evidence-index.json"]) == index["originalEvidenceIndexSha256"], "frozen evidence index differs")
    owned = validate_source(data, args.workspace)
    runtime, runtime_files = test_keys(read_json(data, "frozen/evidence/v1-runtime-results.json"), 156, 17)
    host, host_files = test_keys(read_json(data, "frozen/evidence/v1-host-results.json"), 37, 6)
    require(not runtime & host and len(runtime | host) == 193, "original test cases overlap")
    regression = json.loads((args.index.parent / regression_path).read_bytes())
    require(regression["uniqueFinalTests"] == 193 and regression["fullG03Complete"] is False and
            regression["universalPhysicalOrInvoiceHardCap"] is False, "regression scope differs")
    verification = read_json(data, "frozen/verification.json")
    require(verification["sourceManifestSha256"] == FREEZE and verification["totalUniqueTests"] == 193 and
            verification["externalModelCalls"] == 0, "frozen verification binding differs")
    result = {"ok": True, "baseSha": BASE, "sourceManifestSha256": FREEZE, "ownedSourceFiles": len(owned),
              "candidateTrackedFiles": 6165, "archiveMembers": len(data), "uniqueFinalTests": 193,
              "runtime": {"files": 17, "passed": 156}, "host": {"files": 6, "passed": 37},
              "networkValidation": validate_network(data, runtime | host, runtime_files | host_files),
              "budgetBefore": validate_budget(data, "before", 2, 1400),
              "budgetAfter": validate_budget(data, "after", 1, 700),
              "independentReview": validate_review(data),
              "gates": validate_gates(data), "workspaceExact17Checked": args.workspace is not None,
              "status": "frozen candidate evidence reconciled; integration and independent review tracked separately",
              "limits": ["nominal allowance; no universal physical token or invoice hard cap",
                         "same 193 repeated cases counted once", "full G03 remains incomplete"]}
    if args.list:
        result["members"] = sorted(data)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, StopIteration, sqlite3.Error, tarfile.TarError) as error:
        print(json.dumps({"ok": False, "error": str(error)}), file=sys.stderr)
        sys.exit(1)
