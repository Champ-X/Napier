import type {
  ModelRoleRouteBinding,
  ModelRouteTarget,
} from "@napier/contracts/model-route";

import { modelRouteCopy } from "./model-route-copy";
import {
  replaceRouteTargetModel,
  routeModelFromKey,
  routeModelKey,
  updateRouteTarget,
} from "./model-route-editor";
import type { ContextPanelController } from "./use-context-panel-controller";

export function ModelRouteTargetEditor({
  binding,
  controller,
  index,
  onChange,
  onRemove,
}: {
  binding: ModelRoleRouteBinding;
  controller: ContextPanelController;
  index: "primary" | number;
  onChange: (binding: ModelRoleRouteBinding) => void;
  onRemove?: () => void;
}) {
  const target: ModelRouteTarget =
    index === "primary" ? binding : binding.fallbackTargets![index]!;
  const endpoints = (controller.modelRoutePolicy.endpointProfiles ?? []).filter(
    (profile) => profile.providerId === target.model.provider,
  );
  const pools = (controller.modelRoutePolicy.credentialPools ?? []).filter(
    (pool) => pool.providerId === target.model.provider,
  );
  const modelKey = routeModelKey(target.model);
  const knownModel = controller.modelGroups.some((group) =>
    group.options.some((option) => option.key === modelKey),
  );
  const update = (patch: Parameters<typeof updateRouteTarget>[2]) =>
    onChange(updateRouteTarget(binding, index, patch));
  return (
    <div className="model-route-target">
      <span className="model-route-target-index">
        {index === "primary" ? "P" : `F${String(index + 1)}`}
      </span>
      <label className="context-field">
        <span>{modelRouteCopy.model}</span>
        <select
          value={modelKey}
          onChange={(event) => {
            const model = routeModelFromKey(event.target.value);
            if (model) {
              const next = replaceRouteTargetModel(
                target,
                model,
                controller.modelRoutePolicy,
              );
              onChange(updateRouteTarget(binding, index, next));
            }
          }}
        >
          {!knownModel ? <option value={modelKey}>{modelKey}</option> : null}
          {controller.modelGroups.map((group) => (
            <optgroup key={group.provider} label={group.label}>
              {group.options.map((option) => (
                <option
                  key={option.key}
                  value={option.key}
                  disabled={!option.configured}
                >
                  {option.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label className="context-field">
        <span>{modelRouteCopy.endpoint}</span>
        <select
          value={target.endpointProfileId ?? ""}
          onChange={(event) =>
            update({ endpointProfileId: event.target.value || undefined })
          }
        >
          <option value="">{modelRouteCopy.providerDefault}</option>
          {endpoints.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.id}
            </option>
          ))}
        </select>
      </label>
      <label className="context-field">
        <span>{modelRouteCopy.credentialPool}</span>
        <select
          value={target.credentialPoolId ?? ""}
          onChange={(event) =>
            update({ credentialPoolId: event.target.value || undefined })
          }
        >
          <option value="">{modelRouteCopy.providerDefault}</option>
          {pools.map((pool) => (
            <option key={pool.id} value={pool.id}>
              {pool.id}
            </option>
          ))}
        </select>
      </label>
      {onRemove ? (
        <button className="model-route-remove" type="button" onClick={onRemove}>
          {modelRouteCopy.removeFallback}
        </button>
      ) : null}
    </div>
  );
}
