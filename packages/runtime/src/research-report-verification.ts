import { canonicalJson, sha256 } from "./ed25519.js";
import {
  assertWorkspaceSourceCurrent,
  loadWorkspaceSourceFile,
} from "./workspace-source.js";

export const MAX_RESEARCH_REPORT_BYTES = 256 * 1024;

const REPORT_EXTENSIONS = new Set([".md", ".markdown"]);
const SHA256 = /^[a-f0-9]{64}$/u;
const CITATION_TOKEN = /\[citation:(citation_[a-z0-9]{8,80})\]/gu;
const MARKDOWN_LIST_PREFIX = /^(?:[-*+]|\d+\.)\s+$/u;

export interface ResearchReportCitation {
  id: string;
  sourceId: string;
  claim: string;
  quoteSha256: string;
  claimSha256: string;
  token: string;
}

export interface ResearchReportVerification {
  path: string;
  pathSha256: string;
  fileSha256: string;
  fileBytes: number;
  citationCount: number;
  citationSetSha256: string;
}

export async function verifyResearchReport(input: {
  workspaceRoot: string;
  path: string;
  expectedSha256: string;
  citations: readonly ResearchReportCitation[];
  signal?: AbortSignal;
}): Promise<ResearchReportVerification> {
  assertNotAborted(input.signal);
  if (!SHA256.test(input.expectedSha256)) {
    throw new Error("Research report expectedSha256 is invalid");
  }
  const report = await loadWorkspaceSourceFile(
    input.workspaceRoot,
    input.path,
    {
      label: "Research report",
      maxBytes: MAX_RESEARCH_REPORT_BYTES,
      extensions: REPORT_EXTENSIONS,
      extensionError: "Research report must be a Markdown file",
      expectedSha256: input.expectedSha256,
    },
  );
  assertNotAborted(input.signal);
  const used = verifyCitationBindings(report.source, input.citations);
  await assertWorkspaceSourceCurrent(report, {
    label: "Research report",
    maxBytes: MAX_RESEARCH_REPORT_BYTES,
  });
  assertNotAborted(input.signal);
  return {
    path: report.path,
    pathSha256: report.pathSha256,
    fileSha256: report.fileSha256,
    fileBytes: report.fileBytes,
    citationCount: used.length,
    citationSetSha256: sha256(
      canonicalJson(
        used.map((citation) => ({
          id: citation.id,
          sourceId: citation.sourceId,
          claimSha256: citation.claimSha256,
          quoteSha256: citation.quoteSha256,
        })),
      ),
    ),
  };
}

function verifyCitationBindings(
  markdown: string,
  citations: readonly ResearchReportCitation[],
): ResearchReportCitation[] {
  const matches = [...markdown.matchAll(CITATION_TOKEN)];
  const markerCount = markdown.split("[citation:").length - 1;
  if (matches.length === 0) {
    throw new Error("Research report contains no citation tokens");
  }
  if (matches.length !== markerCount) {
    throw new Error("Research report contains a malformed citation token");
  }
  const byId = new Map(citations.map((citation) => [citation.id, citation]));
  const seen = new Set<string>();
  const used: ResearchReportCitation[] = [];
  for (const match of matches) {
    const citationId = match[1]!;
    const citation = byId.get(citationId);
    if (!citation || citation.token !== match[0]) {
      throw new Error("Research report citation is not bound to this Run");
    }
    if (seen.has(citationId)) {
      throw new Error("Research report citation token is duplicated");
    }
    const lineStart = markdown.lastIndexOf("\n", match.index) + 1;
    const nextLine = markdown.indexOf("\n", match.index);
    const lineEnd = nextLine === -1 ? markdown.length : nextLine;
    const reportLine = markdown.slice(lineStart, lineEnd);
    const afterToken = markdown.slice(match.index + match[0].length, lineEnd);
    if (afterToken.replace(CITATION_TOKEN, "").trim()) {
      throw new Error("Research report citation token is not at line end");
    }
    const claimLine = reportLine
      .replace(CITATION_TOKEN, " ")
      .replace(/\s+/gu, " ")
      .trimStart()
      .trimEnd();
    if (!claimLine.endsWith(citation.claim)) {
      throw new Error("Research report citation claim does not match");
    }
    const prefix = claimLine.slice(0, -citation.claim.length);
    if (prefix && !MARKDOWN_LIST_PREFIX.test(prefix)) {
      throw new Error("Research report citation claim is not an exact line");
    }
    seen.add(citationId);
    used.push(citation);
  }
  return used;
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error("Research report verification was cancelled");
  }
}
