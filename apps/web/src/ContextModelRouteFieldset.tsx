import { Route, ShieldCheck } from "lucide-react";

import { modelRouteCopy } from "./model-route-copy";
import { ModelRouteBindingGroup } from "./ModelRouteBindingGroup";
import { ModelRouteCredentialPools } from "./ModelRouteCredentialPools";
import { ModelRouteEndpointProfiles } from "./ModelRouteEndpointProfiles";
import type { ContextPanelController } from "./use-context-panel-controller";

export function ContextModelRouteFieldset({
  controller,
}: {
  controller: ContextPanelController;
}) {
  const retry = controller.modelRoutePolicy.retryPolicy ?? {
    jitterRatio: 0.2,
    maxBackoffMs: 120_000,
  };
  return (
    <fieldset
      className={`context-model-route${controller.modelRouteEnabled ? " is-enabled" : ""}`}
      disabled={controller.configurationBusy}
    >
      <legend>{modelRouteCopy.legend}</legend>
      <header>
        <Route size={14} aria-hidden="true" />
        <div>
          <strong>{modelRouteCopy.title}</strong>
          <span>{modelRouteCopy.kicker}</span>
        </div>
        <label className="context-loop-toggle">
          <input
            type="checkbox"
            checked={controller.modelRouteEnabled}
            onChange={(event) =>
              controller.setModelRouteEnabled(event.target.checked)
            }
          />
          {controller.modelRouteEnabled
            ? modelRouteCopy.enabled
            : modelRouteCopy.disabled}
        </label>
      </header>
      <p>{modelRouteCopy.body}</p>
      {controller.modelRouteEnabled ? (
        <div className="model-route-console">
          <div className="model-route-bindings">
            <ModelRouteBindingGroup
              controller={controller}
              group="roles"
              open
            />
            <ModelRouteBindingGroup controller={controller} group="paths" />
            <ModelRouteBindingGroup
              controller={controller}
              group="subagentRoles"
            />
          </div>
          <ModelRouteEndpointProfiles controller={controller} />
          <ModelRouteCredentialPools controller={controller} />
          <section className="model-route-retry">
            <header>
              <strong>{modelRouteCopy.retry}</strong>
            </header>
            <div className="model-route-grid">
              <label className="context-field">
                <span>{modelRouteCopy.jitter}</span>
                <input
                  type="number"
                  min={0}
                  max={0.5}
                  step={0.05}
                  value={retry.jitterRatio}
                  onChange={(event) =>
                    controller.setModelRoutePolicy({
                      ...controller.modelRoutePolicy,
                      retryPolicy: {
                        ...retry,
                        jitterRatio: Number(event.target.value),
                      },
                    })
                  }
                />
              </label>
              <label className="context-field">
                <span>{modelRouteCopy.maxBackoff}</span>
                <input
                  type="number"
                  min={1}
                  max={300}
                  value={retry.maxBackoffMs / 1_000}
                  onChange={(event) =>
                    controller.setModelRoutePolicy({
                      ...controller.modelRoutePolicy,
                      retryPolicy: {
                        ...retry,
                        maxBackoffMs: Number(event.target.value) * 1_000,
                      },
                    })
                  }
                />
              </label>
            </div>
          </section>
          {controller.modelRouteError ? (
            <p
              className="model-route-error"
              id="context-model-route-error"
              role="status"
            >
              {modelRouteCopy.invalid} {routeError(controller.modelRouteError)}
            </p>
          ) : null}
          <p className="model-route-safety">
            <ShieldCheck size={11} />
            {modelRouteCopy.safety}
          </p>
        </div>
      ) : null}
    </fieldset>
  );
}

function routeError(error: string): string {
  const key =
    (
      {
        "endpoint-id": "endpointId",
        "pool-id": "poolId",
        "pool-provider": "poolProvider",
      } as Record<string, keyof typeof modelRouteCopy.errors>
    )[error] ?? (error as keyof typeof modelRouteCopy.errors);
  return modelRouteCopy.errors[key] ?? error;
}
