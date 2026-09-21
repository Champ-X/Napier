import type { Context } from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import { PromptCacheProjection } from "../src/prompt-cache-projection.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";

it("ignores runtime labels and callbacks while tracking model-visible constrained sampling", () => {
  const projection = new PromptCacheProjection();
  const schema = {
    name: "read_file",
    description: "Read a file",
    parameters: { type: "object", properties: {} },
  };
  let turnIndex = 0;
  const observe = (tool: typeof schema) =>
    projection.observe({
      turnIndex: ++turnIndex,
      contextEnvelopeSha256: sha256("envelope"),
      invocationIdentitySha256: sha256("identity"),
      context: { messages: [], tools: [tool] },
    });
  const plain = observe(schema);
  const runtime = {
    ...schema,
    label: "private runtime label",
    execute: () => undefined,
  };
  expect(observe(runtime)).toMatchObject({
    orderedToolDefinitionsSha256: plain.orderedToolDefinitionsSha256,
    sameOrderedTools: true,
    toolSurfaceRevision: 1,
    toolSurfaceChanges: [],
  });
  runtime.label = "new runtime label";
  expect(observe(runtime).toolSurfaceRevision).toBe(1);
  const constrained = { ...runtime, constrainedSampling: false as const };
  expect(observe(constrained)).toMatchObject({
    sameOrderedTools: false,
    toolSurfaceRevision: 2,
    toolSurfaceChanges: ["definitions"],
  });
});

it("versions actual tool membership, definitions and order without mutating the request or exposing schemas", () => {
  const projection = new PromptCacheProjection();
  const tool = (name: string, description = "private description") => ({
    name,
    description,
    parameters: { type: "object", properties: {} },
  });
  let turnIndex = 0;
  const observe = (tools: Context["tools"], identity = "model-a") => {
    const context: Context = { messages: [], tools };
    const before = structuredClone(context);
    const result = projection.observe({
      turnIndex: ++turnIndex,
      contextEnvelopeSha256: sha256(String(turnIndex)),
      invocationIdentitySha256: sha256(identity),
      context,
    });
    expect(context).toEqual(before);
    expect(JSON.stringify(result)).not.toMatch(
      /private description|private_tool/,
    );
    const { contentSha256, ...content } = result;
    expect(contentSha256).toBe(sha256(canonicalJson(content)));
    return result;
  };
  const a = tool("private_tool_a"),
    b = tool("private_tool_b");
  const surface = [a, b];
  expect(observe(surface)).toMatchObject({
    schemaVersion: 2,
    toolSurfaceRevision: 1,
    toolSurfaceChanges: ["initial"],
  });
  expect(observe(structuredClone(surface))).toMatchObject({
    toolSurfaceRevision: 1,
    toolSurfaceChanges: [],
  });
  expect(observe(surface, "model-b")).toMatchObject({
    toolSurfaceRevision: 1,
    toolSurfaceChanges: [],
    sameInvocationIdentity: false,
  });
  expect(observe([b, a])).toMatchObject({
    toolSurfaceRevision: 2,
    toolSurfaceChanges: ["order"],
    sameOrderedTools: false,
  });
  expect(observe([b, tool(a.name, "changed description")])).toMatchObject({
    toolSurfaceRevision: 3,
    toolSurfaceChanges: ["definitions"],
  });
  expect(observe(surface)).toMatchObject({
    toolSurfaceRevision: 4,
    toolSurfaceChanges: ["definitions", "order"],
  });
  // No retained object references: mutating the caller's next request cannot
  // rewrite the previous observation's schema identity.
  a.parameters.properties = { changed: { type: "string" } };
  expect(observe(surface)).toMatchObject({
    toolSurfaceRevision: 5,
    toolSurfaceChanges: ["definitions"],
  });
  expect(observe([a])).toMatchObject({
    toolSurfaceRevision: 6,
    toolSurfaceChanges: ["membership", "definitions"],
  });
  expect(observe([])).toMatchObject({
    toolSurfaceRevision: 7,
    toolSurfaceChanges: ["membership", "definitions"],
  });
  expect(observe(undefined)).toMatchObject({
    toolSurfaceRevision: 7,
    toolSurfaceChanges: [],
  });
  const fresh = new PromptCacheProjection().observe({
    turnIndex: 1,
    contextEnvelopeSha256: sha256("fresh"),
    invocationIdentitySha256: sha256("model-a"),
    context: { messages: [], tools: surface },
  });
  expect(fresh).toMatchObject({
    toolSurfaceRevision: 1,
    toolSurfaceChanges: ["initial"],
    toolSurfaceRevisionScope: "run_and_invocation_purpose",
  });
});

