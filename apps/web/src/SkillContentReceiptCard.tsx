import type { SkillContentReview } from "@napier/contracts";

import { contextCopy } from "./context-copy";
import { PackageReceiptHashRow } from "./PackageReceiptHashRow";
import type { SkillContentReceipt } from "./package-management-types";
import "./package-receipts.css";
import "./skill-package-management.css";

export interface SkillContentReceiptCardProps {
  receipt: SkillContentReceipt;
}

export function SkillContentReceiptCard({
  receipt,
}: SkillContentReceiptCardProps) {
  const review = receipt.review;
  const byteDelta = delta(review.sizeBytes, review.currentSizeBytes);
  const lineDelta = delta(review.lineCount, review.currentLineCount);
  return (
    <article
      className={`package-receipt skill-content-receipt status-${review.action}`}
    >
      <header>
        <span>{contextCopy.skillContentReceiptActions[receipt.action]}</span>
        <strong>{contextCopy.skillContentActions[review.action]}</strong>
      </header>
      <p>{receipt.reason}</p>
      <SkillContentDiffStrip
        review={review}
        byteDelta={byteDelta}
        lineDelta={lineDelta}
      />
      <SkillContentReceiptDetails
        receipt={receipt}
        byteDelta={byteDelta}
        lineDelta={lineDelta}
      />
    </article>
  );
}

function SkillContentDiffStrip({
  review,
  byteDelta,
  lineDelta,
}: {
  review: SkillContentReview;
  byteDelta: number;
  lineDelta: number;
}) {
  return (
    <div className="skill-content-diff-strip">
      <span>
        {contextCopy.skillContentCurrentFootprint}
        <strong>
          {review.currentSizeBytes === undefined
            ? contextCopy.skillContentNewFile
            : `${formatCount(review.currentSizeBytes)} / ${formatCount(review.currentLineCount ?? 0)}`}
        </strong>
      </span>
      <span>
        {contextCopy.skillContentCandidateFootprint}
        <strong>
          {formatCount(review.sizeBytes)} / {formatCount(review.lineCount)}
        </strong>
      </span>
      <span>
        {contextCopy.skillContentDelta}
        <strong>
          {formatSignedDelta(byteDelta)} / {formatSignedDelta(lineDelta)}
        </strong>
      </span>
    </div>
  );
}

function SkillContentReceiptDetails({
  receipt,
  byteDelta,
  lineDelta,
}: {
  receipt: SkillContentReceipt;
  byteDelta: number;
  lineDelta: number;
}) {
  const review = receipt.review;
  return (
    <dl>
      <div>
        <dt>{contextCopy.skillContentSkill}</dt>
        <dd>{review.skillName}</dd>
      </div>
      <div>
        <dt>{contextCopy.skillContentPath}</dt>
        <dd>
          <code title={review.relativePath}>{review.relativePath}</code>
        </dd>
      </div>
      <div>
        <dt>{contextCopy.skillContentBytes}</dt>
        <dd>{review.sizeBytes}</dd>
      </div>
      <div>
        <dt>{contextCopy.skillContentLines}</dt>
        <dd>{review.lineCount}</dd>
      </div>
      {"applied" in receipt ? (
        <div>
          <dt>{contextCopy.skillContentAppliedState}</dt>
          <dd>
            {receipt.applied
              ? contextCopy.skillContentAppliedYes
              : contextCopy.skillContentAppliedNo}
          </dd>
        </div>
      ) : null}
      <PackageReceiptHashRow
        label={contextCopy.skillContentReviewHash}
        value={review.reviewSha256}
      />
      <PackageReceiptHashRow
        label={contextCopy.skillContentCandidateHash}
        value={review.contentSha256}
      />
      <PackageReceiptHashRow
        label={contextCopy.skillContentFrontmatterHash}
        value={review.frontmatterSha256}
      />
      <PackageReceiptHashRow
        label={contextCopy.skillContentBodyHash}
        value={review.bodySha256}
      />
      {review.currentContentSha256 ? (
        <PackageReceiptHashRow
          label={contextCopy.skillContentCurrentHash}
          value={review.currentContentSha256}
        />
      ) : null}
      {review.currentSizeBytes !== undefined ? (
        <div>
          <dt>{contextCopy.skillContentByteDelta}</dt>
          <dd>{formatSignedDelta(byteDelta)}</dd>
        </div>
      ) : null}
      {review.currentLineCount !== undefined ? (
        <div>
          <dt>{contextCopy.skillContentLineDelta}</dt>
          <dd>{formatSignedDelta(lineDelta)}</dd>
        </div>
      ) : null}
    </dl>
  );
}

function delta(candidate: number, current: number | undefined): number {
  return current === undefined ? candidate : candidate - current;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(
    value,
  );
}

function formatSignedDelta(value: number): string {
  if (value === 0) return "0";
  return `${value > 0 ? "+" : ""}${formatCount(value)}`;
}
