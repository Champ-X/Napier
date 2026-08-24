# Napier Desktop Design System

This file is the closed visual contract for Napier Web. The fenced DTCG JSON
block is the only source for generated values. Product CSS and components use
generated semantic or component custom properties; they never consume primitive
colors directly.

## 0. Meta

```yaml
version: 2.0.0
framework:
  css: plain-css
  ui: react-preact
  build: vite
theme_modes: [light]
dark_mode_strategy: not-enabled
source: DESIGN.md#canonical-dtcg-token-source
```

Napier is desktop-only in this phase. The product contract covers 1280×900,
1440×900, and 1920×1080; generic mobile and touch requirements do not extend
that scope.

## 1. Brand

Napier is a restrained, trustworthy, precise working tool with an editor-like
spatial identity: a deep-ink project navigator, a quiet light work canvas, a
blue execution spine, and evidence that appears on demand. Brand blue identifies
primary action, focus, and execution continuity; it is not a decorative gradient.
Green means success, amber means running/waiting/warning, and red means failure,
danger, or destructive action. Purple and orange are restricted to Running
Trajectory data classes.

Principles:

1. Task result before implementation detail.
2. Semantic tokens before literals; components never reference primitives.
3. Stable desktop geometry before decorative density.
4. Evidence remains reachable without dominating the ordinary task path.
5. Accessibility, explicit state, and reduced motion are release gates.
6. Hierarchy comes from space and typography before cards, borders, or shadows.
7. Conversation, task, and trajectory share one execution language while keeping
   visibly distinct information structures.

## 2. Color

### 2.1 Canonical DTCG token source

<!-- napier-design-tokens:start -->