it("measures growing durable message prefixes only with identical system, tools and serving identity", () => {
  const projection = new PromptCacheProjection();
  const user = (content: string) => ({
    role: "user" as const,
    content,
    timestamp: 0,
  });
  const request = user("Real request");
  const oldTail = user("Old runtime snapshot");
  const observation = (
    messages: Context["messages"],
    systemPrompt = "static",
    identity = "model-a",
    tools: Context["tools"] = [],
  ) =>
    projection.observe({
      turnIndex: 1,
      contextEnvelopeSha256: sha256("envelope"),
      invocationIdentitySha256: sha256(identity),
      context: { messages, systemPrompt, tools },
    });
  observation([request, oldTail]);
  const next = observation([
    request,
    user("new user instruction"),
    user("new snapshot"),
  ]);
  expect(next.commonMessagePrefixCount).toBe(1);
  expect(next.commonMessagePrefixBytes).toBe(
    Buffer.byteLength(canonicalJson(request)),
  );
  expect(JSON.stringify(next)).not.toContain("Real request");
  expect(observation([request], "changed").commonMessagePrefixCount).toBe(0);
  expect(
    observation([request], "changed", "model-b").commonMessagePrefixCount,
  ).toBe(0);
  expect(
    observation([request], "changed", "model-b", [
      {
        name: "new_tool",
        description: "new",
        parameters: { type: "object", properties: {} },
      },
    ]).commonMessagePrefixCount,
  ).toBe(0);
});

it("measures actual UTF-8 prefixes and invalidates reuse on tool or serving changes without leaking text", () => {
  const projection = new PromptCacheProjection();
  const observe = (
    text: string,
    turnIndex: number,
    identity = "model-a",
    tools: Context["tools"] = [],
  ) =>
    projection.observe({
      turnIndex,
      contextEnvelopeSha256: sha256(String(turnIndex)),
      invocationIdentitySha256: sha256(identity),
      context: { systemPrompt: text, messages: [], tools },
    });
  expect(observe("固定前缀\n秘密甲", 1).commonSystemPrefixBytes).toBe(0);
  const next = observe("固定前缀\n新版本", 2);
  expect(next.schemaCompatibleSystemPrefixBytes).toBeGreaterThanOrEqual(
    Buffer.byteLength("固定前缀\n"),
  );
  expect(next.previousTurnIndex).toBe(1);
  expect(next.providerCacheHit).toBe("not_inferred");
  expect(JSON.stringify(next)).not.toMatch(/秘密|固定|新版本/);
  const { contentSha256, ...content } = next;
  expect(contentSha256).toBe(sha256(canonicalJson(content)));
  const tools = [
    {
      name: "read_file",
      description: "read",
      parameters: { type: "object" as const, properties: {} },
    },
  ];
  expect(
    observe("固定前缀\n新版本", 3, "model-a", tools)
      .schemaCompatibleSystemPrefixBytes,
  ).toBe(0);
  expect(
    observe("固定前缀\n新版本", 4, "model-b", tools).commonSystemPrefixBytes,
  ).toBe(0);
  expect(
    new PromptCacheProjection().observe({
      turnIndex: 1,
      contextEnvelopeSha256: sha256("x"),
      invocationIdentitySha256: sha256("model-b"),
      context: { messages: [] },
    }).previousTurnIndex,
  ).toBeNull();
});
