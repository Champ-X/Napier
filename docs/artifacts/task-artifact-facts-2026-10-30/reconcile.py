#!/usr/bin/env python3
"""Archive pinned G01 evidence without overwriting raw bytes; --check needs no /tmp."""
import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

BASE = Path(__file__).resolve().parent
REPO = BASE.parents[2]
INDEX = BASE.parent / "task-artifact-facts-evidence-index-2026-10-30.json"
SUMMARY = BASE.parent / "task-artifact-facts-regression-2026-10-30.json"
COMMIT = "53e2eaf2406cf8ed007f96d51de51afbd150e499"
TMP = Path("/tmp")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def load(path):
    return json.loads(path.read_text())


def relative(path):
    return str(path.relative_to(REPO))


def record(records, source, suffix):
    if not source.is_file():
        raise FileNotFoundError(source)
    data = source.read_bytes()
    target = BASE / suffix
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        if target.read_bytes() != data:
            raise RuntimeError(f"Refusing to replace archived evidence: {target}")
    else:
        target.write_bytes(data)
    if digest(source.read_bytes()) != digest(data):
        raise RuntimeError(f"Source changed while being archived: {source}")
    records[relative(target)] = {"sha256": digest(data), "bytes": len(data), "originalPath": str(source)}


def tree(records, source, suffix):
    for path in sorted(source.rglob("*")):
        if path.is_file():
            record(records, path, Path(suffix) / path.relative_to(source))


def raw(suffix):
    return load(BASE / suffix)


