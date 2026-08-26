import { KeyRound, Plus, Trash2 } from "lucide-react";

import type { ModelRouteCredentialPool } from "@napier/contracts/model-route";

import { modelRouteCopy } from "./model-route-copy";
import { removeModelRouteReference } from "./model-route-editor";
import type { ContextPanelController } from "./use-context-panel-controller";

export function ModelRouteCredentialPools({
  controller,
}: {
  controller: ContextPanelController;
}) {
  const pools = controller.modelRoutePolicy.credentialPools ?? [];
  const availableProvider = controller.providers.find(
    (provider) => !pools.some((pool) => pool.providerId === provider),
  );
  type PoolPatch = Omit<
    Partial<ModelRouteCredentialPool>,
    "credentialReferenceIds"
  > & { credentialReferenceIds?: string[] | undefined };
  const update = (index: number, patch: PoolPatch) => {
    const credentialPools = pools.map((pool, candidate) =>
      candidate === index ? updatePool(pool, patch) : pool,
    );
    controller.setModelRoutePolicy({
      ...controller.modelRoutePolicy,
      credentialPools,
    });
  };
  const remove = (index: number) => {
    const removed = pools[index]!;
    const next = removeModelRouteReference(
      controller.modelRoutePolicy,
      "credentialPoolId",
      removed.id,
    );
    next.credentialPools = pools.filter((_, candidate) => candidate !== index);
    controller.setModelRoutePolicy(next);
  };
  return (
    <section className="model-route-registry">
      <header>
        <div>
          <KeyRound size={13} aria-hidden="true" />
          <strong>{modelRouteCopy.pools}</strong>
        </div>
        <small>{pools.length}/32</small>
      </header>
      <p>{modelRouteCopy.poolHint}</p>
      {pools.map((pool, index) => {
        const available = controller.credentials.filter(
          (credential) =>
            credential.providerId === pool.providerId &&
            credential.status === "active",
        );
        return (
          <article
            className="model-route-registry-row"
            key={`${pool.id}-${index}`}
          >
            <div className="model-route-registry-title">
              <code>C{String(index + 1).padStart(2, "0")}</code>
              <button
                type="button"
                onClick={() => remove(index)}
                aria-label={modelRouteCopy.removePool}
              >
                <Trash2 size={13} />
              </button>
            </div>
            <div className="model-route-grid">
              <label className="context-field">
                <span>{modelRouteCopy.poolId}</span>
                <input
                  value={pool.id}
                  onChange={(event) =>
                    update(index, { id: event.target.value })
                  }
                />
              </label>
              <label className="context-field">
                <span>{modelRouteCopy.provider}</span>
                <select
                  value={pool.providerId}
                  onChange={(event) =>
                    update(index, {
                      providerId: event.target.value,
                      credentialReferenceIds: undefined,
                    })
                  }
                >
                  {controller.providers.map((provider) => (
                    <option key={provider} value={provider}>
                      {provider}
                    </option>
                  ))}
                </select>
              </label>
              <label className="context-field">
                <span>{modelRouteCopy.strategy}</span>
                <select value="round_robin" disabled>
                  <option value="round_robin">
                    {modelRouteCopy.roundRobin}
                  </option>
                </select>
              </label>
              <fieldset className="model-route-members">
                <legend>{modelRouteCopy.members}</legend>
                <label>
                  <input
                    type="checkbox"
                    checked={pool.credentialReferenceIds === undefined}
                    onChange={(event) =>
                      update(index, {
                        credentialReferenceIds: event.target.checked
                          ? undefined
                          : [],
                      })
                    }
                  />
                  {modelRouteCopy.activeProviderCredentials}
                </label>
                {available.map((credential) => (
                  <label key={credential.id}>
                    <input
                      type="checkbox"
                      disabled={pool.credentialReferenceIds === undefined}
                      checked={
                        pool.credentialReferenceIds?.includes(credential.id) ??
                        false
                      }
                      onChange={(event) =>
                        update(index, {
                          credentialReferenceIds: event.target.checked
                            ? [
                                ...(pool.credentialReferenceIds ?? []),
                                credential.id,
                              ]
                            : (pool.credentialReferenceIds ?? []).filter(
                                (id) => id !== credential.id,
                              ),
                        })
                      }
                    />
                    <span>{credential.label}</span>
                    <code>{credential.id}</code>
                  </label>
                ))}
              </fieldset>
            </div>
          </article>
        );
      })}
      <button
        className="model-route-add"
        type="button"
        disabled={pools.length >= 32 || !availableProvider}
        onClick={() => {
          if (!availableProvider) return;
          controller.setModelRoutePolicy({
            ...controller.modelRoutePolicy,
            credentialPools: [
              ...pools,
              {
                id: `${availableProvider}_pool`,
                providerId: availableProvider,
                strategy: "round_robin",
              },
            ],
          });
        }}
      >
        <Plus size={12} />
        {modelRouteCopy.addPool}
      </button>
    </section>
  );
}

function updatePool(
  pool: ModelRouteCredentialPool,
  patch: Omit<Partial<ModelRouteCredentialPool>, "credentialReferenceIds"> & {
    credentialReferenceIds?: string[] | undefined;
  },
): ModelRouteCredentialPool {
  const { credentialReferenceIds, ...safePatch } = patch;
  const next: ModelRouteCredentialPool = { ...pool, ...safePatch };
  if (credentialReferenceIds)
    next.credentialReferenceIds = credentialReferenceIds;
  if (
    Object.hasOwn(patch, "credentialReferenceIds") &&
    patch.credentialReferenceIds === undefined
  )
    delete next.credentialReferenceIds;
  return next;
}