```json
{
  "$schema": "https://design-tokens.github.io/community-group/format/",
  "color": {
    "neutral": {
      "0": { "$type": "color", "$value": "#FFFFFF" },
      "50": { "$type": "color", "$value": "#F7F8FA" },
      "100": { "$type": "color", "$value": "#F4F6F9" },
      "150": { "$type": "color", "$value": "#EEF0F5" },
      "200": { "$type": "color", "$value": "#E8EBF0" },
      "300": { "$type": "color", "$value": "#D5DAE1" },
      "400": { "$type": "color", "$value": "#9AA2AC" },
      "500": { "$type": "color", "$value": "#7A838D" },
      "600": { "$type": "color", "$value": "#69717B" },
      "700": { "$type": "color", "$value": "#596069" },
      "900": { "$type": "color", "$value": "#1A1D1F" }
    },
    "brand": {
      "50": { "$type": "color", "$value": "#EEF1FF" },
      "400": { "$type": "color", "$value": "#6F86FF" },
      "500": { "$type": "color", "$value": "#4D6BFE" },
      "600": { "$type": "color", "$value": "#3A58EC" },
      "700": { "$type": "color", "$value": "#3A54E0" },
      "800": { "$type": "color", "$value": "#3048C8" }
    },
    "ink": {
      "100": { "$type": "color", "$value": "#E7ECF2" },
      "300": { "$type": "color", "$value": "#AEB9C7" },
      "700": { "$type": "color", "$value": "#2B3442" },
      "800": { "$type": "color", "$value": "#202733" },
      "900": { "$type": "color", "$value": "#171C25" },
      "950": { "$type": "color", "$value": "#10141B" }
    },
    "success": {
      "100": { "$type": "color", "$value": "#DFE9E0" },
      "600": { "$type": "color", "$value": "#456B5B" },
      "700": { "$type": "color", "$value": "#315B48" }
    },
    "warning": {
      "100": { "$type": "color", "$value": "#F3E8C8" },
      "500": { "$type": "color", "$value": "#C2891A" },
      "600": { "$type": "color", "$value": "#97731D" },
      "700": { "$type": "color", "$value": "#765814" }
    },
    "danger": {
      "100": { "$type": "color", "$value": "#FDECEC" },
      "500": { "$type": "color", "$value": "#E5484D" },
      "600": { "$type": "color", "$value": "#B85A4B" },
      "700": { "$type": "color", "$value": "#B43F3E" },
      "800": { "$type": "color", "$value": "#843C2D" }
    },
    "trajectory": {
      "input-surface": { "$type": "color", "$value": "#E7F4EC" },
      "input-fg": { "$type": "color", "$value": "#1F7A4D" },
      "model-surface": { "$type": "color", "$value": "#F1EBF7" },
      "model-fg": { "$type": "color", "$value": "#775A9C" },
      "tool-surface": { "$type": "color", "$value": "#FFF0DE" },
      "tool-fg": { "$type": "color", "$value": "#A15900" }
    }
  },
  "semantic": {
    "color": {
      "bg": { "$type": "color", "$value": "{color.neutral.50}" },
      "bg-subtle": { "$type": "color", "$value": "{color.neutral.100}" },
      "surface": { "$type": "color", "$value": "{color.neutral.0}" },
      "surface-raised": { "$type": "color", "$value": "{color.neutral.50}" },
      "surface-muted": { "$type": "color", "$value": "{color.neutral.150}" },
      "surface-selected": { "$type": "color", "$value": "{color.brand.50}" },
      "canvas": { "$type": "color", "$value": "{color.neutral.100}" },
      "paper": { "$type": "color", "$value": "{color.neutral.0}" },
      "fg": { "$type": "color", "$value": "{color.neutral.900}" },
      "fg-muted": { "$type": "color", "$value": "{color.neutral.700}" },
      "fg-subtle": { "$type": "color", "$value": "{color.neutral.600}" },
      "fg-disabled": { "$type": "color", "$value": "{color.neutral.700}" },
      "fg-on-accent": { "$type": "color", "$value": "{color.neutral.0}" },
      "border": { "$type": "color", "$value": "{color.neutral.300}" },
      "border-subtle": { "$type": "color", "$value": "{color.neutral.200}" },
      "border-strong": { "$type": "color", "$value": "{color.neutral.500}" },
      "accent": { "$type": "color", "$value": "{color.brand.600}" },
      "accent-hover": { "$type": "color", "$value": "{color.brand.700}" },
      "accent-active": { "$type": "color", "$value": "{color.brand.800}" },
      "accent-subtle": { "$type": "color", "$value": "{color.brand.50}" },
      "focus-ring": { "$type": "color", "$value": "{color.brand.500}" },
      "navigation-bg": { "$type": "color", "$value": "{color.ink.950}" },
      "navigation-surface": { "$type": "color", "$value": "{color.ink.900}" },
      "navigation-surface-hover": {
        "$type": "color",
        "$value": "{color.ink.800}"
      },
      "navigation-border": { "$type": "color", "$value": "{color.ink.700}" },
      "navigation-fg": { "$type": "color", "$value": "{color.neutral.0}" },
      "navigation-fg-muted": { "$type": "color", "$value": "{color.ink.300}" },
      "execution-spine": { "$type": "color", "$value": "{color.brand.500}" },
      "execution-spine-subtle": {
        "$type": "color",
        "$value": "{color.brand.50}"
      },
      "success": { "$type": "color", "$value": "{color.success.700}" },
      "success-surface": { "$type": "color", "$value": "{color.success.100}" },
      "success-border": { "$type": "color", "$value": "{color.success.600}" },
      "warning": { "$type": "color", "$value": "{color.warning.700}" },
      "warning-surface": { "$type": "color", "$value": "{color.warning.100}" },
      "warning-border": { "$type": "color", "$value": "{color.warning.600}" },
      "warning-solid": { "$type": "color", "$value": "{color.warning.500}" },
      "danger": { "$type": "color", "$value": "{color.danger.700}" },
      "danger-surface": { "$type": "color", "$value": "{color.danger.100}" },
      "danger-border": { "$type": "color", "$value": "{color.danger.600}" },
      "danger-accent": { "$type": "color", "$value": "{color.danger.500}" },
      "danger-fg": { "$type": "color", "$value": "{color.danger.800}" },
      "trajectory-input-surface": {
        "$type": "color",
        "$value": "{color.trajectory.input-surface}"
      },
      "trajectory-input-fg": {
        "$type": "color",
        "$value": "{color.trajectory.input-fg}"
      },
      "trajectory-model-surface": {
        "$type": "color",
        "$value": "{color.trajectory.model-surface}"
      },
      "trajectory-model-fg": {
        "$type": "color",
        "$value": "{color.trajectory.model-fg}"
      },
      "trajectory-tool-surface": {
        "$type": "color",
        "$value": "{color.trajectory.tool-surface}"
      },
      "trajectory-tool-fg": {
        "$type": "color",
        "$value": "{color.trajectory.tool-fg}"
      }
    }
  },
  "font": {
    "family": {
      "sans": {
        "$type": "fontFamily",
        "$value": [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "PingFang SC",
          "Hiragino Sans GB",
          "Noto Sans CJK SC",
          "Microsoft YaHei",
          "Arial",
          "sans-serif"
        ]
      },
      "mono": {
        "$type": "fontFamily",
        "$value": [
          "SFMono-Regular",
          "Cascadia Mono",
          "Roboto Mono",
          "Noto Sans Mono CJK SC",
          "Consolas",
          "monospace"
        ]
      }
    },
    "weight": {
      "regular": { "$type": "fontWeight", "$value": 400 },
      "medium": { "$type": "fontWeight", "$value": 500 },
      "semibold": { "$type": "fontWeight", "$value": 600 },
      "bold": { "$type": "fontWeight", "$value": 700 }
    }
  },
  "type": {
    "size": {
      "xs": { "$type": "dimension", "$value": { "value": 12, "unit": "px" } },
      "sm": { "$type": "dimension", "$value": { "value": 13, "unit": "px" } },
      "base": { "$type": "dimension", "$value": { "value": 15, "unit": "px" } },
      "lg": { "$type": "dimension", "$value": { "value": 16, "unit": "px" } },
      "xl": { "$type": "dimension", "$value": { "value": 22, "unit": "px" } },
      "2xl": { "$type": "dimension", "$value": { "value": 30, "unit": "px" } },
      "3xl": { "$type": "dimension", "$value": { "value": 32, "unit": "px" } },
      "4xl": { "$type": "dimension", "$value": { "value": 40, "unit": "px" } },
      "annotation": {
        "$type": "dimension",
        "$value": { "value": 11, "unit": "px" }
      }
    },
    "line": {
      "compact": { "$type": "number", "$value": 1.45 },
      "body": { "$type": "number", "$value": 1.7 },
      "heading": { "$type": "number", "$value": 1.3 }
    }
  },
  "space": {
    "0": { "$type": "dimension", "$value": { "value": 0, "unit": "px" } },
    "1": { "$type": "dimension", "$value": { "value": 4, "unit": "px" } },
    "2": { "$type": "dimension", "$value": { "value": 8, "unit": "px" } },
    "3": { "$type": "dimension", "$value": { "value": 12, "unit": "px" } },
    "4": { "$type": "dimension", "$value": { "value": 16, "unit": "px" } },
    "6": { "$type": "dimension", "$value": { "value": 24, "unit": "px" } },
    "8": { "$type": "dimension", "$value": { "value": 32, "unit": "px" } },
    "10": { "$type": "dimension", "$value": { "value": 40, "unit": "px" } },
    "12": { "$type": "dimension", "$value": { "value": 48, "unit": "px" } },
    "16": { "$type": "dimension", "$value": { "value": 64, "unit": "px" } },
    "20": { "$type": "dimension", "$value": { "value": 80, "unit": "px" } },
    "24": { "$type": "dimension", "$value": { "value": 96, "unit": "px" } }
  },
  "inset": {
    "xs": { "$type": "dimension", "$value": "{space.2}" },
    "sm": { "$type": "dimension", "$value": "{space.3}" },
    "md": { "$type": "dimension", "$value": "{space.4}" },
    "lg": { "$type": "dimension", "$value": "{space.6}" },
    "xl": { "$type": "dimension", "$value": "{space.8}" }
  },
  "stack": {
    "xs": { "$type": "dimension", "$value": "{space.1}" },
    "sm": { "$type": "dimension", "$value": "{space.2}" },
    "md": { "$type": "dimension", "$value": "{space.4}" },
    "lg": { "$type": "dimension", "$value": "{space.6}" },
    "xl": { "$type": "dimension", "$value": "{space.10}" }
  },
  "inline": {
    "xs": { "$type": "dimension", "$value": "{space.1}" },
    "sm": { "$type": "dimension", "$value": "{space.2}" },
    "md": { "$type": "dimension", "$value": "{space.3}" },
    "lg": { "$type": "dimension", "$value": "{space.4}" },
    "xl": { "$type": "dimension", "$value": "{space.6}" }
  },
  "radius": {
    "sm": { "$type": "dimension", "$value": { "value": 6, "unit": "px" } },
    "md": { "$type": "dimension", "$value": { "value": 10, "unit": "px" } },
    "lg": { "$type": "dimension", "$value": { "value": 14, "unit": "px" } },
    "xl": { "$type": "dimension", "$value": { "value": 18, "unit": "px" } },
    "full": { "$type": "dimension", "$value": "{radius.xl}" }
  },
  "shadow": {
    "none": { "$type": "string", "$value": "none" },
    "raised": {
      "$type": "string",
      "$value": "0 1px 2px rgb(23 33 60 / 6%), 0 8px 24px rgb(23 33 60 / 8%)"
    },
    "modal": {
      "$type": "string",
      "$value": "0 2px 6px rgb(23 33 60 / 10%), 0 24px 60px rgb(23 33 60 / 18%)"
    }
  },
  "duration": {
    "fast": { "$type": "duration", "$value": { "value": 120, "unit": "ms" } },
    "base": { "$type": "duration", "$value": { "value": 160, "unit": "ms" } },
    "slow": { "$type": "duration", "$value": { "value": 220, "unit": "ms" } }
  },
  "ease": {
    "out": { "$type": "cubicBezier", "$value": [0.2, 0, 0, 1] },
    "in": { "$type": "cubicBezier", "$value": [0.4, 0, 1, 1] },
    "standard": { "$type": "cubicBezier", "$value": [0.4, 0, 0.2, 1] }
  },
  "layout": {
    "reading-min": {
      "$type": "dimension",
      "$value": { "value": 760, "unit": "px" }
    },
    "reading-target": {
      "$type": "dimension",
      "$value": { "value": 800, "unit": "px" }
    },
    "reading-max": {
      "$type": "dimension",
      "$value": { "value": 840, "unit": "px" }
    },
    "sidebar-expanded": {
      "$type": "dimension",
      "$value": { "value": 272, "unit": "px" }
    },
    "sidebar-compact": {
      "$type": "dimension",
      "$value": { "value": 68, "unit": "px" }
    },
    "evidence-rail": {
      "$type": "dimension",
      "$value": { "value": 320, "unit": "px" }
    },
    "command-bar": {
      "$type": "dimension",
      "$value": { "value": 58, "unit": "px" }
    },
    "status-bar": {
      "$type": "dimension",
      "$value": { "value": 44, "unit": "px" }
    },
    "settings-form": {
      "$type": "dimension",
      "$value": { "value": 800, "unit": "px" }
    },
    "composer-shell": {
      "$type": "dimension",
      "$value": { "value": 72, "unit": "px" }
    },
    "composer-min": {
      "$type": "dimension",
      "$value": { "value": 44, "unit": "px" }
    },
    "composer-max": {
      "$type": "dimension",
      "$value": { "value": 240, "unit": "px" }
    },
    "execution-gutter": {
      "$type": "dimension",
      "$value": { "value": 40, "unit": "px" }
    }
  },
  "control": {
    "target": { "$type": "dimension", "$value": { "value": 32, "unit": "px" } },
    "target-primary": {
      "$type": "dimension",
      "$value": { "value": 40, "unit": "px" }
    },
    "focus-width": {
      "$type": "dimension",
      "$value": { "value": 3, "unit": "px" }
    },
    "focus-offset": {
      "$type": "dimension",
      "$value": { "value": 2, "unit": "px" }
    }
  }
}
```

