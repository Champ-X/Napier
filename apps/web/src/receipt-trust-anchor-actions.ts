import type { ReceiptTrustAnchorDirectory } from "@napier/contracts";

import { copy } from "./copy";
import type { ReceiptTrustActionContext } from "./receipt-trust-action-context";
import {
  createReceiptTrustAnchor,
  getReceiptTrustAnchorDirectory,
  getSignedReceiptTrustAnchorDirectoryMetadata,
  revokeReceiptTrustAnchor,
  verifyReceiptTrustAnchorDirectory,
  verifyReceiptTrustAnchorDirectoryMetadata,
  verifyTrustedReceipt,
} from "./receipt-trust-api";
import {
  downloadReceiptTrustJson,
  MAX_RECEIPT_TRUST_DIRECTORY_FILE_BYTES,
  MAX_TRUSTED_RECEIPT_FILE_BYTES,
  readReceiptTrustJson,
} from "./receipt-trust-helpers";

export async function createTrustAnchor(
  context: ReceiptTrustActionContext,
): Promise<void> {
  if (!context.projection.canCreate) return;
  const { props, state } = context;
  const anchor = await context.operation.run("create", () =>
    createReceiptTrustAnchor({
      threadId: props.threadId,
      label: state.label,
      source:
        state.sourceType === "environment"
          ? {
              type: "environment",
              variable: state.environmentVariable.trim(),
            }
          : { type: "public_key", publicKeySpki: state.publicKeySpki.trim() },
    }),
  );
  if (!anchor) return;
  const next = [...props.anchors, anchor].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
  props.onAnchors(next);
  if (anchor.signingSource) props.onSelect(anchor.id);
  context.patch({ label: "", environmentVariable: "", publicKeySpki: "" });
}

export async function revokeTrustAnchor(
  context: ReceiptTrustActionContext,
  anchorId: string,
): Promise<void> {
  const updated = await context.operation.run(`revoke:${anchorId}`, () =>
    revokeReceiptTrustAnchor(anchorId, context.props.threadId),
  );
  if (!updated) return;
  const next = context.props.anchors.map((anchor) =>
    anchor.id === updated.id ? updated : anchor,
  );
  context.props.onAnchors(next);
  if (context.props.selectedAnchorId === updated.id) {
    context.props.onSelect(
      next.find(
        (anchor) =>
          anchor.status === "trusted" && Boolean(anchor.signingSource),
      )?.id ?? "",
    );
  }
  context.patch({ pendingRevokeId: undefined });
}

export async function verifyTrustedReceiptFile(
  context: ReceiptTrustActionContext,
  file: File | undefined,
): Promise<void> {
  if (!file) return;
  context.patch({ verification: undefined });
  const verification = await context.operation.run("verify", async () => {
    if (file.size > MAX_TRUSTED_RECEIPT_FILE_BYTES) {
      throw new Error(copy.lab.trust.errors.tooLarge);
    }
    return verifyTrustedReceipt(
      await readReceiptTrustJson(file),
      context.state.externalDirectory,
      context.state.externalDirectoryPolicy,
    );
  });
  if (verification) context.patch({ verification });
}

export async function exportTrustDirectory(
  context: ReceiptTrustActionContext,
): Promise<void> {
  await context.operation.run("directory", async () => {
    const directory = await getReceiptTrustAnchorDirectory();
    downloadReceiptTrustJson(
      directory,
      `napier-receipt-trust-anchor-directory-${directory.anchorSetSha256.slice(0, 12)}.json`,
    );
  });
}

export async function signTrustDirectoryMetadata(
  context: ReceiptTrustActionContext,
): Promise<void> {
  if (!context.projection.canSignDirectoryMetadata) return;
  await context.operation.run("sign-directory-metadata", async () => {
    const envelope = await getSignedReceiptTrustAnchorDirectoryMetadata({
      threadId: context.props.threadId,
      trustAnchorId: context.props.selectedAnchorId,
      publisher: copy.lab.trust.directoryMetadataPublisher,
    });
    downloadReceiptTrustJson(
      envelope,
      `napier-signed-anchor-directory-metadata-${envelope.contentSha256.slice(0, 12)}.json`,
    );
  });
}

export async function verifyTrustDirectoryFile(
  context: ReceiptTrustActionContext,
  file: File | undefined,
): Promise<void> {
  if (!file) return;
  context.patch({
    directoryVerification: undefined,
    directoryMetadataVerification: undefined,
  });
  const result = await context.operation.run("verify-directory", async () => {
    if (file.size > MAX_RECEIPT_TRUST_DIRECTORY_FILE_BYTES) {
      throw new Error(copy.lab.trust.errors.directoryTooLarge);
    }
    const directory = await readReceiptTrustJson(file);
    const verification = await verifyReceiptTrustAnchorDirectory({ directory });
    return { directory, verification };
  });
  if (!result) return;
  context.patch({
    directoryDiscovery: undefined,
    directoryVerification: result.verification,
    externalDirectory:
      result.verification.status === "valid"
        ? (result.directory as ReceiptTrustAnchorDirectory)
        : undefined,
    externalDirectoryPolicy: undefined,
    externalDirectorySubscriptionId: undefined,
  });
}

export async function verifyTrustDirectoryMetadataFile(
  context: ReceiptTrustActionContext,
  file: File | undefined,
): Promise<void> {
  if (!file) return;
  context.patch({ directoryMetadataVerification: undefined });
  const verification = await context.operation.run(
    "verify-directory-metadata",
    async () => {
      if (file.size > MAX_TRUSTED_RECEIPT_FILE_BYTES) {
        throw new Error(copy.lab.trust.errors.tooLarge);
      }
      const directory =
        context.state.externalDirectory ??
        (await getReceiptTrustAnchorDirectory());
      const policy = context.state.externalDirectoryPolicy;
      return verifyReceiptTrustAnchorDirectoryMetadata({
        envelope: await readReceiptTrustJson(file),
        directory,
        ...(policy ? { directoryPolicy: policy } : {}),
        ...(context.state.externalDirectory
          ? {
              trustDirectory: context.state.externalDirectory,
              ...(policy ? { trustDirectoryPolicy: policy } : {}),
            }
          : {}),
      });
    },
  );
  if (verification)
    context.patch({ directoryMetadataVerification: verification });
}
