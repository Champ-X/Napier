import { Plus, Route } from "lucide-react";

import type { ModelRoleRouteBinding } from "@napier/contracts/model-route";

import { modelRouteCopy } from "./model-route-copy";
import {
  MODEL_ROUTE_PATHS,
  MODEL_ROUTE_ROLES,
  MODEL_ROUTE_SUBAGENTS,
  routeBinding,
  routeModelFromKey,
  routeModelKey,
  updateRouteBinding,
  type ModelRouteBindingGroup as BindingGroup,
  type ModelRouteBindingKey,
} from "./model-route-editor";
import { ModelRouteTargetEditor } from "./ModelRouteTargetEditor";
import type { ContextPanelController } from "./use-context-panel-controller";

const GROUP_KEYS = {
  roles: MODEL_ROUTE_ROLES,
  paths: MODEL_ROUTE_PATHS,
  subagentRoles: MODEL_ROUTE_SUBAGENTS,
} as const;

export function ModelRouteBindingGroup({
  controller,
  group,
  open = false,
}: {
  controller: ContextPanelController;
  group: BindingGroup;
  open?: boolean;
}) {
  const policy = controller.modelRoutePolicy;
  const setBinding = (
    key: ModelRouteBindingKey,
    binding?: ModelRoleRouteBinding,
  ) =>
    controller.setModelRoutePolicy(
      updateRouteBinding(policy, group, key, binding),
    );
  const configuredCount = GROUP_KEYS[group].filter((key) =>
    routeBinding(policy, group, key),
  ).length;
  return (
    <details className="model-route-binding-group" open={open}>
      <summary>
        <span>
          <Route size={13} aria-hidden="true" />
          {modelRouteCopy.groups[group]}
        </span>
        <small>
          {configuredCount}/{GROUP_KEYS[group].length}
        </small>
      </summary>
      <p>{modelRouteCopy.groupHints[group]}</p>
      <div className="model-route-binding-list">
        {GROUP_KEYS[group].map((key) => {
          const binding = routeBinding(policy, group, key);
          const usedModels = new Set(
            binding
              ? [binding, ...(binding.fallbackTargets ?? [])].map((target) =>
                  routeModelKey(target.model),
                )
              : [],
          );
          const nextFallback = controller.modelGroups
            .flatMap((provider) => provider.options)
            .find((option) => option.configured && !usedModels.has(option.key));
          return (
            <article
              className={`model-route-binding${binding ? " is-bound" : ""}`}
              key={key}
            >
              <header>
                <div>
                  <strong>{modelRouteCopy.labels[key]}</strong>
                  <code>{key}</code>
                </div>
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(binding)}
                    onChange={(event) =>
                      setBinding(
                        key,
                        event.target.checked
                          ? { model: structuredClone(controller.agent.model) }
                          : undefined,
                      )
                    }
                  />
                  {modelRouteCopy.bind}
                </label>
              </header>
              {binding ? (
                <>
                  <ModelRouteTargetEditor
                    binding={binding}
                    controller={controller}
                    index="primary"
                    onChange={(next) => setBinding(key, next)}
                  />
                  {(binding.fallbackTargets ?? []).map((_, index) => (
                    <ModelRouteTargetEditor
                      key={index}
                      binding={binding}
                      controller={controller}
                      index={index}
                      onChange={(next) => setBinding(key, next)}
                      onRemove={() => {
                        const fallbackTargets =
                          binding.fallbackTargets?.filter(
                            (__, candidateIndex) => candidateIndex !== index,
                          ) ?? [];
                        const next = { ...binding };
                        if (fallbackTargets.length > 0)
                          next.fallbackTargets = fallbackTargets;
                        else delete next.fallbackTargets;
                        setBinding(key, next);
                      }}
                    />
                  ))}
                  {(binding.fallbackTargets?.length ?? 0) < 4 &&
                  nextFallback ? (
                    <button
                      className="model-route-add"
                      type="button"
                      onClick={() =>
                        setBinding(key, {
                          ...binding,
                          fallbackTargets: [
                            ...(binding.fallbackTargets ?? []),
                            { model: routeModelFromKey(nextFallback.key)! },
                          ],
                        })
                      }
                    >
                      <Plus size={12} aria-hidden="true" />
                      {modelRouteCopy.addFallback}
                    </button>
                  ) : null}
                </>
              ) : null}
            </article>
          );
        })}
      </div>
    </details>
  );
}
