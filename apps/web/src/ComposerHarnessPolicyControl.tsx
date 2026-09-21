import { useId } from "react";
import {
  HARNESS_POLICY_PRESET_IDS,
  type HarnessPolicyPresetId,
} from "@napier/contracts/harness-experiments";
import { harnessPolicyCopy as copy } from "./harness-policy-copy";
import "./composer-harness-policy.css";

export function ComposerHarnessPolicyControl({
  preset,
  setPreset,
  disabled,
}: {
  preset: HarnessPolicyPresetId | undefined;
  setPreset(preset: HarnessPolicyPresetId | undefined): void;
  disabled: boolean;
}) {
  const id = useId();
  const description =
    preset === "coding-python.v1"
      ? `${copy.codingDescription} ${copy.pythonDescription}`
      : preset === "coding-node.v1"
        ? copy.codingDescription
        : preset === "research.v1"
          ? copy.researchDescription
          : copy.defaultDescription;
  return (
    <div className="composer-harness-policy">
      <label htmlFor={id}>{copy.title}</label>
      <select
        id={id}
        value={preset ?? ""}
        disabled={disabled}
        aria-describedby={`${id}-description`}
        onChange={(event) =>
          setPreset(
            HARNESS_POLICY_PRESET_IDS.find((id) => id === event.target.value),
          )
        }
      >
        <option value="">{copy.default}</option>
        {HARNESS_POLICY_PRESET_IDS.map((id) => (
          <option key={id} value={id}>
            {copy[id]}
          </option>
        ))}
      </select>
      <p id={`${id}-description`}>
        {description} {copy.hint}
      </p>
    </div>
  );
}