<!-- napier-design-tokens:end -->

### 2.2 Primitive palette reference

These blocks mirror the canonical JSON and exist so design tooling can inspect
contrast. `check:web-design` rejects any drift between the two representations.

```tokens color.neutral
- 0 (color): #FFFFFF
- 50 (color): #F7F8FA
- 100 (color): #F4F6F9
- 150 (color): #EEF0F5
- 200 (color): #E8EBF0
- 300 (color): #D5DAE1
- 400 (color): #9AA2AC
- 500 (color): #7A838D
- 600 (color): #69717B
- 700 (color): #596069
- 900 (color): #1A1D1F
```

```tokens color.brand
- 50 (color): #EEF1FF
- 400 (color): #6F86FF
- 500 (color): #4D6BFE
- 600 (color): #3A58EC
- 700 (color): #3A54E0
- 800 (color): #3048C8
```

```tokens color.ink
- 100 (color): #E7ECF2
- 300 (color): #AEB9C7
- 700 (color): #2B3442
- 800 (color): #202733
- 900 (color): #171C25
- 950 (color): #10141B
```

```tokens color.status
- success-100 (color): #DFE9E0
- success-600 (color): #456B5B
- success-700 (color): #315B48
- warning-100 (color): #F3E8C8
- warning-500 (color): #C2891A
- warning-600 (color): #97731D
- warning-700 (color): #765814
- danger-100 (color): #FDECEC
- danger-500 (color): #E5484D
- danger-600 (color): #B85A4B
- danger-700 (color): #B43F3E
- danger-800 (color): #843C2D
```

