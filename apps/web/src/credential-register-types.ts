import type { CredentialReferenceSource } from "@napier/contracts";

export interface CredentialDraft {
  providerId: string;
  sourceType: CredentialReferenceSource["type"];
  label: string;
  environmentVariable: string;
  keychainService: string;
  keychainAccount: string;
  keychainSecret: string;
  replaceExisting: boolean;
}
