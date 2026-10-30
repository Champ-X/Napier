#!/usr/bin/env python3
"""Verify two-type range-query evidence; do not execute archived code or replay timings."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import statistics
import tarfile

STEM = "two-type-event-range-queries"
DATE = "2026-10-30"


def require(ok, message):
    if not ok:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def cases(report):
    require(report["success"] and report["numFailedTests"] == report["numPendingTests"] == 0, "Regression did not pass")
    result = set()
    for suite in report["testResults"]:
        for case in suite["assertionResults"]:
            key = (suite["name"].split("/packages/runtime/test/")[-1], case["fullName"])
            require(case["status"] == "passed" and key not in result, "Invalid or duplicate raw test")
            result.add(key)
    require(len(result) == report["numTotalTests"] == report["numPassedTests"], "Test count differs")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, help="Compare four owned current files")
    parser.add_argument("--list", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    index = json.loads((root / f"{STEM}-evidence-index-{DATE}.json").read_text())
    def artifact(entry):
        require(Path(entry["file"]).name == entry["file"], "Nonlocal artifact path")
        data = (root / entry["file"]).read_bytes()
        require(digest(data) == entry["sha256"], "Artifact digest differs: " + entry["file"])
        return data
    artifact(index["reconciler"])
    artifact(index["archive"])
    regression = json.loads(artifact(index["regression"]))
    expected = {entry["path"]: entry for entry in index["members"]}
    require(len(expected) == len(index["members"]), "Duplicate indexed member")
    members = {}
    with tarfile.open(root / index["archive"]["file"], "r:gz") as archive:
        for item in archive:
            path = PurePosixPath(item.name)
            require(item.isfile() and not path.is_absolute() and ".." not in path.parts, "Unsafe member")
            require(item.name in expected and item.name not in members, "Unexpected or repeated member")
            data = archive.extractfile(item).read()
            require(digest(data) == expected[item.name]["sha256"] and len(data) == expected[item.name]["bytes"], "Member digest/size differs: " + item.name)
            require(not item.name.endswith((".sqlite", ".sqlite-wal", ".sqlite-shm")), "Unexpected archived database")
            members[item.name] = data
    require(set(members) == set(expected), "Missing member")
    read = lambda name: json.loads(members[name])
    commit = read("root/source-commit.json")
    receipt = read("validation/review-receipt.json")
    require(commit["commit"] == index["sourceCommit"] == regression["sourceCommit"], "Source commit differs")
    require(commit["tree"] == regression["sourceTree"], "Source tree differs")
    require(commit["receiptSha256"] == digest(members["validation/review-receipt.json"]), "Root validation binding differs")
    require(commit["ownedSources"] == regression["sourceManifest"] == receipt["ownedSourceManifest"], "Owned source set differs")
    require(len(commit["ownedSources"]) == 4, "Expected four owned sources")
    for entry in commit["ownedSources"]:
        require(digest(members["source/candidate/" + entry["path"]]) == entry["sha256"], "Candidate source differs")
        if args.workspace:
            require(digest((args.workspace / entry["path"]).read_bytes()) == entry["sha256"], "Current source differs: " + entry["path"])
    require(b"types.length !== 2" in members["source/candidate/packages/runtime/src/sqlite-event-range-query.ts"], "Two-type guard missing")
    broad_manifest = read("broad-v1/manifest.json")
    for path, expected_hash in broad_manifest.items():
        require(digest(members["broad-v1/" + path]) == expected_hash, "Rejected source binding differs")
    require(members["source/async-baseline/sqlite-ledger-read-worker.ts"] == members["source/baseline/packages/runtime/src/sqlite-ledger-read-worker.ts"], "Async baseline source differs")
    for kind, count in [("source", 2177), ("emitted", 4388)]:
        before = members[f"validation/{kind}-before.json"]
        require(before == members[f"validation/{kind}-after.json"] == members[f"validation/{kind}-after-async.json"], "Source/emitted changed during measurement")
        require(len(json.loads(before)) == count, "Frozen file count differs")
    emitted = {entry["path"]: entry["sha256"] for entry in read("validation/emitted-before.json")}
    for name in ["sqlite-ledger-query", "sqlite-ledger-read-worker", "sqlite-event-range-query"]:
        require(digest(members[f"emitted/candidate/{name}.js"]) == emitted[f"packages/runtime/dist/{name}.js"], "Measured emitted module differs")
    require(members["validation/compile.log"] == members["validation/strict.log"] == b"", "Compile/strict log not clean")
    require(receipt["validation"]["fullContractsRuntimeForceCompileExitCode"] == receipt["validation"]["newTypedRangeTestStrictExitCode"] == 0, "Compile/strict receipt failed")
    final_cases = cases(read("validation/tests.json"))
    require(len(final_cases) == 17 and final_cases == cases(read("broad-v1/tests.json")), "Final17case set differs")
    arch = members["validation/architecture.log"]
    api = members["validation/public-api.log"]
    require(arch == members["root/prior-baseline-architecture.log"] and arch.count(b"\n- ") == 7, "Architecture baseline differs")
    require(api == members["root/prior-public-api-working.log"] and api.count(b"\n- ") == 4, "Public API baseline differs")
    require(read("config/package.json")["engines"]["node"] == regression["minimumSupportedNode"] == ">=22.19.0", "Minimum Node version differs")
    require(read("config/runtime.json")["node"] == regression["measurementNode"] == "v24.19.0" and not regression["crossVersionRuntimeVerified"], "Runtime scope differs")

    protocol = read("validation/prespecified-protocol.json")
    require(digest(members["validation/holdout-benchmark.mjs"]) == protocol["scriptSha256"], "Prespecified driver changed")
    require(protocol["denseMedianWallRatioMaximum"] == 1.2 and protocol["scales"] == [25000, 250000], "Holdout gate changed")
    holdout = read("holdout/results.json")
    require(digest(members["holdout/results.json"]) == receipt["holdoutResultsSha256"], "Holdout receipt binding differs")
    order = ["baseline", "candidate", "candidate", "baseline"]
    require(holdout["protocol"]["order"] == protocol["order"] == order, "Holdout order differs")
    require(holdout["protocol"]["payloadJsonUtf8Bytes"] == protocol["payloadJsonUtf8Bytes"] == 256, "Payload size differs")
    require({(item["case"], item["scale"]) for item in holdout["results"]} == {(name, scale) for name in ["sparse2", "dense2", "dense3", "dense64"] for scale in [25000, 250000]} and len(holdout["results"]) == 8, "Holdout matrix differs")
    def samples(item, expected_rows):
        raw = item["samples"]
        require(len(raw) == 12 and len({row["outputSha256"] for row in raw}) == 1, "Sample count/output mismatch")
        require({(row["round"], row["sample"]) for row in raw} == {(round_index, sample) for round_index in range(4) for sample in range(3)}, "Sample identity differs")
        for row in raw:
            require(row["variant"] == order[row["round"]] and row["rows"] == expected_rows, "Sample order/row count differs")
        for variant in ["baseline", "candidate"]:
            selected = [row for row in raw if row["variant"] == variant]
            require(len(selected) == 6, "Variant sample count differs")
            require(statistics.median(row["wallMs"] for row in selected) == item["summary"][variant]["wallMs"], "Wall median differs")
            require(statistics.median(row["cpuMs"] for row in selected) == item["summary"][variant]["cpuMs"], "CPU median differs")
        ratio = item["summary"]["candidate"]["wallMs"] / item["summary"]["baseline"]["wallMs"]
        require(ratio == item["wallRatio"], "Wall ratio differs")
        return raw[0]["outputSha256"]
    require(regression["synchronousHoldout"]["summary"] == receipt["summary"], "Holdout summary receipt differs")
    sync_hashes = {}
    for item in holdout["results"]:
        require(item["types"] == {"sparse2": 2, "dense2": 2, "dense3": 3, "dense64": 64}[item["case"]] and item["sparse"] == (item["case"] == "sparse2"), "Workload cardinality differs")
        summary = next(row for row in receipt["summary"] if row["case"] == item["case"] and row["scale"] == item["scale"])
        require(summary["baselineWallMedianMs"] == item["summary"]["baseline"]["wallMs"] and summary["candidateWallMedianMs"] == item["summary"]["candidate"]["wallMs"] and summary["wallRatio"] == item["wallRatio"], "Reported holdout medians differ")
        sync_hashes[(item["case"], item["scale"])] = samples(item, 2 if item["sparse"] else item["scale"])
        require(item["candidateActivation"] == ("compound_merge" if item["types"] == 2 else "existing_in"), "Activation cardinality differs")
        require(item["withinRetentionRule"] == (item["sparse"] or item["wallRatio"] <= 1.2) and item["withinRetentionRule"], "Prespecified holdout rule failed")
    require(regression["synchronousHoldout"]["rawSamples"] == sum(len(x["samples"]) for x in holdout["results"]) == 96, "Synchronous sample total differs")
    seed_map = {Path(item["path"]).name: item for item in read("validation/seed-manifest.json")}
    require(len(seed_map) == 8 and all(item["payloadJsonUtf8BytesMin"] == item["payloadJsonUtf8BytesMax"] == 256 for item in seed_map.values()), "Recorded seed payload boundary differs")
    asynchronous = read("validation/async-results.json")
    require(asynchronous["protocol"]["order"] == order and len(asynchronous["results"]) == 2, "Async matrix/order differs")
    require({item["scale"] for item in asynchronous["results"]} == {25000, 250000}, "Async scales differ")
    require(regression["asyncSupplement"]["summary"] == [{"scale": item["scale"], "summary": item["summary"], "wallRatio": item["wallRatio"], "databaseSha256": item["databaseSha256"]} for item in asynchronous["results"]], "Reported async summary differs")
    for item in asynchronous["results"]:
        require(samples(item, 2) == sync_hashes[("sparse2", item["scale"])], "Async complete output differs from sync oracle")
        require(item["databaseUnchanged"] and item["databaseSha256"] == seed_map[Path(item["database"]).name]["sha256"], "Async database binding differs")
    require(regression["asyncSupplement"]["rawSamples"] == sum(len(x["samples"]) for x in asynchronous["results"]) == 24, "Async sample total differs")
    require(regression["asyncSupplement"]["addsFunctionalTestCases"] == 0 and regression["archivedDatabaseBytes"] == 0, "Evidence scope differs")
    broad = read("validation/prior-broad-results.json")
    failures = []
    for item in broad["results"]:
        samples(item, 2 if item["sparse"] else item["scale"])
        require(item["withinRetentionRule"] == (item["sparse"] or item["wallRatio"] <= 1.2), "Historical gate changed")
        if not item["withinRetentionRule"]:
            failures.append({"case": item["case"], "scale": item["scale"], "wallRatio": item["wallRatio"]})
    require(len(failures) == 3 and failures == regression["rejectedBroadActivation"]["rejectedCases"], "Broad activation failures missing")
    require(digest(members["validation/prior-broad-results.json"]) == regression["rejectedBroadActivation"]["resultsSha256"], "Broad results binding differs")
    if args.list:
        print("\n".join(sorted(members)))
    print(json.dumps({"verified": True, "members": len(members), "ownedSources": 4, "regressionCases": 17,
                      "synchronousHoldoutSamples": 96, "asyncSupplementSamples": 24,
                      "rejectedBroadCases": len(failures), "databaseReplay": False,
                      "workspaceCompared": args.workspace is not None}, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, tarfile.TarError) as error:
        raise SystemExit("Evidence reconciliation failed: " + str(error)) from error
