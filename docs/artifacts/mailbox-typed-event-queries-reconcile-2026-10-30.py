#!/usr/bin/env python3
"""Validate archived mailbox evidence without executing archived scripts."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import sqlite3
import statistics
import tarfile
import tempfile

STEM = "mailbox-typed-event-queries"
DATE = "2026-10-30"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(value):
    return hashlib.sha256(value).hexdigest()


def checked_file(root, entry):
    name = entry["file"]
    require(Path(name).name == name, "Nonlocal artifact filename")
    data = (root / name).read_bytes()
    require(digest(data) == entry["sha256"], f"Artifact digest differs: {name}")
    return data


def cases(report):
    require(report["success"] and report["numFailedTests"] == 0, "Regression failed")
    require(report["numPendingTests"] == 0, "Unexpected skipped test")
    found = set()
    for suite in report["testResults"]:
        for case in suite["assertionResults"]:
            require(case["status"] == "passed", "Nonpassing raw case")
            identity = (suite["name"].split("/packages/runtime/test/")[-1], case["fullName"])
            require(identity not in found, "Duplicate raw case identity")
            found.add(identity)
    require(len(found) == report["numTotalTests"] == report["numPassedTests"], "Raw case count differs")
    return found


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, help="Compare the eight current owned files")
    parser.add_argument("--list", action="store_true", help="List verified archive members")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    index = json.loads((root / f"{STEM}-evidence-index-{DATE}.json").read_text())
    checked_file(root, index["reconciler"])
    checked_file(root, index["archive"])
    regression = json.loads(checked_file(root, index["regression"]))
    expected = {entry["path"]: entry for entry in index["members"]}
    require(len(expected) == len(index["members"]), "Duplicate indexed member")
    members = {}
    with tarfile.open(root / index["archive"]["file"], "r:gz") as archive:
        for item in archive:
            path = PurePosixPath(item.name)
            require(item.isfile() and not path.is_absolute() and ".." not in path.parts, "Unsafe archive member")
            require(item.name in expected and item.name not in members, "Unknown or duplicate archive member")
            data = archive.extractfile(item).read()
            entry = expected[item.name]
            require(len(data) == entry["bytes"] == item.size, f"Member size differs: {item.name}")
            require(digest(data) == entry["sha256"], f"Member digest differs: {item.name}")
            members[item.name] = data
    require(set(members) == set(expected), "Missing archive member")
    read_json = lambda name: json.loads(members[name])
    manifest = read_json("probe/candidate-manifest.json")
    source_commit = read_json("root-review/source-commit.json")
    require(source_commit["commit"] == regression["sourceCommit"] == index["sourceCommit"], "Source commit differs")
    require(source_commit["tree"] == regression["sourceTree"], "Source tree differs")
    require(source_commit["sourceManifest"] == manifest, "Commit source manifest differs")
    require(source_commit["sourceManifestSha256"] == digest(members["probe/candidate-manifest.json"]), "Commit source manifest digest differs")
    require(manifest["paths"] == regression["sourceManifest"] and len(manifest["paths"]) == 8, "Owned source set differs")
    for entry in manifest["paths"]:
        path = entry["path"]
        require(digest(members["source/candidate/" + path]) == entry["sha256"], "Owned source hash differs")
        if args.workspace:
            require(digest((args.workspace / path).read_bytes()) == entry["sha256"], "Workspace source differs: " + path)
    strict_before = read_json("root-review/strict-result.json")
    original_test = next(entry for entry in strict_before["source"]["paths"] if "/test/" in entry["path"])
    require(digest(members["source/pre-guard/subagent-mailbox-typed-query.test.ts"]) == original_test["sha256"], "Historical test binding differs")
    require(strict_before["exitCode"] == 2 and digest(members["root-review/strict.log"]) == strict_before["logSha256"], "Initial strict failure missing")
    require(members["probe/new-test-strict-v2.log"] == b"", "Final strict log is not clean")
    commands = read_json("verification/owner-command-results.json")
    require(commands["baselineCompileExitCode"] == commands["candidateCompileExitCode"] == commands["newTestStrictExitCode"] == 0, "Compile or strict receipt failed")
    require(members["probe/baseline-compile-v1.log"] == members["probe/candidate-compile-v1.log"] == b"", "Compilation log is not clean")
    full_report = read_json("probe/candidate-regression-v1.json")
    require(len(full_report["testResults"]) == 16, "Regression suite count differs")
    full = cases(full_report)
    final = cases(read_json("probe/new-test-regression-v2.json"))
    require(len(full) == 146 and len(final) == 8 and final <= full, "146-case / final-eight subset differs")

    order = [("baseline", "round1"), ("candidate", "round2"), ("candidate", "round3"), ("baseline", "round4")]
    require(regression["balancedComparison"]["order"] == [{"variant": v, "round": r} for v, r in order], "Actual round order differs")
    all_rows, identities, intervals = [], set(), []
    for variant, round_name in order:
        report = read_json(f"probe/{variant}-{round_name}-result-v3.json")
        require(len(cases(report)) == 1, "Measurement runner failed")
        suite = report["testResults"][0]
        intervals.append((suite["startTime"], suite["endTime"]))
        rows = read_json(f"probe/{variant}-{round_name}-measurements-v3.json")
        require(len(rows) == 60, "Round sample count differs")
        for row in rows:
            require((row["variant"], row["round"]) == (variant, round_name), "Round binding differs")
            key = (variant, round_name, row["noiseEvents"], row["name"], row["iteration"])
            require(key not in identities and row["iteration"] in range(5), "Duplicate or invalid sample identity")
            identities.add(key)
            require(row["rows"] == sum(trace["rows"] for trace in row["traces"]), "Native query row sum differs")
            count, name = row["noiseEvents"], row["name"]
            before = {"prepare_checkpoint": 3 * count + 18, "accept_duplicate": count + 3,
                      "inspect": count + 6, "continuation_mailbox": count + 3}
            after = {"prepare_checkpoint": 5, "accept_duplicate": 2, "inspect": 3, "continuation_mailbox": 2}
            require(count in [100, 10000, 100000] and name in before, "Unexpected workload")
            require(row["rows"] == (before if variant == "baseline" else after)[name], "Measured returned-row invariant differs")
        all_rows.extend(rows)
    require(all(intervals[i][1] <= intervals[i + 1][0] for i in range(3)), "Runs were not sequential BCCB")
    require(len(all_rows) == len(identities) == regression["balancedComparison"]["rawSamples"] == 240, "Total raw sample count differs")
    summary_keys = [(item["noiseEvents"], item["operation"]) for item in regression["balancedComparison"]["summary"]]
    expected_keys = {(count, name) for count in [100, 10000, 100000] for name in before}
    require(len(summary_keys) == 12 and set(summary_keys) == expected_keys, "Summary workload coverage differs")
    for summary in regression["balancedComparison"]["summary"]:
        rows = [row for row in all_rows if row["noiseEvents"] == summary["noiseEvents"] and row["name"] == summary["operation"]]
        require(len(rows) == 20 and {row["outputSha256"] for row in rows} == {summary["outputSha256"]}, "Complete output hashes differ")
        for variant in ["baseline", "candidate"]:
            selected = [row for row in rows if row["variant"] == variant]
            expected_summary = summary[variant]
            require(len(selected) == expected_summary["samples"] == 10, "Variant sample count differs")
            require(statistics.median(row["wallMs"] for row in selected) == expected_summary["wallMsMedian"], "Wall median differs")
            require(statistics.median(row["cpuUserMs"] + row["cpuSystemMs"] for row in selected) == expected_summary["cpuMsMedian"], "CPU median differs")
            require(sorted({row["rows"] for row in selected}) == expected_summary["returnedRows"], "Summary returned rows differ")
            require([min(row["rss"] for row in selected), max(row["rss"] for row in selected)] == expected_summary["boundaryRssBytesRange"], "RSS boundary range differs")

    seed_counts = []
    with tempfile.TemporaryDirectory(prefix="napier-mailbox-evidence-") as directory:
        for seed in regression["seeds"]:
            data = members[seed["archiveMember"]]
            require(digest(data) == seed["databaseFileSha256"], "Immutable seed digest differs")
            path = Path(directory) / f"seed-{seed['noiseEvents']}.sqlite"
            path.write_bytes(data)
            db = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)
            event_hash, count = hashlib.sha256(), 0
            for (event_json,) in db.execute("SELECT event_json FROM ledger_events ORDER BY thread_id, seq"):
                event_hash.update(event_json.encode())
                event_hash.update(b"\n")
                count += 1
            db.close()
            require(count == seed["events"] and event_hash.hexdigest() == seed["orderedEventJsonSha256"], "Seed event stream differs")
            seed_counts.append(count)
    require(len(seed_counts) == 3, "Expected exactly three immutable seeds")
    gates = read_json("root-review/gates.json")
    logs = {item["name"]: members["root-review/" + Path(item["log"]).name] for item in gates["checks"]}
    require(logs["baseline"] == logs["candidate"] and logs["baseline"].count(b"\n- ") == 7, "Clean architecture baseline differs")
    require(logs["baseline-user-overlay"] == members["root-review/architecture-working.log"] and logs["baseline-user-overlay"].count(b"\n- ") == 8, "Overlay architecture baseline differs")
    require(members["root-review/public-api-working.log"].count(b"\n- ") == 4, "Public API finding count differs")
    require(b"projection mismatch" in members["initial-probe/run-v1.log"], "Initial seed failure missing")
    for name in ["candidate-paired-v1.log", "baseline-round1-v2.log"]:
        require(b"Lease token is required" in members["probe/" + name], "Lease failure missing")
    diagnostic = read_json("diagnostic/sql-plan-probe.json")
    require(diagnostic["readOnly"] and len({entry["sha256"] for entry in diagnostic["results"].values()}) == 1, "SQL diagnostic output differs")
    require(all(entry["rows"] == 3 for entry in diagnostic["results"].values()), "SQL diagnostic row count differs")
    if args.list:
        print("\n".join(sorted(members)))
    print(json.dumps({"verified": True, "members": len(members), "ownedSources": 8,
                      "uniqueRegressionCases": 146, "finalRecheckSubset": 8,
                      "balancedRawSamples": len(all_rows), "immutableSeedEventCounts": seed_counts,
                      "workspaceCompared": args.workspace is not None}, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, sqlite3.Error, tarfile.TarError) as error:
        raise SystemExit("Evidence reconciliation failed: " + str(error)) from error
