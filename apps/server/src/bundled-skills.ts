import type { SkillSummary } from "@napier/contracts";

export const BUNDLED_SKILLS: SkillSummary[] = [
  {
    name: "data-analysis",
    description:
      "Inspect and aggregate workspace tables or SQLite with bounded evidence.",
    source: "bundled",
    enabled: true,
  },
  {
    name: "research-brief",
    description:
      "Turn an open question into a sourced, falsifiable research brief.",
    source: "bundled",
    enabled: true,
  },
  {
    name: "software-delivery",
    description:
      "Inspect, implement, verify, and document changes in a software workspace.",
    source: "bundled",
    enabled: true,
  },
  {
    name: "artifact-studio",
    description:
      "Create polished documents, reports, and structured deliverables.",
    source: "bundled",
    enabled: true,
  },
  {
    name: "browser-automation",
    description:
      "Inspect dynamic pages and perform confirmed browser workflows with explicit evidence.",
    source: "bundled",
    enabled: true,
  },
];
