import { Languages } from "lucide-react";

import { copy } from "./copy";
import { getLocale, setLocale } from "./locale";

type SupportedLocale = "zh" | "en";

export interface SettingsLanguagePanelProps {
  current?: SupportedLocale;
  onChange?: (locale: SupportedLocale) => void;
}

export function SettingsLanguagePanel({
  current = getLocale(),
  onChange = setLocale,
}: SettingsLanguagePanelProps) {
  const options: Array<{ id: SupportedLocale; label: string }> = [
    { id: "zh", label: copy.language.chinese },
    { id: "en", label: copy.language.english },
  ];
  return (
    <section
      className="language-panel"
      aria-labelledby="settings-language-title"
    >
      <header className="settings-inline-heading">
        <span>{copy.language.section}</span>
        <h2 id="settings-language-title">{copy.language.section}</h2>
        <p>{copy.language.sectionDescription}</p>
      </header>
      <p className="language-panel-current">
        {copy.language.current}:{" "}
        <strong>
          {options.find((option) => option.id === current)?.label}
        </strong>
      </p>
      <div className="language-panel-options">
        {options.map((option) => (
          <button
            type="button"
            key={option.id}
            className={option.id === current ? "is-active" : ""}
            aria-pressed={option.id === current}
            onClick={() => {
              if (option.id !== current) onChange(option.id);
            }}
          >
            <Languages size={14} aria-hidden="true" />
            {option.label}
          </button>
        ))}
      </div>
    </section>
  );
}