def build_summary():
    functional = raw("isolated-v3/regression.json")
    review = raw("review/napier-g01-independent-review-20261030.json")
    stage = raw("provenance/napier-artifact-facts-source-stage-final-20261030.json")
    browser = raw("browser-v5/receipt.json")
    visual = raw("provenance/napier-artifact-facts-browser-verification-20261030.json")
    owner = raw("development/napier-g01-artifact-facts-handoff-20261030-v4.json")
    counts = functional["testCounts"]
    assert sum(c["total"] for c in counts) == 279
    assert sum(c["files"] for c in counts) == 47
    assert all(c["total"] == c["passed"] and not c["failed"] and not c["skipped"] for c in counts)
    assert functional["passedRequiredChecks"] is True
    assert review["finalIndependentTests"]["passed"] == 3 and not review["remainingBlockingFindings"]
    assert browser["status"] == "passed" and len(browser["cases"]) == 6 and len(browser["screenshots"]) == 9
    assert not any(browser[key] for key in ["consoleErrors", "pageErrors", "failedRequests"])
    assert not any(visual["beforeAfterDrift"].values())
    assert stage["files"] == visual["candidateSource"] and len(stage["files"]) == 20
    for file, expected in stage["files"].items():
        committed = subprocess.check_output(["git", "show", f"{COMMIT}:{file}"], cwd=REPO)
        assert digest(committed) == expected, file
    commit_tree = subprocess.check_output(["git", "rev-parse", f"{COMMIT}^{{tree}}"], cwd=REPO, text=True).strip()
    assert commit_tree == stage["tree"]
    for file, expected in functional["stagedSourceManifest"]["files"].items():
        assert stage["files"][file] == expected, file
    assert digest((BASE / "browser-v5/receipt.json").read_bytes()) == visual["finalReceiptSha256"]
    assert digest((BASE / "tooling/napier-g01-artifact-browser-20261030.mjs").read_bytes()) == visual["browserScriptSha256"]
    return {
        "kind": "napier.task-artifact-facts-delivery-regression", "schemaVersion": 1,
        "implementationCommit": COMMIT, "implementationTree": commit_tree,
        "scopeStatus": "verified_scoped_delivery", "fullG01Complete": False, "paidModelCalls": 0,
        "pendingWithinThisSlice": [],
        "sourceBinding": {"baseHead": stage["baseHead"], "fileCount": 20, "files": stage["files"],
            "functionalCandidate19Tree": stage["functionalCandidate19Tree"],
            "additionalCss": "apps/web/src/workspace-shell.css",
            "receipt": relative(BASE / "provenance/napier-artifact-facts-source-stage-final-20261030.json")},
        "rootFunctional": {"files": 47, "tests": 279, "passed": 279, "failed": 0, "skipped": 0,
            "suites": counts, "sourceCount": 4040, "emittedCount": 5096,
            "sourceDrift": functional["sourceDrift"], "emittedDrift": functional["emittedDrift"],
            "preservedUserFiles": functional["preservedUserFiles"],
            "receipt": relative(BASE / "isolated-v3/regression.json"),
            "scope": "19 logical source/test files in the isolated source tree; final CSS has separate build/browser evidence"},
        "ownerRegression": {**owner["validation"]["relatedRegression"],
            "receipt": relative(BASE / "development/napier-g01-regression-v6-20261030.json")},
        "independentReview": {"tests": 3, "passed": 3, "failed": 0, "matchedOwnedPaths": 19,
            "verdict": review["verdict"], "receipt": relative(BASE / "review/napier-g01-independent-review-20261030.json")},
        "browser": {"status": "verified_in_recorded_scope", "scenarios": 6, "screenshots": 9,
            "theme": "light only", "viewportsCssPx": [1440, 390, 320], "languages": ["en", "zh"],
            "receipt": relative(BASE / "browser-v5/receipt.json"),
            "verification": relative(BASE / "provenance/napier-artifact-facts-browser-verification-20261030.json"),
            "sourceCount": visual["sourceCount"], "emittedCount": visual["emittedCount"], "webDistCount": visual["webDistCount"],
            "beforeAfterDrift": visual["beforeAfterDrift"], "preservedUserFiles": visual["preservedUserFiles"],
            "visualReview": visual["visualReview"],
            "scope": "Exact candidate plus retained user overlay in a loopback production build; not a clean-commit-only browser release claim"},
        "retainedFailures": [
            {"source": "development/napier-g01-audit-counterexamples-20261030.json", "disposition": "3 original safety assertions failed: metadata-only missing file, same-id overwritten history, native byte drift"},
            {"source": "development/napier-g01-facts-initial-20261030.json", "disposition": "Restart fixture double shutdown; retained, fixed before accepting the suite"},
            {"source": "development/napier-g01-facts-v2-20261030.json", "disposition": "Restart fixture compared active Run phase despite recovery; fixture now terminates the Run before restart"},
            {"source": "development/napier-g01-budget-before-20261030.json", "disposition": "Real concurrent growth read 8388609 bytes against 8388608 limit; final read is clipped to both budgets"},
            {"source": "review/probes/result-v1.json", "disposition": "Same-millisecond state/event gap borrowed a previous current version; fixed by exact revision binding"},
            {"source": "review/probes/reappeared-v1.json", "disposition": "Old missing declaration overrode current observed bytes; only native current missing now contributes that count"},
            {"source": "isolated-v1/compile-failure.json", "disposition": "TS2742 declaration portability failure; explicit public ThreadDetail return type fixed it"},
            {"source": "isolated-v2/web.json", "disposition": "Late older-generation assertion displaced a continuation; creation/declaration order restored"},
            {"source": "browser-v1/setup-disposition.json", "disposition": "Fixture appended an event for an ignored state transition; zero browser cases executed"},
            {"source": "browser-v2/setup-disposition.json", "disposition": "Fixture attempted ignored verified-to-missing transition; zero browser cases executed"},
            {"source": "browser-v3/receipt.json", "disposition": "Raw passed retained, visual acceptance rejected: document widths and text content did not detect clipped evidence/source cells and navigation"},
            {"source": "browser-v4/receipt.json", "disposition": "Six states and wrapped cells passed; final top-of-task captures and tab hit tests added in v5"},
        ],
        "retainedGates": {"isolatedArchitectureFailures": 7, "runtimeRootExports": "1897/1896",
            "runtimeInternalExports": "18/16", "semanticDigestMismatches": 2,
            "legacyStrictDiagnostics": 48, "sameNormalizedLegacyBaseline": True,
            "budgetOrDigestChanges": False,
            "detector": "one preexisting unrelated diff-pane accent-border warning; no added finding"},
        "boundaries": [
            "Observation proves bytes seen during one response, not creation by a Run, later immutability or whole-objective acceptance.",
            "History is incomplete metadata assertions; no historical byte archive or authenticated producer provenance.",
            "Directories/URLs and unsupported, unsafe, unstable, unreadable or exhausted observations remain unchecked.",
            "64 file checks, 64 path segments, 8 MiB per file and 32 MiB actual read bytes; no workspace scan.",
            "No new mandatory operator acceptance gate. Tool-only discovery, all artifact-card consumers, independent whole-goal acceptance sources and broader G01 remain unfinished.",
            "Test packs overlap and must not be summed. Physical mobile, dark theme, screen-reader acceptance and model-quality/performance improvements are not claimed.",
        ],
    }


