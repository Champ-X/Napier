import { Plus, Server, Trash2 } from "lucide-react";

import type {
  ProviderEndpointDialect,
  ProviderEndpointProfile,
} from "@napier/contracts/model-route";

import { modelRouteCopy } from "./model-route-copy";
import {
  formatEndpointHeaders,
  parseEndpointHeaders,
  removeModelRouteReference,
} from "./model-route-editor";
import type { ContextPanelController } from "./use-context-panel-controller";

const DIALECTS: readonly ProviderEndpointDialect[] = [
  "provider_default",
  "openai_completions",
  "openai_responses",
  "anthropic_messages",
];

export function ModelRouteEndpointProfiles({
  controller,
}: {
  controller: ContextPanelController;
}) {
  const profiles = controller.modelRoutePolicy.endpointProfiles ?? [];
  type EndpointPatch = Omit<Partial<ProviderEndpointProfile>, "modelId"> & {
    modelId?: string | undefined;
  };
  const update = (index: number, patch: EndpointPatch) => {
    const endpointProfiles = profiles.map((profile, candidate) =>
      candidate === index ? updateProfile(profile, patch) : profile,
    );
    controller.setModelRoutePolicy({
      ...controller.modelRoutePolicy,
      endpointProfiles,
    });
  };
  const remove = (index: number) => {
    const removed = profiles[index]!;
    const next = removeModelRouteReference(
      controller.modelRoutePolicy,
      "endpointProfileId",
      removed.id,
    );
    next.endpointProfiles = profiles.filter(
      (_, candidate) => candidate !== index,
    );
    controller.setModelRoutePolicy(next);
  };
  return (
    <section className="model-route-registry">
      <header>
        <div>
          <Server size={13} aria-hidden="true" />
          <strong>{modelRouteCopy.endpoints}</strong>
        </div>
        <small>{profiles.length}/32</small>
      </header>
      <p>{modelRouteCopy.endpointHint}</p>
      {profiles.map((profile, index) => (
        <article
          className="model-route-registry-row"
          key={`${profile.id}-${index}`}
        >
          <div className="model-route-registry-title">
            <code>E{String(index + 1).padStart(2, "0")}</code>
            <button
              type="button"
              onClick={() => remove(index)}
              aria-label={modelRouteCopy.removeEndpoint}
            >
              <Trash2 size={13} />
            </button>
          </div>
          <div className="model-route-grid">
            <TextField
              label={modelRouteCopy.endpointId}
              value={profile.id}
              onChange={(id) => update(index, { id })}
            />
            <SelectField
              label={modelRouteCopy.provider}
              value={profile.providerId}
              values={controller.providers}
              onChange={(providerId) => update(index, { providerId })}
            />
            <SelectField
              label={modelRouteCopy.kind}
              value={profile.kind}
              values={["direct", "gateway"]}
              labels={[modelRouteCopy.direct, modelRouteCopy.gateway]}
              onChange={(kind) =>
                update(index, { kind: kind as ProviderEndpointProfile["kind"] })
              }
            />
            <SelectField
              label={modelRouteCopy.dialect}
              value={profile.dialect}
              values={DIALECTS}
              onChange={(dialect) =>
                update(index, { dialect: dialect as ProviderEndpointDialect })
              }
            />
            <TextField
              label={modelRouteCopy.baseUrl}
              value={profile.baseUrl}
              wide
              onChange={(baseUrl) => update(index, { baseUrl })}
            />
            <TextField
              label={modelRouteCopy.servedModel}
              value={profile.modelId ?? ""}
              onChange={(modelId) =>
                update(index, { modelId: modelId || undefined })
              }
            />
            <label className="context-field model-route-wide">
              <span>{modelRouteCopy.headers}</span>
              <textarea
                rows={2}
                placeholder={modelRouteCopy.headersPlaceholder}
                value={formatEndpointHeaders(profile.headers)}
                onChange={(event) =>
                  update(index, {
                    headers: parseEndpointHeaders(event.target.value),
                  })
                }
              />
            </label>
          </div>
        </article>
      ))}
      <button
        className="model-route-add"
        type="button"
        disabled={profiles.length >= 32}
        onClick={() => {
          const providerId =
            controller.providers[0] ?? controller.agent.model.provider;
          controller.setModelRoutePolicy({
            ...controller.modelRoutePolicy,
            endpointProfiles: [
              ...profiles,
              {
                id: nextId(
                  "endpoint",
                  profiles.map((profile) => profile.id),
                ),
                providerId,
                kind: "gateway",
                baseUrl: "https://api.example.com",
                dialect: "provider_default",
              },
            ],
          });
        }}
      >
        <Plus size={12} />
        {modelRouteCopy.addEndpoint}
      </button>
    </section>
  );
}

function updateProfile(
  profile: ProviderEndpointProfile,
  patch: Omit<Partial<ProviderEndpointProfile>, "modelId"> & {
    modelId?: string | undefined;
  },
): ProviderEndpointProfile {
  const { modelId, ...safePatch } = patch;
  const next: ProviderEndpointProfile = { ...profile, ...safePatch };
  if (modelId) next.modelId = modelId;
  if (Object.hasOwn(patch, "modelId") && !patch.modelId) delete next.modelId;
  return next;
}

function TextField({
  label,
  value,
  onChange,
  wide = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  wide?: boolean;
}) {
  return (
    <label className={`context-field${wide ? " model-route-wide" : ""}`}>
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function SelectField({
  label,
  value,
  values,
  labels,
  onChange,
}: {
  label: string;
  value: string;
  values: readonly string[];
  labels?: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="context-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {values.map((entry, index) => (
          <option key={entry} value={entry}>
            {labels?.[index] ?? entry}
          </option>
        ))}
      </select>
    </label>
  );
}

function nextId(prefix: string, ids: readonly string[]): string {
  let suffix = ids.length + 1;
  while (ids.includes(`${prefix}_${String(suffix)}`)) suffix += 1;
  return `${prefix}_${String(suffix)}`;
}