```tokens color.trajectory
- input-surface (color): #E7F4EC
- input-fg (color): #1F7A4D
- model-surface (color): #F1EBF7
- model-fg (color): #775A9C
- tool-surface (color): #FFF0DE
- tool-fg (color): #A15900
```

### 2.3 Semantic color reference

Napier currently ships one light theme; the duplicated Dark column keeps generic
auditors deterministic without implying a supported dark product theme.

| Token                              | Light                 | Dark                  | Role                          | Required contrast        |
| ---------------------------------- | --------------------- | --------------------- | ----------------------------- | ------------------------ |
| `--color-bg`                       | `{color.neutral.50}`  | `{color.neutral.50}`  | Page canvas                   | —                        |
| `--color-bg-subtle`                | `{color.neutral.100}` | `{color.neutral.100}` | Recessed canvas               | —                        |
| `--color-surface`                  | `{color.neutral.0}`   | `{color.neutral.0}`   | Card and panel                | —                        |
| `--color-surface-raised`           | `{color.neutral.50}`  | `{color.neutral.50}`  | Elevated surface              | —                        |
| `--color-canvas`                   | `{color.neutral.100}` | `{color.neutral.100}` | Editor work canvas            | —                        |
| `--color-paper`                    | `{color.neutral.0}`   | `{color.neutral.0}`   | Primary reading surface       | —                        |
| `--color-fg`                       | `{color.neutral.900}` | `{color.neutral.900}` | Primary text                  | 4.5:1                    |
| `--color-fg-muted`                 | `{color.neutral.700}` | `{color.neutral.700}` | Secondary text                | 4.5:1                    |
| `--color-fg-subtle`                | `{color.neutral.600}` | `{color.neutral.600}` | Help text                     | 4.5:1                    |
| `--color-fg-on-accent`             | `{color.neutral.0}`   | `{color.neutral.0}`   | Primary-action text           | 4.5:1                    |
| `--color-border`                   | `{color.neutral.300}` | `{color.neutral.300}` | Decorative border             | advisory                 |
| `--color-border-subtle`            | `{color.neutral.200}` | `{color.neutral.200}` | Divider                       | —                        |
| `--color-border-strong`            | `{color.neutral.500}` | `{color.neutral.500}` | Sole control boundary         | 3:1                      |
| `--color-accent`                   | `{color.brand.600}`   | `{color.brand.600}`   | Primary action and link       | 4.5:1 on action          |
| `--color-accent-hover`             | `{color.brand.700}`   | `{color.brand.700}`   | Hover                         | —                        |
| `--color-accent-subtle`            | `{color.brand.50}`    | `{color.brand.50}`    | Selected surface              | —                        |
| `--color-focus-ring`               | `{color.brand.500}`   | `{color.brand.500}`   | Focus and indicator           | 3:1                      |
| `--color-navigation-bg`            | `{color.ink.950}`     | `{color.ink.950}`     | Project navigator             | —                        |
| `--color-navigation-surface`       | `{color.ink.900}`     | `{color.ink.900}`     | Navigator row and control     | —                        |
| `--color-navigation-surface-hover` | `{color.ink.800}`     | `{color.ink.800}`     | Navigator hover and selection | —                        |
| `--color-navigation-border`        | `{color.ink.700}`     | `{color.ink.700}`     | Navigator divider             | advisory                 |
| `--color-navigation-fg`            | `{color.neutral.0}`   | `{color.neutral.0}`   | Navigator primary text        | 4.5:1                    |
| `--color-navigation-fg-muted`      | `{color.ink.300}`     | `{color.ink.300}`     | Navigator secondary text      | 4.5:1                    |
| `--color-execution-spine`          | `{color.brand.500}`   | `{color.brand.500}`   | Active execution continuity   | 3:1                      |
| `--color-execution-spine-subtle`   | `{color.brand.50}`    | `{color.brand.50}`    | Execution node surface        | —                        |
| `--color-success`                  | `{color.success.700}` | `{color.success.700}` | Success                       | 4.5:1 on surface         |
| `--color-warning`                  | `{color.warning.700}` | `{color.warning.700}` | Running/waiting/warning       | 4.5:1 on warning surface |
| `--color-danger`                   | `{color.danger.700}`  | `{color.danger.700}`  | Failure and destructive       | 4.5:1 with white         |

