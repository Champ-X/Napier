import { DatabaseSync } from "node:sqlite";
import { afterEach } from "vitest";
import { createLocalModelCallAdmission } from "../src/model-call-local-admission.js";
import { ModelRegistry } from "../src/models.js";
import { ModelUsageReceiptSpool } from "../src/model-usage-source.js";
import {
  validateModelCallAttribution,
  validateModelPhysicalObservation,
} from "../src/model-usage-observation.js";
import type { LocalStore } from "../src/store.js";

const sources: ModelUsageReceiptSpool[] = [];
afterEach(() => {
  for (const source of sources.splice(0)) source.close();
});

export async function accountedTestRegistry(
  store: LocalStore,
  sourceFile: string,
) {
  const source = await ModelUsageReceiptSpool.open(sourceFile);
  sources.push(source);
  store.modelAccountingRepository.configureSource({ source });
  const models = new ModelRegistry(
    undefined,
    createLocalModelCallAdmission(source),
    store.modelAccountingRepository,
  );
  return {
    models,
    source,
    receipts() {
      const db = new DatabaseSync(sourceFile);
      try {
        return db
          .prepare(
            "SELECT a.attribution_json,r.observation_json,r.acknowledged_at FROM model_usage_reservations a JOIN model_usage_receipts r USING(physical_id)",
          )
          .all()
          .map((row) => {
            const attribution = validateModelCallAttribution(
              JSON.parse(String(row["attribution_json"])),
            );
            return {
              attribution,
              observation: validateModelPhysicalObservation(
                JSON.parse(String(row["observation_json"])),
                attribution,
              ),
              acknowledgedAt: row["acknowledged_at"],
            };
          });
      } finally {
        db.close();
      }
    },
  };
}
