#!/usr/bin/env python3
"""Verify retained memory freshness evidence without executing archived code."""
import argparse
from collections import Counter
import hashlib
import json
import tarfile
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--workspace", type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parent
index = json.loads((root / "memory-index-freshness-evidence-index-2026-10-30.json").read_text())
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
prefix = "napier-g07-memory-freshness-evidence-20261030/"
read = lambda name: json.loads(contents[prefix + name])
manifest = read("manifest.json")
for entry in manifest["artifacts"]:
    data = contents[prefix + entry["path"]]
    assert len(data) == entry["bytes"] and digest(data) == entry["sha256"]
receipt = read("root-source-commit.json")
assert receipt["commit"] == index["sourceCommit"]
for relative, expected in receipt["sourceManifest"]["files"].items():
    assert digest(contents[prefix + "source/" + relative]) == expected
    if args.workspace:
        assert digest((args.workspace / relative).read_bytes()) == expected, relative
assert {entry["path"]: entry["sha256"] for entry in read("independent/review.json")["files"]} == receipt["sourceManifest"]["files"]
assert read("integrated/source-manifest.json")["files"] == receipt["sourceManifest"]["files"]
specs = {"before": ("before/tests.json", 1, 0, 2),
         "initial36": ("initial-after/tests.json", 3, 36, 0),
         "final73": ("final-isolated/tests.json", 8, 73, 0),
         "integrated23": ("integrated/tests.json", 4, 23, 0),
         "independent68": ("independent/tests.json", 8, 68, 0)}
identities = {}
record = read("case-identity-overlap.json")
for label, (name, files, passed, failed) in specs.items():
    report = read(name)
    assert len(report["testResults"]) == files
    assert report["numPassedTests"] == passed and report["numFailedTests"] == failed
    assert report["success"] == (failed == 0)
    rows = [{"file": "packages/runtime/test/" + Path(suite["name"]).name,
             "ancestorTitles": case["ancestorTitles"], "title": case["title"],
             "fullName": case["fullName"], "status": case["status"]}
            for suite in report["testResults"] for case in suite["assertionResults"]]
    assert len(rows) == passed + failed and rows == record["records"][label]
    assert sum(row["status"] == "passed" for row in rows) == passed
    assert sum(row["status"] == "failed" for row in rows) == failed
    identities[label] = Counter((row["file"], tuple(row["ancestorTitles"]), row["title"], row["fullName"]) for row in rows)
assert len(identities["final73"]) == 55 and len(identities["independent68"]) == 50
for label, expected in {"initial36": 35, "integrated23": 11, "independent68": 66}.items():
    assert sum((identities[label] & identities["final73"]).values()) == expected
probe = read("independent/sequential-boundary-result.json")
assert probe["aObservedHash"] != probe["aCurrentHash"] and probe["aRetained"] and probe["bRetained"]
assert probe["receipt"]["readCount"] == 4
print(json.dumps({"verifiedMembers": len(contents), "sourceCommit": receipt["commit"],
                  "testRecordCounts": {"beforeFailed": 2, "initial": 36, "final": 73, "integrated": 23, "independent": 68},
                  "countsOverlap": True, "archivedCodeExecuted": False,
                  "workspaceChecked": str(args.workspace) if args.workspace else None}, indent=2))
