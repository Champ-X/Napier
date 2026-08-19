import { RotateCcw, ShieldCheck } from "lucide-react";

import type {
  InboundDelivery,
  InboundDeliveryQualification,
} from "@napier/contracts";

import { automationCopy as copy } from "./automation-copy";
import {
  formatAutomationDateTime,
  shortAutomationHash,
} from "./automation-panel-helpers";

export interface AutomationDeliveryListProps {
  deliveries: InboundDelivery[] | undefined;
  qualifications: Record<string, InboundDeliveryQualification>;
  busyId: string | undefined;
  retryConfirmId: string | undefined;
  onQualify: (deliveryId: string) => void;
  onRequestRetry: (deliveryId: string) => void;
  onCancelRetry: () => void;
  onRetry: (deliveryId: string) => void;
}

export function AutomationDeliveryList({
  deliveries,
  ...props
}: AutomationDeliveryListProps) {
  if (!deliveries) return null;
  return (
    <div className="delivery-list">
      <span>{copy.deliveries}</span>
      {deliveries.length === 0 ? (
        <p>{copy.noDeliveries}</p>
      ) : (
        deliveries
          .slice()
          .reverse()
          .slice(0, 8)
          .map((delivery) => (
            <DeliveryEntry key={delivery.id} delivery={delivery} {...props} />
          ))
      )}
    </div>
  );
}

interface DeliveryEntryProps extends Omit<
  AutomationDeliveryListProps,
  "deliveries"
> {
  delivery: InboundDelivery;
}

function DeliveryEntry({
  delivery,
  qualifications,
  busyId,
  retryConfirmId,
  onQualify,
  onRequestRetry,
  onCancelRetry,
  onRetry,
}: DeliveryEntryProps) {
  const retryable =
    delivery.status === "failed" &&
    delivery.attemptCount < delivery.maxAttempts;
  const qualification = qualifications[delivery.id];
  return (
    <article className="delivery-entry">
      <div className="delivery-summary">
        <i
          className={`delivery-dot state-${delivery.status}`}
          aria-hidden="true"
        />
        <span>{copy.statuses[delivery.status]}</span>
        <span className="delivery-attempt">
          {copy.attempt} {delivery.attemptCount}/{delivery.maxAttempts}
        </span>
        <time dateTime={delivery.createdAt}>
          {formatAutomationDateTime(delivery.createdAt)}
        </time>
      </div>
      {delivery.nextAttemptAt ? (
        <p className="delivery-next">
          {copy.nextAttempt} ·{" "}
          <time dateTime={delivery.nextAttemptAt}>
            {formatAutomationDateTime(delivery.nextAttemptAt)}
          </time>
        </p>
      ) : null}
      {delivery.error ? (
        <p className="delivery-error">{delivery.error}</p>
      ) : null}
      {qualification ? <DeliveryQualification value={qualification} /> : null}
      <DeliveryActions
        delivery={delivery}
        retryable={retryable}
        retrying={busyId === `retry:${delivery.id}`}
        qualifying={busyId === `qualify:${delivery.id}`}
        confirming={retryConfirmId === delivery.id}
        onQualify={onQualify}
        onRequestRetry={onRequestRetry}
        onCancelRetry={onCancelRetry}
        onRetry={onRetry}
      />
    </article>
  );
}

function DeliveryQualification({
  value,
}: {
  value: InboundDeliveryQualification;
}) {
  return (
    <div
      className={`delivery-qualification state-${value.status}`}
      role="status"
    >
      <strong>
        {copy.deliveryQualification}: {copy.qualificationStatuses[value.status]}
      </strong>
      <p>
        {copy.qualificationReceipt} {shortAutomationHash(value.contentSha256)}
      </p>
      <p>
        {copy.bodyHash} {shortAutomationHash(value.bodySha256)} ·{" "}
        {copy.catalogHash} {shortAutomationHash(value.adapterCatalogSha256)}
      </p>
      {value.status === "adapter_catalog_drift" ? (
        <p>
          {copy.currentCatalogHash}{" "}
          {shortAutomationHash(value.currentAdapterCatalogSha256)}
        </p>
      ) : null}
      <ul>
        {value.diagnostics.map((diagnostic) => (
          <li key={diagnostic}>{diagnostic}</li>
        ))}
      </ul>
    </div>
  );
}

interface DeliveryActionsProps {
  delivery: InboundDelivery;
  retryable: boolean;
  retrying: boolean;
  qualifying: boolean;
  confirming: boolean;
  onQualify: (deliveryId: string) => void;
  onRequestRetry: (deliveryId: string) => void;
  onCancelRetry: () => void;
  onRetry: (deliveryId: string) => void;
}

function DeliveryActions({
  delivery,
  retryable,
  retrying,
  qualifying,
  confirming,
  onQualify,
  onRequestRetry,
  onCancelRetry,
  onRetry,
}: DeliveryActionsProps) {
  return (
    <>
      <button
        type="button"
        disabled={qualifying}
        aria-busy={qualifying}
        onClick={() => onQualify(delivery.id)}
      >
        <ShieldCheck size={9} aria-hidden="true" />
        {qualifying ? copy.qualifying : copy.qualifyDelivery}
      </button>
      {retryable && !confirming ? (
        <button
          type="button"
          disabled={retrying}
          onClick={() => onRequestRetry(delivery.id)}
        >
          <RotateCcw size={9} aria-hidden="true" /> {copy.retryDelivery}
        </button>
      ) : null}
      {delivery.status === "failed" && !retryable ? (
        <p className="delivery-exhausted">{copy.retryExhausted}</p>
      ) : null}
      {confirming ? (
        <div
          className="delivery-retry-confirm"
          role="group"
          aria-labelledby={`retry-title-${delivery.id}`}
        >
          <strong id={`retry-title-${delivery.id}`}>{copy.retryTitle}</strong>
          <p>{copy.retryBody}</p>
          <div>
            <button type="button" disabled={retrying} onClick={onCancelRetry}>
              {copy.cancel}
            </button>
            <button
              className="danger"
              type="button"
              disabled={retrying}
              aria-busy={retrying}
              onClick={() => onRetry(delivery.id)}
            >
              {retrying ? copy.retryingAction : copy.retryNow}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
