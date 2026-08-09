export function ContextOptionGroup<T extends string>({
  legend,
  options,
  selected,
  disabled,
  onChange,
}: {
  legend: string;
  options: Array<{
    value: T;
    label: string;
    detail: string;
    enabled?: boolean;
  }>;
  selected: T[];
  disabled: boolean;
  onChange: (value: T[]) => void;
}) {
  return (
    <fieldset className="context-option-group">
      <legend>{legend}</legend>
      <div className="context-option-grid">
        {options.map((option) => (
          <label key={option.value}>
            <input
              type="checkbox"
              checked={selected.includes(option.value)}
              disabled={
                disabled ||
                (option.enabled === false && !selected.includes(option.value))
              }
              onChange={(event) =>
                onChange(
                  toggleSelection(selected, option.value, event.target.checked),
                )
              }
            />
            <span>
              <strong>{option.label}</strong>
              <small>{option.detail}</small>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function toggleSelection<T extends string>(
  current: T[],
  value: T,
  selected: boolean,
): T[] {
  return selected
    ? current.includes(value)
      ? current
      : [...current, value]
    : current.filter((candidate) => candidate !== value);
}
