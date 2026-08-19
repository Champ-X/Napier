import { describe, expect, it } from "vitest";

import AutomationPanel from "../src/AutomationPanel";
import { automationCopy as copy } from "../src/automation-copy";
import {
  deadLetterQualificationSummary,
  parsePreviewHeaders,
} from "../src/automation-panel-helpers";
import { renderToStaticMarkup } from "./render-static-preact";

describe("AutomationPanel", () => {
  it("renders recovery, schedules, and channels as separate empty states", () => {
    const html = renderToStaticMarkup(
      <AutomationPanel
        threadId="thread_test"
        schedules={[]}
        channels={[]}
        inboundChannelAdapters={[]}
        recoveryAssessments={[]}
        recoveryAttempts={[]}
        recoveryPending={false}
        onBootstrapUpdated={() => undefined}
      />,
    );

    expect(html).toContain(copy.title);
    expect(html).toContain(copy.noRecoveries);
    expect(html).toContain(copy.noSchedules);
    expect(html).toContain(copy.noChannels);
    expect(html).toContain('aria-labelledby="recovery-ledger-title"');
    expect(html).toContain('aria-labelledby="schedules-title"');
    expect(html).toContain('aria-labelledby="channels-title"');
  });

  it("validates adapter preview headers before the request is sent", () => {
    expect(parsePreviewHeaders("{}")).toEqual({});
    expect(parsePreviewHeaders('{"x-event-id":"evt_1"}')).toEqual({
      headers: { "x-event-id": "evt_1" },
    });
    expect(() => parsePreviewHeaders('{"x-count":2}')).toThrow(
      copy.previewHeadersInvalid,
    );
  });

  it("projects dead-letter qualification totals when legacy artifacts omit them", () => {
    const summary = deadLetterQualificationSummary({
      qualifiedCount: undefined,
      evidenceMissingCount: undefined,
      adapterCatalogDriftCount: undefined,
      deliveries: [
        { qualificationStatus: "qualified" },
        { qualificationStatus: "evidence_missing" },
        { qualificationStatus: "adapter_catalog_drift" },
      ],
    } as Parameters<typeof deadLetterQualificationSummary>[0]);

    expect(summary).toEqual({
      qualifiedCount: 1,
      evidenceMissingCount: 1,
      adapterCatalogDriftCount: 1,
    });
  });
});
