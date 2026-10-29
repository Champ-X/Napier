import { createAssistantMessageEventStream, type AssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { ModelCallAttributionV1 } from "@napier/contracts/model-accounting";
import { bindModelResultAttribution } from "./model-call-attribution.js";

/** Synthetic abort/error responses keep linkage without acquiring receipt authority. */
export function linkLogicalModelStream(source: AssistantMessageEventStream, attribution: ModelCallAttributionV1): AssistantMessageEventStream {
  const output = bindModelResultAttribution(createAssistantMessageEventStream(), attribution);
  let result: ReturnType<AssistantMessageEventStream["result"]> | undefined;
  output.result = () => result ??= source.result().then((message) => bindModelResultAttribution(message, attribution));
  output[Symbol.asyncIterator] = async function* () {
    for await (const event of source) {
      if (event.type === "done") bindModelResultAttribution(event.message, attribution);
      else if (event.type === "error") bindModelResultAttribution(event.error, attribution);
      yield event;
    }
  };
  return output;
}
