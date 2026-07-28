import type { ModelSummary } from "@napier/contracts";

export interface ModelSelectOption {
  key: string;
  label: string;
  configured: boolean;
  provider: string;
}

export interface ModelProviderGroup {
  provider: string;
  label: string;
  configuredCount: number;
  totalCount: number;
  options: ModelSelectOption[];
}

export function modelProviderGroups(
  models: readonly ModelSummary[],
): ModelProviderGroup[] {
  const groups = new Map<string, ModelSelectOption[]>();
  for (const model of models) {
    const option = modelSelectOption(model);
    groups.set(model.provider, [...(groups.get(model.provider) ?? []), option]);
  }
  return [...groups.entries()]
    .map(([provider, options]) => {
      const sortedOptions = options.sort((left, right) =>
        left.label.localeCompare(right.label),
      );
      const configuredCount = sortedOptions.filter(
        (option) => option.configured,
      ).length;
      return {
        provider,
        label: providerGroupLabel(provider, configuredCount, options.length),
        configuredCount,
        totalCount: options.length,
        options: sortedOptions,
      };
    })
    .sort(compareModelProviderGroups);
}

export function configuredModelProviderGroups(
  models: readonly ModelSummary[],
): ModelProviderGroup[] {
  return modelProviderGroups(models).flatMap((group) => {
    const options = group.options.filter((option) => option.configured);
    return options.length > 0 ? [{ ...group, options }] : [];
  });
}

export function modelSelectOption(model: ModelSummary): ModelSelectOption {
  return {
    key: `${model.provider}/${model.id}`,
    label: `${model.provider} / ${model.name}${
      model.configured ? "" : " · unavailable"
    }`,
    configured: model.configured,
    provider: model.provider,
  };
}

function providerGroupLabel(
  provider: string,
  configuredCount: number,
  totalCount: number,
): string {
  return provider === "napier"
    ? "napier · built in"
    : `${provider} · ${configuredCount}/${totalCount} configured`;
}

function compareModelProviderGroups(
  left: ModelProviderGroup,
  right: ModelProviderGroup,
): number {
  const leftRank =
    left.provider === "napier" ? 0 : left.configuredCount > 0 ? 1 : 2;
  const rightRank =
    right.provider === "napier" ? 0 : right.configuredCount > 0 ? 1 : 2;
  return leftRank - rightRank || left.provider.localeCompare(right.provider);
}
