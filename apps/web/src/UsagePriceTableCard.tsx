import type { CSSProperties } from "react";
import { ShieldCheck } from "lucide-react";

import type { UsagePriceTableCatalog } from "@napier/contracts";

import { contextCopy } from "./context-copy";
import "./context-evidence-card.css";

export interface UsagePriceTableCardProps {
  catalog: UsagePriceTableCatalog;
}

const responsiveCardStyle = {
  "--context-evidence-columns":
    "repeat(auto-fit, minmax(min(var(--context-evidence-column-min), 100%), 1fr))",
  "--context-evidence-heading-size":
    "clamp(var(--text-sm), calc(var(--text-sm) + 0.15vw), var(--text-base))",
} as CSSProperties;

export function UsagePriceTableCard({ catalog }: UsagePriceTableCardProps) {
  const providers = catalog.tables.map((table) => table.provider).join(", ");
  return (
    <section
      className="context-evidence-card usage-price-table-card"
      aria-labelledby="usage-price-table-title"
      style={responsiveCardStyle}
    >
      <header>
        <div>
          <span>{contextCopy.priceTableEyebrow}</span>
          <h3 id="usage-price-table-title">{contextCopy.priceTable}</h3>
        </div>
        <span>
          {catalog.tables.length} {contextCopy.priceTables}
        </span>
      </header>
      <p>{contextCopy.priceTableBody}</p>
      <dl>
        <div>
          <dt>{contextCopy.providers}</dt>
          <dd><code>{providers}</code></dd>
        </div>
        <div>
          <dt>{contextCopy.catalogHash}</dt>
          <dd><code>{catalog.contentSha256.slice(0, 12)}</code></dd>
        </div>
      </dl>
      <small>
        <ShieldCheck size={12} aria-hidden="true" />
        {contextCopy.priceTableSafety}
      </small>
    </section>
  );
}
