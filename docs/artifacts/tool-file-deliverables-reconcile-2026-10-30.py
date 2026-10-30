#!/usr/bin/env python3
"""Read frozen evidence in memory; never extract files, run archived code, or write state."""
import argparse
import hashlib
import json
import re
import tarfile
from pathlib import Path, PurePosixPath

STEM = "tool-file-deliverables"
DATE = "2026-10-30"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def load_json(path):
    return json.loads(path.read_bytes())


def relative_test_path(value):
    for marker in ("packages/", "apps/"):
        if marker in value:
            return value[value.index(marker):]
    raise ValueError("Test report path has no package/app scope")


def test_cases(report):
    cases = []
    occurrences = {}
    for file in report["testResults"]:
        for case in file["assertionResults"]:
            key = (relative_test_path(file["name"]), case["fullName"])
            occurrences[key] = occurrences.get(key, 0) + 1
            cases.append({"file": key[0], "name": key[1], "occurrence": occurrences[key], "status": case["status"]})
    require(len({(case["file"], case["name"], case["occurrence"]) for case in cases}) == len(cases), "Duplicate test identities")
    return sorted(cases, key=lambda case: (case["file"], case["name"], case["occurrence"]))


def report_counts(report, files, passed, failed):
    require(len(report["testResults"]) == files, "Test file count mismatch")
    require(report["numTotalTests"] == passed + failed, "Total test count mismatch")
    require(report["numPassedTests"] == passed and report["numFailedTests"] == failed, "Test outcome count mismatch")
    require(report["numPendingTests"] == report["numTodoTests"] == 0, "Unexpected unexecuted tests")
    statuses = [case["status"] for file in report["testResults"] for case in file["assertionResults"]]
    require(statuses.count("passed") == passed and statuses.count("failed") == failed, "Per-case outcomes mismatch")


def normalize_strict(value):
    return value.replace("napier-g01-tool-output-base-20261030", "SNAPSHOT").replace("napier-g01-tool-output-implementation-20261030", "SNAPSHOT")


def read_supplement(root, spec, list_members):
    path = root / spec["archive"]["file"]
    raw = path.read_bytes()
    require(len(raw) == spec["archive"]["bytes"] and digest(raw) == spec["archive"]["sha256"], "Supplement archive mismatch")
    expected = {entry["path"]: entry for entry in spec["members"]}
    contents = {}
    with tarfile.open(path, "r:gz") as archive:
        members = archive.getmembers()
        require(len(members) == len(expected) == spec["archive"]["members"], "Supplement inventory mismatch")
        require(sum(member.size for member in members) == spec["archive"]["uncompressedBytes"], "Supplement uncompressed size mismatch")
        for member in members:
            path = PurePosixPath(member.name)
            require(member.isfile() and not path.is_absolute() and ".." not in path.parts and member.name not in contents, "Unsafe supplement member")
            require(path.suffix not in (".db", ".sqlite", ".sqlite3"), "Unexpected supplement database")
            binding = expected.get(member.name)
            require(binding is not None and member.size == binding["bytes"] and member.size <= 2_000_000, "Supplement member size mismatch")
            handle = archive.extractfile(member)
            require(handle is not None, "Unreadable supplement member")
            content = handle.read(member.size + 1)
            require(len(content) == member.size and digest(content) == binding["sha256"], "Supplement member hash mismatch")
            contents[member.name] = content
            if list_members:
                print(spec["archive"]["file"] + ":" + member.name)
    return contents


def verify_browser(ui, expected_digest, recorded):
    require(ui["evidenceKind"] == "deterministic_integration" and ui["modelRequests"] == 0, "Browser evidence scope mismatch")
    require(ui["scenario"] == "verified_tool_file_without_plan_or_final_reference", "Browser scenario mismatch")
    require(ui["build"]["serverBuilt"] and ui["build"]["webBuilt"], "Browser build evidence incomplete")
    require([view["width"] for view in ui["viewports"]] == [1440, 320], "Browser widths mismatch")
    for view, clicks in zip(ui["viewports"], [1, 2]):
        require(view["clicks"] == clicks and view["selectedPath"] == "candidate-report.html", "Browser selection mismatch")
        require(view["programmaticHtmlInteraction"] == "Step 2" and view["continueEditingDraft"], "Browser interaction/draft mismatch")
        require(view["overflowPx"] == 0 and view["pageErrors"] == [] and not view["accepted"], "Browser errors/acceptance mismatch")
        require("unverified" in view["status"], "Browser promoted objective acceptance")
        phrase = "File integrity recorded" if recorded else "File verification pending"
        require(phrase in view["inspector"], "Browser integrity label mismatch")
        if recorded:
            require(view["integrityRecorded"] is True, "Browser recorded-label assertion missing")
        require(len(view["previews"]) >= 1, "Missing Browser preview request")
        for preview in view["previews"]:
            require(preview["status"] == 200 and preview["path"].startswith("/api/workspaces/") and preview["path"].endswith("/workspace/file") and preview["contentSha256"] == expected_digest, "Browser response binding mismatch")


