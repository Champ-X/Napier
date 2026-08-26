import type {
  AgentProfile,
  CreateCredentialReferenceRequest,
  CredentialAvailability,
  CredentialReference,
} from "@napier/contracts";

import {
  createCredentialReference,
  credentialSourceKey,
  recordCredentialAvailability,
  setCredentialReferenceStatus,
} from "./credential-references.js";

interface CredentialReferenceState {
  agents: readonly AgentProfile[];
  credentials: CredentialReference[];
}

interface CredentialReferenceHost {
  assertReady(): void;
  read(): CredentialReferenceState;
  mutate<T>(operation: (state: CredentialReferenceState) => T): Promise<T>;
}

/** Owns credential-reference state while LocalStore remains a compatibility facade. */
export class CredentialReferenceRepository {
  constructor(private readonly host: CredentialReferenceHost) {}

  list(): CredentialReference[] {
    this.host.assertReady();
    return structuredClone(
      [...this.host.read().credentials].sort((left, right) =>
        `${left.providerId}:${left.label}`.localeCompare(
          `${right.providerId}:${right.label}`,
        ),
      ),
    );
  }

  get(referenceId: string): CredentialReference {
    this.host.assertReady();
    const reference = this.host
      .read()
      .credentials.find((candidate) => candidate.id === referenceId);
    if (!reference) {
      throw new Error(`Credential reference not found: ${referenceId}`);
    }
    return structuredClone(reference);
  }

  getActive(providerId: string): CredentialReference | undefined {
    this.host.assertReady();
    const reference = this.host
      .read()
      .credentials.find(
        (candidate) =>
          candidate.providerId === providerId && candidate.status === "active",
      );
    return reference ? structuredClone(reference) : undefined;
  }

  create(
    request: CreateCredentialReferenceRequest,
  ): Promise<CredentialReference> {
    this.host.assertReady();
    const reference = createCredentialReference(request);
    return this.host.mutate((state) => {
      assertCredentialCanBeActive(state, reference.providerId);
      const sourceKey = credentialSourceKey(reference);
      if (
        state.credentials.some(
          (candidate) => credentialSourceKey(candidate) === sourceKey,
        )
      ) {
        throw new Error("Credential reference source already exists");
      }
      state.credentials.push(reference);
      return structuredClone(reference);
    });
  }

  setStatus(
    referenceId: string,
    status: CredentialReference["status"],
  ): Promise<CredentialReference> {
    this.host.assertReady();
    return this.host.mutate((state) => {
      const index = state.credentials.findIndex(
        (candidate) => candidate.id === referenceId,
      );
      const current = state.credentials[index];
      if (!current) {
        throw new Error(`Credential reference not found: ${referenceId}`);
      }
      if (status === "active") {
        assertCredentialCanBeActive(state, current.providerId, referenceId);
      }
      const updated = setCredentialReferenceStatus(current, status);
      state.credentials[index] = updated;
      return structuredClone(updated);
    });
  }

  recordAvailability(
    referenceId: string,
    availability: CredentialAvailability,
    error?: string,
  ): Promise<CredentialReference> {
    this.host.assertReady();
    return this.host.mutate((state) => {
      const index = state.credentials.findIndex(
        (candidate) => candidate.id === referenceId,
      );
      const current = state.credentials[index];
      if (!current) {
        throw new Error(`Credential reference not found: ${referenceId}`);
      }
      const updated = recordCredentialAvailability(
        current,
        availability,
        error,
      );
      state.credentials[index] = updated;
      return structuredClone(updated);
    });
  }
}

function assertCredentialCanBeActive(
  state: CredentialReferenceState,
  providerId: string,
  exceptReferenceId?: string,
): void {
  const hasActive = state.credentials.some(
    (candidate) =>
      candidate.id !== exceptReferenceId &&
      candidate.providerId === providerId &&
      candidate.status === "active",
  );
  const hasPool = state.agents.some((agent) =>
    agent.modelRoute?.credentialPools?.some(
      (pool) => pool.providerId === providerId,
    ),
  );
  if (hasActive && !hasPool) {
    throw new Error(
      `Provider already has an active credential reference: ${providerId}`,
    );
  }
}