### 2.4 Contrast and color boundaries

- White on primary `#3A58EC` is 5.55:1.
- Default text `#1A1D1F` on white is 16.94:1.
- Muted text `#596069` on white is 6.36:1.
- Focus `#4D6BFE` against white is 4.33:1 and is not used for normal text.
- Navigator text `#FFFFFF` on `#10141B` is above 18:1; muted navigator text
  `#AEB9C7` remains above 8:1.
- Decorative `#9AA2AC` and `#D5DAE1` never carry text or sole control boundaries.
- Trajectory input/model/tool pairs pass 4.5:1 and are allowlisted only inside
  Running Trajectory, its legend, filters, and this design-system showcase.

## 3. Typography

Generated variables include `--font-sans`, `--font-mono`, `--text-xs`,
`--text-sm`, `--text-base`, `--text-lg`, `--text-xl`, `--text-2xl`,
`--text-3xl`, and `--text-4xl`.

- Page: 30/39, section: 22/29, card: 16/23.
- Conversation/body: 15px with 1.7 line-height.
- Compact body: 14px; control: 13px; help: 12px.
- 11px is restricted to trajectory chart annotations.
- Sans is used for UI and Chinese prose. Mono is restricted to code, paths,
  model IDs, hashes, and other technical data.

## 4. Spacing

