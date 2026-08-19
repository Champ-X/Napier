export interface ContextNumberFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}

export function ContextNumberField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: ContextNumberFieldProps) {
  return (
    <label className="context-field">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          if (Number.isFinite(event.currentTarget.valueAsNumber)) {
            onChange(event.currentTarget.valueAsNumber);
          }
        }}
      />
    </label>
  );
}