def archive():
    records = {}
    for path in sorted(TMP.glob("napier-g01-*")):
        if not path.is_file() or path.suffix not in {".json", ".log", ".ts", ".mts", ".mjs", ".md"}:
            continue
        if "independent" in path.name:
            if path.name == "napier-g01-independent-review-20261030.json":
                record(records, path, Path("review") / path.name)
        elif "artifact-browser" in path.name or "modern-web" in path.name or "impeccable" in path.name:
            record(records, path, Path("tooling") / path.name)
        else:
            record(records, path, Path("development") / path.name)
    tree(records, TMP / "napier-g01-independent-history-20261030", "review/probes")
    for version in [1, 2, 3]:
        tree(records, TMP / f"napier-artifact-facts-final-v{version}-20261030", f"isolated-v{version}")
    for version in [1, 2, 3, 4, 5]:
        tree(records, TMP / f"napier-artifact-facts-browser-result-v{version}-20261030", f"browser-v{version}")
    for version in [1, 3, 4]:
        tree(records, TMP / f"napier-g01-source-freeze-20261030-v{version}", f"source-freeze/v{version}")
    for path in sorted(TMP.glob("napier-artifact-facts-*")):
        if path.is_file() and path.suffix in {".json", ".log", ".py"}:
            record(records, path, Path("provenance" if path.suffix == ".json" else "tooling") / path.name)
    # Baseline needed to interpret the retained legacy strict diagnostic failure.
    record(records, TMP / "napier-g03-agent-runtime-baseline-strict.log", "provenance/legacy-agent-runtime-baseline-strict.log")
    record(records, Path(__file__), "reconcile.py")
    summary = build_summary()
    SUMMARY.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    index = {"kind": "napier.task-artifact-facts-evidence-index", "schemaVersion": 1,
        "implementationCommit": COMMIT, "fullG01Complete": False, "paidModelCalls": 0,
        "artifacts": dict(sorted(records.items())),
        "summary": {"path": relative(SUMMARY), "sha256": digest(SUMMARY.read_bytes())},
        "originalPathsAreHistorical": True,
        "configReconciliation": "Old 15-file regression config bytes are preserved as napier-g01-regression-v1-vitest.config.mts; original generic path later expanded to 16 files.",
    }
    INDEX.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n")


def check():
    index = load(INDEX)
    for name, expected in index["artifacts"].items():
        data = (REPO / name).read_bytes()
        assert len(data) == expected["bytes"] and digest(data) == expected["sha256"], name
    assert digest(SUMMARY.read_bytes()) == index["summary"]["sha256"]
    assert load(SUMMARY) == build_summary()
    print(json.dumps({"artifacts": len(index["artifacts"]), "bytes": sum(x["bytes"] for x in index["artifacts"].values()),
        "sourceCommit": COMMIT, "verified": True}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if not args.check:
        archive()
    check()