def reconcile(root, workspace, list_members):
    index = load_json(root / f"{STEM}-evidence-index-{DATE}.json")
    receipt = load_json(root / f"{STEM}-regression-{DATE}.json")
    archive = root / index["archive"]["file"]
    data = archive.read_bytes()
    require(len(data) == index["archive"]["bytes"] and digest(data) == index["archive"]["sha256"], "Archive binding mismatch")
    expected = {item["path"]: item for item in index["members"]}
    require(len(expected) == index["archive"]["members"] == 228, "Frozen member inventory mismatch")
    contents = {}
    with tarfile.open(archive, "r:gz") as stream:
        members = stream.getmembers()
        require(len(members) == len(expected), "Archive member count mismatch")
        require(len({member.name for member in members}) == len(members), "Duplicate archive members")
        require(sum(member.size for member in members) == index["archive"]["uncompressedBytes"], "Archive uncompressed size mismatch")
        for member in members:
            path = PurePosixPath(member.name)
            require(member.isfile() and not path.is_absolute() and ".." not in path.parts, "Unsafe archive member")
            require(path.suffix not in (".db", ".sqlite", ".sqlite3"), "Unexpected archived database")
            binding = expected.get(member.name)
            require(binding is not None and member.size == binding["bytes"] and member.size <= 2_000_000, "Unexpected archive member or size")
            handle = stream.extractfile(member)  # In-memory stream only; no filesystem extraction.
            require(handle is not None, "Unreadable archive member")
            content = handle.read(member.size + 1)
            require(len(content) == member.size and digest(content) == binding["sha256"], "Member hash mismatch: " + member.name)
            contents[member.name] = content
    if list_members:
        for name in sorted(contents):
            print(name)
    def obj(name):
        return json.loads(contents[name])
    def text(name):
        return contents[name].decode()

    manifest = obj("delivery-manifest.json")
    require(digest(contents["delivery-manifest.json"]) == receipt["ownerEvidence"]["manifestSha256"], "Owner manifest mismatch")
    require(digest(contents["candidate.patch"]) == manifest["patchSha256"] == receipt["ownerEvidence"]["patchSha256"], "Candidate patch mismatch")
    require(manifest["revision"] == 2 and manifest["baseHead"] == receipt["ownerEvidence"]["baseHead"], "Wrong source revision")
    require(len(manifest["changedFiles"]) == 30, "Owned source file count mismatch")
    for file in manifest["changedFiles"]:
        require(digest(contents["source/" + file["path"]]) == file["afterSha256"], "Source member mismatch: " + file["path"])
        if workspace:
            require(digest((workspace / file["path"]).read_bytes()) == file["afterSha256"], "Current owned source differs: " + file["path"])

    owner = obj("validation/napier-g01-tests-v5.json")
    report_counts(owner, 35, 333, 0)
    cases = test_cases(owner)
    require(cases == receipt["ownerEvidence"]["testCases"], "333-case identity set mismatch")
    before = obj("before/result-v2.json")
    report_counts(before, 1, 0, 2)
    require(all("A host-verified tool file should survive independently of final answer wording" in "\n".join(case["failureMessages"]) for case in before["testResults"][0]["assertionResults"]), "Before probe did not fail at the intended assertion")
    require("Compatibility projection flush failed" in text("before/run-v1.log"), "Original cleanup failure was not retained")
    report_counts(obj("after-final/result.json"), 1, 3, 0)
    for name in ("brief-md", "download-txt"):
        old = obj(f"before/{name}-observed-v2.json")
        require(old["plans"] == 0 and old["full"] == old["warm"] == old["restarted"], "Before projection scope/parity mismatch")
        require(old["full"]["deliverables"] == [] and old["full"]["objective"]["status"] == "unverified", "Before counterexample mismatch")
    for name in ("brief-md", "download-txt", "aba-md"):
        observed = obj(f"after-final/{name}-observed-after.json")
        require(observed["plans"] == 0 and observed["full"] == observed["warm"] == observed["restarted"], "After projection scope/parity mismatch")
        require(observed["full"]["objective"]["status"] == "unverified", "File evidence was promoted to objective acceptance")
        require(observed["modelCalls"] == observed["externalCalls"] == 0, "Native fixture external/model scope changed")
        entry = observed["full"]["deliverables"][0]
        require(entry["source"] == "tool_file" and entry["verification"] == "integrity_observed", "After tool receipt is not observed")
        require(entry["artifact"]["sha256"] == observed["sha256"] and entry["artifact"]["sizeBytes"] == observed["bytes"], "After file identity mismatch")

    rejected = obj("rejected-v1/delivery-manifest.json")
    require(digest(contents["rejected-v1/candidate.patch"]) == rejected["patchSha256"] == manifest["supersedesRejectedPatchSha256"], "Rejected v1 source missing")
    require("key: sha256(canonicalJson(payload))" in text("rejected-v1/source/packages/runtime/src/run-bound-file-artifact.ts"), "Rejected digest-only key not retained")
    require("expected [" in text("validation/napier-g01-aba-before.log") and "length of 3 but got 2" in text("validation/napier-g01-aba-before.log"), "A-B-A failure not retained")
    aba = obj("after-final/research-aba-receipts.json")
    results, events = aba["results"], aba["events"]
    require([entry["id"] for entry in results] == ["verify-a1", "verify-b", "verify-a2", "verify-a1"], "A-B-A invocation/retry identity mismatch")
    require(all(entry["registration"] == "registered" for entry in results), "A-B-A registration failed")
    require(results[0]["sha256"] == results[2]["sha256"] == results[3]["sha256"] != results[1]["sha256"], "A-B-A byte relationship mismatch")
    require(len(events) == 3 and [event["payload"]["operationId"] for event in events] == ["verify-a1", "verify-b", "verify-a2"], "Invocation idempotency mismatch")
    require([event["seq"] for event in events] == sorted({event["seq"] for event in events}), "Receipt ordering mismatch")
    require(aba["view"]["deliverables"][0]["sourceEventId"] == events[2]["id"], "Old retry reclaimed current version")

    checks = manifest["checks"]
    require(checks["strictNewTests"]["exitCode"] == 0 and text(checks["strictNewTests"]["log"]) == "", "New strict tests did not pass")
    require(len(obj("validation/strict-new-tests.config.json")["files"]) == 3, "New strict test scope mismatch")
    strict = normalize_strict(text("validation/napier-g01-strict-tests-v1.log"))
    baseline = normalize_strict(text("validation/napier-g01-strict-baseline-tests.log"))
    require(strict == baseline and strict.count("error TS") == 4, "Strict baseline diagnostics changed")
    require(len(obj("validation/strict-changed-tests.config.json")["files"]) == 9 and len(obj("validation/strict-baseline-tests.config.json")["files"]) == 6, "Strict comparison scope mismatch")
    for name in ("coreCompile", "webTypecheck"):
        require(checks[name]["exitCode"] == 0 and text(checks[name]["log"]) == "", "Compile evidence failed: " + name)
    require(text("validation/napier-g01-architecture-v3.log") == text("validation/napier-g01-baseline-architecture.log"), "Architecture baseline changed")
    require(len(re.findall(r"^- ", text("validation/napier-g01-architecture-v3.log"), re.MULTILINE)) == 7, "Architecture failure count mismatch")
    api_base, api_current = obj("validation/napier-g01-api-baseline.json"), obj("validation/napier-g01-api-candidate-final.json")
    require(api_base["observed"] == api_current["observed"] and api_base["errors"] == api_current["errors"] and len(api_current["errors"]) == 4, "API baseline changed")

    root_result = receipt["rootIntegration"]
    require(root_result["status"] == "recorded", "Root integration evidence is incomplete")
    if root_result["status"] == "recorded":
        integration_path = root / root_result["file"]
        require(digest(integration_path.read_bytes()) == root_result["sha256"], "Root integration receipt mismatch")
        integration = load_json(integration_path)
        require(integration["sourceFiles"] == manifest["changedFiles"], "Root integration source binding mismatch")
        require(integration["ownerTestCount"] == 333, "Root owner count mismatch")
        root_cases = integration["testCases"]
        identities = {(case["file"], case["name"], case["occurrence"]) for case in cases}
        overlap = sum((case["file"], case["name"], case["occurrence"]) in identities for case in root_cases)
        require(overlap == integration["ownerTestOverlap"], "Root/owner test overlap mismatch")
        supplements = {}
        for label, spec in index.get("supplements", {}).items():
            supplements[label] = read_supplement(root, spec, list_members)
        require(set(supplements) == {"root", "consumer"}, "Missing root/consumer evidence")
        raw = supplements["root"]
        root_reg = json.loads(raw["root-final/regression.json"])
        commit = json.loads(raw[integration["rootCommitReceiptMember"]])
        source_hashes = {file["path"]: file["afterSha256"] for file in manifest["changedFiles"]}
        require(commit["commit"] == integration["sourceCommit"] == receipt["sourceCommit"], "Source commit binding mismatch")
        require(commit["sourceManifest"]["files"] == root_reg["sourceManifest"]["files"] == source_hashes, "Root source hashes mismatch")
        require(commit["protectedFilesUnchanged"] == 28 and not commit["pushed"], "Commit scope mismatch")
        root_report = json.loads(raw["root-final/tests.json"])
        report_counts(root_report, 6, 46, 0)
        require(test_cases(root_report) == root_cases, "Root raw cases mismatch")
        require(overlap == 38, "Unexpected root/owner overlap")
        for name, sha in root_reg["checks"].items():
            require(digest(raw["root-final/" + name]) == sha, "Root check hash mismatch: " + name)
        require(raw["root-final/strict-runtime.log"] == raw["root-final/strict-web.log"] == b"", "Root strict tests failed")
        require(digest(raw["root/napier-g01-tool-output-root-compile-20261030.log"]) == root_reg["fullCompileLogSha256"], "Root compile log mismatch")
        require("TS2835" in raw["root-before/strict.log"].decode(), "Original mixed strict config failure missing")
        require("vite/client" in raw["root-final/strict-web-first.log"].decode(), "First moved Web config failure missing")
        require("Candidate preview must load the checked workspace file" in raw["root/napier-g01-tool-output-ui-20261030.log"].decode(), "First scoped matcher failure missing")
        overlay = json.loads(raw[integration["browserV2"]["protectedOverlayMember"]])
        require(overlay["candidateFiles"] == source_hashes and len(overlay["protectedOverlay"]) == 28, "Browser source overlay mismatch")
        require(overlay["scriptSha256"] == digest(raw["root/napier-g01-tool-output-ui-template-v1-20261030.mjs"]), "Initial Browser script binding mismatch")
        ui = json.loads(raw[integration["browserV2"]["receiptMember"]])
        verify_browser(ui, integration["browserV2"]["expectedDigest"], recorded=False)
        script = raw["root/napier-g01-tool-output-ui-template-v2-20261030.mjs"].decode()
        require("document.activeElement" in script and "Continue editing" in script, "Browser focus/continue assertions missing")
        consumer_raw = supplements["consumer"]
        consumer_manifest = json.loads(consumer_raw["source-manifest.json"])
        consumer_result = json.loads(consumer_raw["regression.json"])
        require(consumer_manifest["baseCommit"] == receipt["sourceCommit"], "Consumer base commit mismatch")
        require(digest(consumer_raw["candidate.patch"]) == consumer_manifest["patchSha256"] == integration["consumer"]["patchSha256"], "Consumer patch mismatch")
        require(len(consumer_manifest["files"]) == 5 and consumer_manifest["originalSource30Unchanged"], "Consumer source scope mismatch")
        for path, binding in consumer_manifest["files"].items():
            require(digest(consumer_raw["source/" + path]) == binding["sha256"], "Consumer source member mismatch: " + path)
            if workspace:
                require(digest((workspace / path).read_bytes()) == binding["sha256"], "Current consumer source differs: " + path)
        consumer_report = json.loads(consumer_raw["validation/napier-g01-tool-preview-binding-after-final.json"])
        report_counts(consumer_report, 5, 39, 0)
        consumer_cases = test_cases(consumer_report)
        require(consumer_cases == integration["consumer"]["testCases"], "Consumer raw cases mismatch")
        require(sum((case["file"], case["name"], case["occurrence"]) in identities for case in consumer_cases) == integration["consumer"]["ownerTestOverlap"] == 15, "Consumer/owner overlap mismatch")
        for name in ("napier-g01-preview-strict-tests-final.log", "napier-g01-preview-web-typecheck-final-v2.log"):
            require(consumer_raw["validation/" + name] == b"", "Consumer type check failed")
        require(consumer_raw["validation/napier-g01-preview-architecture-final.log"] == consumer_raw["validation/napier-g01-preview-architecture-exact-baseline.log"], "Consumer architecture findings changed")
        require(consumer_raw["validation/napier-g01-preview-public-api-after.log"] == consumer_raw["validation/napier-g01-preview-public-api-exact-baseline.log"], "Consumer API findings changed")
        report_counts(json.loads(consumer_raw["validation/napier-g01-tool-preview-binding-before.json"]), 1, 0, 1)
        require(consumer_result["noModelOrProviderCalls"], "Consumer fixture scope changed")
        consumer_commit = json.loads(raw[integration["consumer"]["rootCommitReceiptMember"]])
        require(consumer_commit["sourceCommit"] == integration["consumer"]["sourceCommit"] and re.fullmatch(r"[0-9a-f]{40}", consumer_commit["sourceCommit"]) is not None, "Consumer commit binding mismatch")
        require(consumer_commit["baseCommit"] == receipt["sourceCommit"] and consumer_commit["sourceManifest"] == consumer_manifest, "Consumer commit source mismatch")
        require(consumer_commit["protected28Unchanged"] and not consumer_commit["pushed"], "Consumer commit scope mismatch")
        root_consumer = json.loads(raw["consumer-root/regression.json"])
        require(root_consumer["source"]["sourceManifest"] == consumer_manifest and root_consumer["sourceStable"], "Root consumer source mismatch")
        root_consumer_report = json.loads(raw["consumer-root/tests.json"])
        report_counts(root_consumer_report, 2, 20, 0)
        root_consumer_cases = test_cases(root_consumer_report)
        require(root_consumer_cases == integration["consumer"]["rootTestCases"], "Root consumer raw cases mismatch")
        consumer_ids = {(case["file"], case["name"], case["occurrence"]) for case in consumer_cases}
        require(all((case["file"], case["name"], case["occurrence"]) in consumer_ids for case in root_consumer_cases), "Root consumer case overlap mismatch")
        require(raw["consumer-root/strict.log"] == b"" and digest(raw["consumer-root/strict.log"]) == root_consumer["strictLogSha256"], "Root consumer strict check failed")
        browser_v3 = integration["browserV3"]
        require(digest(raw[browser_v3["receiptMember"]]) == consumer_commit["browserReceiptSha256"], "Browser v3 commit receipt mismatch")
        require(digest(raw[browser_v3["scriptMember"]]) == root_consumer["source"]["uiScriptSha256"], "Browser v3 script mismatch")
        verify_browser(json.loads(raw[browser_v3["receiptMember"]]), browser_v3["expectedDigest"], recorded=True)
        require(consumer_commit["browserPreviewImagesVisuallyInspected"] == [1440, 320], "Browser visual review scope missing")
    return {"archiveMembers": len(contents), "sourceFiles": 30, "ownerTests": 333, "nativeAfterCases": 3, "strictNewTests": "passed", "strictExistingDiagnostics": 4, "architectureFindings": 7, "apiFindings": 4, "workspaceCompared": bool(workspace), "rootIntegration": root_result["status"], "sourceCommit": receipt["sourceCommit"], "rootTests": 46, "rootOwnerOverlap": 38, "consumerTests": 39, "consumerOwnerOverlap": 15, "browserV2Recorded": False, "browserV3Recorded": True, "consumerCommit": integration["consumer"]["sourceCommit"], "rootConsumerTests": 20, "consumerSourceFiles": 5}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, help="Read-only comparison of the 30 original and 5 consumer current source files")
    parser.add_argument("--list", action="store_true", help="List frozen archive members")
    args = parser.parse_args()
    print(json.dumps(reconcile(Path(__file__).resolve().parent, args.workspace, args.list), indent=2))


if __name__ == "__main__":
    main()
