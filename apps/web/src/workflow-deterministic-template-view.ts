import type {
  ExecutionPlanWorkflowDeterministicTemplate,
  JsonValue,
} from "@napier/contracts";

import { canonicalJson } from "./stable-digest";

const BINDING_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;
const FORBIDDEN_PATH_SEGMENTS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);
const MAX_TEMPLATE_BYTES = 32 * 1024;
const MAX_TEMPLATE_DEPTH = 8;
const MAX_TEMPLATE_NODES = 128;
const MAX_TEMPLATE_PROPERTIES = 32;
const MAX_TEMPLATE_ITEMS = 128;

export function validateWorkflowDeterministicTemplate(
  input: unknown,
): ExecutionPlanWorkflowDeterministicTemplate {
  if (
    new TextEncoder().encode(canonicalJson(input)).byteLength >
    MAX_TEMPLATE_BYTES
  ) {
    throw new Error("Workflow manifest Deterministic template is too large");
  }
  return deterministicTemplate(input, 0, { nodes: 0 });
}

function deterministicTemplate(
  input: unknown,
  depth: number,
  budget: { nodes: number },
): ExecutionPlanWorkflowDeterministicTemplate {
  if (
    depth > MAX_TEMPLATE_DEPTH ||
    ++budget.nodes > MAX_TEMPLATE_NODES ||
    !record(input)
  ) {
    throw new Error("Workflow manifest Deterministic template is invalid");
  }
  if (input["kind"] === "literal") {
    if (
      !exactKeys(input, ["kind", "value"]) ||
      !deterministicJsonValue(input["value"], depth + 1, budget)
    ) {
      throw new Error("Workflow manifest Deterministic literal is invalid");
    }
    return { kind: "literal", value: input["value"] as JsonValue };
  }
  if (input["kind"] === "input") {
    if (!exactKeys(input, ["kind"], ["path"])) {
      throw new Error("Workflow manifest Deterministic input is invalid");
    }
    const path = validatePath(input["path"]);
    return { kind: "input", ...(path ? { path } : {}) };
  }
  if (input["kind"] === "object") {
    if (!exactKeys(input, ["kind", "properties"])) {
      throw new Error("Workflow manifest Deterministic object is invalid");
    }
    const properties = input["properties"];
    if (
      !record(properties) ||
      Object.keys(properties).length > MAX_TEMPLATE_PROPERTIES
    ) {
      throw new Error("Workflow manifest Deterministic object is invalid");
    }
    return {
      kind: "object",
      properties: Object.fromEntries(
        Object.entries(properties).map(([name, value]) => {
          if (!BINDING_NAME.test(name)) {
            throw new Error(
              "Workflow manifest Deterministic property is invalid",
            );
          }
          return [name, deterministicTemplate(value, depth + 1, budget)];
        }),
      ),
    };
  }
  if (
    input["kind"] !== "array" ||
    !exactKeys(input, ["kind", "items"]) ||
    !Array.isArray(input["items"]) ||
    input["items"].length > MAX_TEMPLATE_ITEMS
  ) {
    throw new Error("Workflow manifest Deterministic template is invalid");
  }
  return {
    kind: "array",
    items: input["items"].map((item) =>
      deterministicTemplate(item, depth + 1, budget),
    ),
  };
}

function deterministicJsonValue(
  input: unknown,
  depth: number,
  budget: { nodes: number },
): input is JsonValue {
  if (depth > MAX_TEMPLATE_DEPTH || ++budget.nodes > MAX_TEMPLATE_NODES) {
    return false;
  }
  if (
    input === null ||
    typeof input === "string" ||
    typeof input === "boolean"
  ) {
    return true;
  }
  if (typeof input === "number") return Number.isFinite(input);
  if (Array.isArray(input)) {
    return (
      input.length <= MAX_TEMPLATE_ITEMS &&
      input.every((item) => deterministicJsonValue(item, depth + 1, budget))
    );
  }
  if (
    !record(input) ||
    Object.keys(input).length > MAX_TEMPLATE_PROPERTIES ||
    Object.keys(input).some((name) => !BINDING_NAME.test(name))
  ) {
    return false;
  }
  return Object.values(input).every((value) =>
    deterministicJsonValue(value, depth + 1, budget),
  );
}

function validatePath(input: unknown): Array<string | number> | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input) || input.length < 1 || input.length > 8) {
    throw new Error("Workflow manifest binding path is invalid");
  }
  return input.map((segment) => {
    if (
      typeof segment === "number" &&
      Number.isSafeInteger(segment) &&
      segment >= 0
    ) {
      return segment;
    }
    if (
      typeof segment === "string" &&
      BINDING_NAME.test(segment) &&
      !FORBIDDEN_PATH_SEGMENTS.has(segment)
    ) {
      return segment;
    }
    throw new Error("Workflow manifest binding path segment is invalid");
  });
}

function exactKeys(
  input: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(input, key)) &&
    Object.keys(input).every((key) => allowed.has(key))
  );
}

function record(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === "object" && !Array.isArray(input);
}
