#!/usr/bin/env python3
"""Validate retained G04 evidence without extraction, execution or network access."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import tarfile

SOURCE_COMMIT = "bf6a34cdeede8e95e7932339de736f209954ecc5"
INTEGRATION_BASE = "c3734a07f1abc93357f2becf8e255c35d60dbce3"
INTEGRATION_TREE = "338ce236b3f90c7df8106c63b0cf95f7edba4f94"
REVIEW_SHA256 = "48d5f478ffb1167bb8d66d1f11d7980b7f6d3a5476c99a97312264606ac320d8"


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def require(value: bool, message: str) -> None:
    if not value:
        raise ValueError(message)


def safe_path(value: str) -> str:
    require(isinstance(value, str) and bool(value) and "\\" not in value, "Invalid relative path")
    require(not PurePosixPath(value).is_absolute() and all(part not in ("", ".", "..") for part in value.split("/")), "Unsafe relative path")
    return value


def passed_cases(report: dict, expected: int, file_count: int) -> set[tuple[str, str]]:
    require(report["success"] is True and report["numTotalTests"] == report["numPassedTests"] == expected, "Test count mismatch")
    require(all(report[field] == 0 for field in ["numFailedTests", "numPendingTests", "numTodoTests"]), "Non-passing test disposition")
    files, cases = set(), set()
    for suite in report["testResults"]:
        parts = suite["name"].split("/packages/runtime/test/")
        require(len(parts) == 2 and suite["status"] == "passed", "Unexpected test suite")
        name = "packages/runtime/test/" + safe_path(parts[1])
        require(name not in files, "Duplicate test file")
        files.add(name)
        for assertion in suite["assertionResults"]:
            key = (name, assertion["fullName"])
            require(key not in cases and assertion["status"] == "passed" and not assertion["failureMessages"], "Duplicate or failed test assertion")
            cases.add(key)
    require(len(cases) == expected and len(files) == file_count, "Actual assertion/file count differs")
    return cases


def validate_review(contents: dict[str, bytes], owned: dict[str, str]) -> dict:
    prefix = "independent-review/"
    raw = contents[prefix + "independent-review-v1.json"]
    require(digest(raw) == REVIEW_SHA256, "Independent review receipt changed")
    review = json.loads(raw)
    require(review["candidateBase"] == "e10a7bd39b71dc74dfb4bbd05f6c5254bedd5696" and review["exact15MatchAfter"] is True and review["sourceEdits"] is False, "Independent review source binding differs")
    require(review["findings"] == review["newBlockersFound"] == [], "Independent review reported a blocker")
    require(digest(contents["history/delivery-manifest-original.json"]) == review["deliveryManifestSha256"], "Review delivery binding changed")
    for item in review["evidence"]:
        data = contents[prefix + safe_path(item["path"])]
        require(len(data) == item["bytes"] and digest(data) == item["sha256"], "Review evidence binding changed")
    source = json.loads(contents[prefix + "source-after-check.json"])
    require(len(source) == 15 and {row["path"]: row["sha256"] for row in source} == owned and all(row["workspaceMatches"] is True and row["isolatedMatches"] is True for row in source), "Review source scope changed")
    result = json.loads(contents[prefix + "result.json"])
    probes = review["independentProbes"]
    require(result["ok"] is True and len(result["checks"]) == len(set(result["checks"])) == probes["groupedChecksPassed"] == 4, "Independent grouped probe count changed")
    require(probes["fixtureExitCode"] == 73 and probes["resultingRunStatus"] == result["sourceRunStatus"] == "interrupted", "Independent native crash disposition changed")
    require(probes["renameCount"] == 1 and result["renames"] == "rename\n" and probes["externalModelCalls"] == result["externalModelCalls"] == 0, "Independent native operation count changed")
    return {"groupedProbesPassed": 4, "newBlockers": 0, "addedToOriginal133": 0}


def git_object_id(kind: str, value: bytes) -> str:
    return hashlib.sha1(f"{kind} {len(value)}\0".encode() + value).hexdigest()


def validate_source_commit(contents: dict[str, bytes], owned: dict[str, str]) -> None:
    raw = contents["integration/git-proof/commit"]
    require(git_object_id("commit", raw) == SOURCE_COMMIT and raw.splitlines()[0] == f"tree {INTEGRATION_TREE}".encode(), "G04 source commit/tree binding changed")
    trees = {}
    for name, data in contents.items():
        if name.startswith("integration/git-proof/trees/"):
            tree_id = name.rsplit("/", 1)[1]
            require(git_object_id("tree", data) == tree_id, "Git tree proof changed")
            entries, offset = {}, 0
            while offset < len(data):
                space, nul = data.index(b" ", offset), data.index(b"\0", offset)
                mode, entry = data[offset:space].decode(), data[space + 1:nul].decode()
                require(entry not in entries and nul + 21 <= len(data), "Invalid Git tree entry")
                entries[entry] = (mode, data[nul + 1:nul + 21].hex())
                offset = nul + 21
            trees[tree_id] = entries
    used = set()
    for path in owned:
        tree = INTEGRATION_TREE
        parts = safe_path(path).split("/")
        for part in parts[:-1]:
            used.add(tree)
            mode, tree = trees[tree][part]
            require(mode == "40000", "Source path traverses non-tree")
        used.add(tree)
        mode, blob = trees[tree][parts[-1]]
        require(mode in ("100644", "100755") and git_object_id("blob", contents["frozen/" + path]) == blob, "Committed source differs from frozen file")
    require(used == set(trees), "Unexpected or unused source tree proof")


def validate_integration(contents: dict[str, bytes], owned: dict[str, str], owner_cases: set[tuple[str, str]]) -> dict:
    prefix = "integration/"
    read = lambda name: json.loads(contents[prefix + name])
    result = read("results/regression.json")
    source = read("napier-g03-g04-integration-source-20261030.json")
    commits = read("napier-g03-g04-source-commits-20261030.json")
    require(result["passed"] is True and result["sourceStable"] is True and result["emittedStable"] is True, "Root integration failed or drifted")
    require(result["sourceManifest"] == source and source["base"] == commits["base"] == INTEGRATION_BASE and source["tree"] == commits["finalTree"] == INTEGRATION_TREE, "Integration base/tree differs")
    committed = [entry for entry in commits["commits"] if entry["scope"] == "G04"]
    require(len(committed) == 1 and committed[0]["commit"] == SOURCE_COMMIT and committed[0]["tree"] == INTEGRATION_TREE and committed[0]["files"] == source["G04"] == owned, "Integration G04 source binding differs")
    validate_source_commit(contents, owned)
    for kind, expected in [("source", 3633), ("emitted", 5121)]:
        before = read(f"results/{kind}-before.json")
        require(before == read(f"results/{kind}-after.json") and len(before) == result[kind + "Count"] == expected, "Integration manifests changed")
        if kind == "source":
            require(all(before.get(path) == sha for path, sha in source["files"].items()), "Integration owned source changed")
    required = {"full-compile", "bundled-skills", "sandbox-assets", "g03-and-projection", "g04-batch", "web-types", "diff-check"}
    commands = {check["name"]: check for check in result["checks"]}
    require(len(commands) == len(result["checks"]) and set(commands) == required | {"architecture", "public-api"}, "Integration command scope differs")
    for name, command in commands.items():
        log = contents[prefix + "results/" + name + ".log"]
        require(PurePosixPath(command["log"]).name == name + ".log" and digest(log) == command["sha256"], "Integration command log changed")
        require(command["required"] == (name in required) and command["exitCode"] == (0 if name in required else 1), "Integration check disposition changed")
    require(commands["full-compile"]["argv"] == ["node", "node_modules/typescript/bin/tsc", "-b", "packages/runtime", "apps/cli", "apps/server", "--force"], "Integration compile is not the retained strict build")
    require(commands["web-types"]["argv"] == ["node", "node_modules/typescript/bin/tsc", "-p", "apps/web/tsconfig.json", "--noEmit"], "Integration Web typecheck changed")
    cases = []
    for label, count, files in [("g03", 39, 5), ("g04", 36, 2)]:
        data = contents[prefix + f"results/{label}.json"]
        receipt = result["reports"][label]
        require(digest(data) == receipt["sha256"] and receipt["tests"] == receipt["passed"] == count and receipt["files"] == files and receipt["failed"] == receipt["skipped"] == 0, "Integration test receipt differs")
        cases.append(passed_cases(json.loads(data), count, files))
    require(not cases[0] & cases[1] and len(cases[0] | cases[1]) == 75 and cases[1] <= owner_cases, "Integration case identity/count changed")
    require(contents[prefix + "results/architecture.log"] == contents["verification/napier-g04-architecture-base-20261030.log"], "Integration architecture findings changed")
    require(contents[prefix + "results/public-api.log"] == contents["verification/napier-g04-batch-isolated-public-api-v1-20261030.log"], "Integration API findings changed")
    return {"sourceCommit": SOURCE_COMMIT, "strictCompile": "passed", "webTypes": "passed", "focusedCasesPassed": 75,
        "g03AndProjectionCases": 39, "g04RepeatedCases": 36, "addedToOriginal133": 0}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--index", type=Path)
    parser.add_argument("--workspace", type=Path, help="Compare the fifteen owned source/test files")
    parser.add_argument("--snapshot", type=Path, help="Also compare all frozen source and emitted files")
    parser.add_argument("--list", action="store_true")
    args = parser.parse_args()
    directory = Path(__file__).resolve().parent
    index_path = args.index or directory / "workspace-operation-batch-recovery-evidence-index-2026-10-30.json"
    index = json.loads(index_path.read_text())
    require(index["sourceCommit"] == SOURCE_COMMIT, "Index source commit changed")
    archive = args.archive or index_path.parent / safe_path(index["archive"]["name"])
    companions = index["companionArtifacts"]
    require(len({item["name"] for item in companions}) == len(companions), "Duplicate companion artifact")
    require({item["name"] for item in companions} == {
        "workspace-operation-batch-recovery-regression-2026-10-30.json",
        "workspace-operation-batch-recovery-reconcile-2026-10-30.py"}, "Companion artifact scope differs")
    for item in companions:
        data = (index_path.parent / safe_path(item["name"])).read_bytes()
        require(len(data) == item["bytes"] and digest(data) == item["sha256"], "Companion artifact changed")
    raw = archive.read_bytes()
    require(len(raw) == index["archive"]["bytes"] and digest(raw) == index["archive"]["sha256"], "Archive binding changed")
    expected = index["members"]
    contents: dict[str, bytes] = {}
    with tarfile.open(archive, "r:gz") as bundle:
        for member in bundle:
            safe_path(member.name)
            require(member.isfile(), f"Unsafe member: {member.name}")
            require(member.name not in contents and member.name in expected, f"Unexpected member: {member.name}")
            data = bundle.extractfile(member).read()
            record = expected[member.name]
            require(len(data) == record["bytes"] and digest(data) == record["sha256"], f"Member changed: {member.name}")
            contents[member.name] = data
    require(set(contents) == set(expected), "Missing archive member")
    read = lambda name: json.loads(contents[name])
    before = read("before/case-v1/result.json")
    after = read("after/case-v2/result.json")
    require(before["evidence"] == [] and before["assessment"]["eligible"] is False, "BEFORE no longer reproduces the gap")
    require(len(after["evidence"]) == 2 and after["assessment"]["eligible"] is True, "AFTER does not retain both moves")
    for label, value in [("before", before), ("after", after)]:
        require(value["before"] == value["after"], f"{label}: bytes or file identity changed")
        require(len(value["renamed"]) == 2 and value["externalModelCalls"] == 0, f"{label}: execution count changed")
        require(value["crash"]["exitCode"] == 73 and value["crash"]["terminalCount"] == 2, f"{label}: crash boundary changed")
    require(after["continued"]["status"] == "completed" and after["continuationProviderCalls"] == 3, "Read-only continuation changed")
    require(len([event for event in after["continuationEvents"] if event["type"] == "tool.completed" and event["payload"].get("toolName") == "read_file"]) == 2, "Expected two actual reads")
    require(len(after["attempts"]) == 1 and after["attempts"][0]["status"] == "completed", "Duplicate continuation")
    for shape in ["moves", "mixed", "mixed-reverse"]:
        for checkpoint in ["after-effect", "before-commit"]:
            value = read(f"after/{shape}-{checkpoint}/result.json")
            require(value["before"] == value["after"] and value["externalModelCalls"] == 0, "Batch mutated workspace or used external model")
            require(value["run"]["status"] == "interrupted" and value["assessment"]["eligible"] == (checkpoint == "after-effect"), "Batch disposition changed")
            markers = [event for event in value["events"] if event["type"] == "tool.operation.effect_indeterminate"]
            require(len(markers) == 1, "Native fixture must contain one actual unresolved tail")
            call_id = markers[0]["payload"]["parentCallId"]
            require(not any(event["type"] in ["tool.completed", "tool.failed"] and event["payload"].get("callId") == call_id for event in value["events"]), "Fabricated tool terminal")
            require(not any(event["type"] == "tool.operation.settled" and event["payload"].get("parentCallId") == call_id for event in value["events"]), "Fabricated settlement")
            if checkpoint == "after-effect":
                require(value["continued"]["status"] == "completed" and value["providerCalls"] == 3, "Batch continuation failed")
            else:
                require(value["providerCalls"] == 0 and not value["continuationEvents"], "Pending batch was replayed")
    report = read("verification/napier-g04-batch-isolated-tests-v2-20261030.json")
    owner_cases = passed_cases(report, 133, 9)
    require(contents["verification/napier-g04-batch-isolated-strict-v2-20261030.log"] == b"", "Strict check contains diagnostics")
    require(contents["verification/napier-g04-batch-isolated-architecture-v2-20261030.log"] == contents["verification/napier-g04-architecture-base-20261030.log"], "Architecture findings differ from base")
    for kind in ["source", "emitted"]:
        reconciliation = read(f"after/{kind}-after-v2.json")
        require(reconciliation["differences"] == [], f"Frozen {kind} drifted")
        if args.snapshot:
            hashes = read(f"after/{kind}-before-v2.json")
            for name, sha in hashes.items():
                require(digest((args.snapshot / name).read_bytes()) == sha, f"Snapshot {kind} changed: {name}")
    owned = read("verification/napier-g04-batch-owned-source-v2-20261030.json")
    for name, sha in owned.items():
        require(digest(contents["frozen/" + name]) == sha, f"Frozen owned source changed: {name}")
        if args.workspace:
            require(digest((args.workspace / name).read_bytes()) == sha, f"Workspace source changed: {name}")
    review = validate_review(contents, owned)
    integration = validate_integration(contents, owned, owner_cases)
    receipt = read("verification/regression-receipt.json")
    require(receipt["sourceCommit"] == SOURCE_COMMIT and receipt["ownedSourceFiles"] == owned and receipt["validation"]["passedTests"] == 133, "Regression summary source/original count changed")
    require(receipt["independentReview"]["groupedProbesPassed"] == 4 and receipt["independentReview"]["addedToOriginal133"] == 0 and receipt["supplementalIntegration"]["focusedCasesPassed"] == 75 and receipt["supplementalIntegration"]["addedToOriginal133"] == 0, "Supplemental evidence was counted into original total")
    if args.list:
        for name in sorted(contents):
            print(name)
    print(json.dumps({"ok": True, "members": len(contents), "ownedFiles": len(owned), "testsPassed": 133,
        "nativeUnresolvedTailPerProcess": 1, "beforeEligible": False, "afterEligible": True,
        "externalModelCalls": 0, "independentReview": review, "supplementalIntegration": integration,
        "workspaceChecked": bool(args.workspace), "snapshotChecked": bool(args.snapshot)}))


if __name__ == "__main__":
    main()
