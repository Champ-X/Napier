import type {
  AgentProfile,
  ContextCheckpointCalibrationReport,
  ContextCheckpointSnapshot,
  CredentialReference,
  ExtensionPublisherTrustAnchor,
  ModelSummary,
  SkillPackageInstallation,
  SkillSummary,
  UsagePriceTableCatalog,
} from "@napier/contracts";
import type { LiveReadyBootstrapResponse } from "@napier/contracts/default-run-model";

export interface ContextPanelProps {
  agent: AgentProfile;
  workspace: string;
  skills: SkillSummary[];
  models: ModelSummary[];
  credentials: CredentialReference[];
  publisherAnchors: ExtensionPublisherTrustAnchor[];
  skillPackageInstallations: SkillPackageInstallation[];
  usagePriceTableCatalog: UsagePriceTableCatalog;
  threadId: string;
  selectedModelKey: string;
  recentModelKeys?: readonly string[];
  checkpoint?: ContextCheckpointSnapshot;
  checkpointCalibration?: ContextCheckpointCalibrationReport;
  onModel: (value: string) => void;
  onAgentUpdated: (agent: AgentProfile) => void;
  onBootstrapUpdated: (bootstrap: LiveReadyBootstrapResponse) => void;
}