The 4/8px rhythm is expressed as `space`, `inset`, `stack`, and `inline`
tokens. Components use role aliases such as `--inset-md`, never raw spacing
values. Use logical properties (`padding-inline`, `margin-inline-start`) for
i18n-safe layout.

## 5. Radius

Only 6, 10, 14, and 18px are available as `--radius-sm`, `--radius-md`,
`--radius-lg`, and `--radius-xl`; `--radius-full` aliases 18px rather than
introducing a fifth shape value.

## 6. Elevation

Only `--shadow-none`, `--shadow-raised`, and `--shadow-modal` are available.
Composer uses raised at most; Dialog and Drawer may use modal.

The focus double ring uses `box-shadow` with `--color-focus-ring` for contrast
on every surface:

```css
box-shadow:
  0 0 0 2px var(--color-surface),
  0 0 0 5px var(--color-focus-ring);
```

## 7. Motion

`--duration-fast`, `--duration-base`, and `--duration-slow` are 120, 160,
and 220ms. `--ease-out`, `--ease-in`, and `--ease-standard` are the only
easing curves. Only opacity and transform animate. Page changes do not use
large translations.

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

## 8. Component State Matrix

Every interactive component implements applicable `default`, `hover`,
`focus-visible`, `active`, `disabled`, `loading`, `error`, and `readonly`
states. Button loading locks width and exposes `aria-busy`; Field error uses
the danger semantic family; readonly remains legible and focusable.

