import type { Context } from "@earendil-works/pi-ai";
import { canonicalJson, sha256 } from "./ed25519.js";

type ToolSurfaceChange = "initial" | "membership" | "definitions" | "order";

/** Match the model-visible fields retained by invocation capsules. Runtime
 * labels and executable callbacks are not provider tool definitions. */
export function projectToolSurface(tools: Context["tools"]) {
  return (tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    ...(tool.constrainedSampling !== undefined
      ? { constrainedSampling: tool.constrainedSampling }
      : {}),
  }));
}

/** Observed schema changes, not inferred admission decisions or cache hits.
 * Each instance belongs to one Run and invocation purpose. */
export class ToolSurfaceProjection {
  private revision = 0;
  private previous?: {
    names: string;
    order: string;
    definitions: string;
  };

  observe(tools: Context["tools"]) {
    const definitions = projectToolSurface(tools);
    const names = definitions.map((tool) => tool.name);
    const current = {
      names: sha256(canonicalJson(names.toSorted())),
      order: sha256(canonicalJson(names)),
      definitions: sha256(
        canonicalJson(
          definitions.map((tool) => canonicalJson(tool)).toSorted(),
        ),
      ),
    };
    const changes: ToolSurfaceChange[] = [];
    if (!this.previous) changes.push("initial");
    else {
      if (current.names !== this.previous.names) changes.push("membership");
      if (current.definitions !== this.previous.definitions)
        changes.push("definitions");
      // Order is comparable only when membership is unchanged. Adding a tool
      // should not also be diagnosed as shuffling the existing surface.
      if (
        current.names === this.previous.names &&
        current.order !== this.previous.order
      )
        changes.push("order");
    }
    if (changes.length) this.revision++;
    this.previous = current;
    return {
      toolSurfaceRevision: this.revision,
      toolSurfaceChanges: changes,
      toolSurfaceRevisionScope: "run_and_invocation_purpose" as const,
    };
  }
}
