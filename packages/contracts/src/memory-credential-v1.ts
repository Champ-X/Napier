export type MemoryCategory = "preference" | "context" | "goal" | "constraint" | "decision" | "identity" | "behavior" | "correction" | "other";

export type MemoryScope = "workspace" | "agent";

export type MemoryStatus = "proposed" | "active" | "stale" | "rejected" | "archived";

export interface MemorySource {
  type: "manual" | "conversation";
  threadId?: string;
  runId?: string;
}

export interface MemoryFact {
  id: string;
  content: string;
  category: MemoryCategory;
  scope: MemoryScope;
  agentId?: string;
  status: MemoryStatus;
  confidence: number;
  source: MemorySource;
  reviewNote?: string;
  reviewIntervalDays: number;
  reviewDueAt?: string;
  useCount: number;
  lastUsedAt?: string;
  lastUsedRunId?: string;
  supersedesMemoryId?: string;
  consolidatesMemoryIds?: string[];
  supersededByMemoryId?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
}

export interface CreateMemoryRequest {
  content: string;
  category?: MemoryCategory;
  scope?: MemoryScope;
  agentId?: string;
  confidence?: number;
  reviewIntervalDays?: number;
  supersedesMemoryId?: string;
  consolidatesMemoryIds?: string[];
  threadId?: string;
}

export interface ReviewMemoryRequest {
  action: "approve" | "reject" | "archive" | "restore" | "refresh" | "mark_stale";
  note?: string;
  threadId?: string;
}

export type CredentialReferenceSource =
  | {
      type: "environment";
      variable: string;
    }
  | {
      type: "macos_keychain";
      service: string;
      account: string;
    };

export type CredentialReferenceStatus = "active" | "disabled";

export type CredentialAvailability = "unknown" | "available" | "missing" | "error";

export interface CredentialReference {
  id: string;
  providerId: string;
  label: string;
  source: CredentialReferenceSource;
  status: CredentialReferenceStatus;
  availability: CredentialAvailability;
  lastCheckedAt?: string;
  lastError?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCredentialReferenceRequest {
  providerId: string;
  label: string;
  source: CredentialReferenceSource;
  threadId?: string;
}

export interface CreateMacOsKeychainCredentialRequest {
  providerId: string;
  label: string;
  service: string;
  account: string;
  secret: string;
  replaceExisting?: boolean;
  threadId?: string;
}

export interface SetCredentialReferenceStatusRequest {
  status: CredentialReferenceStatus;
  threadId?: string;
}
