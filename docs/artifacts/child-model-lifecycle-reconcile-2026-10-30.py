#!/usr/bin/env python3
"""Verify child lifecycle evidence without extracting or executing archived code."""
import argparse
import hashlib
import json
import tarfile
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--workspace", type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parent
index = json.loads((root / "child-model-lifecycle-evidence-index-2026-10-30.json").read_text())
digest = lambda data: hashlib.sha256(data).hexdigest()
archive = root / index["archive"]
assert digest(archive.read_bytes()) == index["archiveSha256"]
with tarfile.open(archive) as bundle:
    entries = bundle.getmembers()
    assert len(entries) == len({entry.name for entry in entries}) == len(index["members"])
    assert all(entry.isfile() for entry in entries)
    contents = {entry.name: bundle.extractfile(entry).read() for entry in entries}
for entry in index["members"]:
    data = contents[entry["path"]]
    assert len(data) == entry["bytes"] and digest(data) == entry["sha256"]
prefix = "napier-g03-parity-delivery-20261030/"
read = lambda name: json.loads(contents[prefix + name])
manifest = read("delivery-manifest.json")
for entry in manifest["artifacts"]:
    data = contents[prefix + entry["path"]]
    assert len(data) == entry["bytes"] and digest(data) == entry["sha256"]
source = read("candidate-source-manifest.json")
assert digest(contents[prefix + "candidate.patch"]) == source["patchSha256"] == manifest["patchSha256"]

def cases(name):
    report = read(name)
    values = [(Path(suite["name"]).name, tuple(case["ancestorTitles"]), case["title"], case["fullName"], case["status"])
              for suite in report["testResults"] for case in suite["assertionResults"]]
    assert all(value[-1] == "passed" for value in values) and len(values) == len(set(values))
    return set(values)

original = cases("final-tests.json")
corrected = cases("v3-new-tests.json")
root55 = cases("root-integration-v2/tests.json")
root20 = cases("root-integration-v3/tests.json")
assert [len(value) for value in (original, corrected, root55, root20)] == [225, 38, 55, 20]
owned = {Path(entry["path"]).name for entry in source["files"] if entry["path"].endswith(".test.ts")}
assert {case for case in original if case[0] in owned} == corrected
assert {case for case in root55 if case[0] in owned} == corrected
assert root20 == {case for case in corrected if case[0] != "model-call-extension-mutation-guards.test.ts"}
previous = {entry["path"]: entry["sha256"] for entry in read("candidate.v2-source-manifest.json")["files"]}
changed = [entry["path"] for entry in source["files"] if entry["sha256"] != previous[entry["path"]]]
assert len(changed) == 5 and all(Path(name).name in owned for name in changed)
result = read("root-integration-v3/regression.json")
assert result["passed"] and result["sourceStable"] and result["emittedStable"]
assert not read("root-integration-v2/regression.json")["passed"]
if args.workspace:
    for relative, expected in result["sourceManifest"]["files"].items():
        assert digest((args.workspace / relative).read_bytes()) == expected, relative
print(json.dumps({"verifiedMembers": len(contents), "caseCounts": [225, 38, 55, 20],
                  "countsOverlap": True, "sourceCommit": index["sourceCommit"],
                  "workspaceChecked": str(args.workspace) if args.workspace else None}, indent=2))
