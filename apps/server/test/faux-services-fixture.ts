import { createServices } from "../src/app.js";
export { createApp, inferWorkspaceRoot } from "../src/app.js";

/** Explicit test-only pricing policy for the in-memory faux provider. Real
 * providers and tests with a supplied accounting policy retain normal pricing. */
export async function createFauxServices(
  options: Parameters<typeof createServices>[0],
) {
  if (options?.modelCallAdmission) return createServices(options);
  let models: Awaited<ReturnType<typeof createServices>>["models"] | undefined;
  const services = await createServices({
    ...options,
    modelCallAdmission: {
      isDeclaredZeroCost(ref) {
        const model = models?.resolve(ref);
        return Boolean(model?.api.startsWith("faux:") &&
          [model.cost.input, model.cost.output, model.cost.cacheRead, model.cost.cacheWrite]
            .every((price) => price === 0));
      },
      reserve: () => ({ settle: () => undefined }),
    },
  });
  models = services.models;
  return services;
}