Data views expose exactly one of loading, empty, error, running/waiting,
failed/recovering, completed, or content. Empty and error never coexist.

In `forced-colors: active`, interactive surfaces use system borders and a 3px
Highlight focus outline with 2px offset. The ordinary focus treatment is the
double box-shadow above.

## 9. Layout and V2 visual architecture

- Sidebar: 272px expanded and 68px compact.
- Command Bar: 58px; it combines session identity, workspace views, execution
  status, model, and settings in one row. The 44px status token remains for
  compact status controls and compatibility, not a permanent second header row.
- Reading axis: 800px target, 760–840px allowed.
- Evidence rail: 320px without moving the primary axis by more than 2px.
- Settings form: 800px.
- Composer shell: 72px at rest; textarea: 44–240px and expands upward.
- Execution gutter: 40px for the shared conversation, task, and trajectory spine.
- Desktop controls are at least 32px and primary actions at least 40px.
- Validate at 1280×900, 1440×900, and 1920×1080 only; mobile/touch is out of
  scope by the product requirements.

Page shells use desktop viewport queries where needed. Reusable components use
container queries or intrinsic `minmax()`/`clamp()` layout. No document-level
horizontal overflow is permitted.

The project navigator is the only persistent dark surface. The main workspace
uses `--color-canvas`, while the bounded reading surface uses `--color-paper`.
Conversation, task, and trajectory use `--color-execution-spine` to express
causal continuity; trajectory input/model/tool colors classify data but never
replace the spine. Evidence is summarized first and expands into the 320px rail
or a local details region. Borders and shadows do not substitute for hierarchy.

## 10. Agent Prompt Guide

Before editing UI, read this file and the generated token file. New or
materially rewritten components must:

- reference semantic/component variables only;
- export their Props interface;
- stay at or below 300 LOC, 80 LOC per function, JSX depth 6, and 10 hooks;
- implement applicable interaction states, keyboard semantics, `focus-visible`,
  forced colors, and reduced motion;
- keep user-visible copy in the i18n layer;
- validate at the three desktop viewports and never claim mobile acceptance.

Any new primitive, semantic role, trajectory allowlist entry, or target visual
baseline requires an explicit reviewed change to this contract.
