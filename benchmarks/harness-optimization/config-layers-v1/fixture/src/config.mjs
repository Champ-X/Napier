import { mergeConfig } from './merge.mjs';
export function resolveConfig(defaults, fileLayers = [], environment = {}, overrides = {}) {
  const env = {};
  if (environment.APP_PORT) env.server = {port: Number(environment.APP_PORT)};
  if (environment.APP_DEBUG) env.debug = Boolean(environment.APP_DEBUG);
  if (environment.APP_TAGS) env.tags = environment.APP_TAGS.split(',');
  return [...fileLayers, env, overrides].reduce(mergeConfig, defaults);
}
