# Napier Product Interface Design System

This file is the versioned visual contract for Napier Web. The fenced DTCG JSON
block is the only source for generated values. Product CSS and components use
generated semantic or component custom properties; they never consume primitive
colors directly. The contract may evolve through reviewed version changes, while
released versions remain stable.

## 0. Meta

```yaml
version: 2.1.0
contract_status: evolving
framework:
  css: plain-css
  ui: react-preact
  build: vite
theme_modes: [light]
dark_mode_strategy: dark-ready-not-enabled
viewport_policy: desktop-primary-reflow-required
source: DESIGN.md#canonical-dtcg-token-source
```

Napier is desktop-primary in this phase. The product baselines remain 1280×900,
1440×900, and 1920×1080. Browser zoom and narrow desktop windows must still
reflow down to 320 CSS px without document-level horizontal overflow. This is a
reflow guarantee, not a commitment to a full mobile or touch product.

## 1. Brand

Napier is a restrained, trustworthy, precise working tool. Its workbench follows
the calm, warm-paper character of a focused editorial workspace: dark ink carries
primary actions, warm gray separates structure, and color appears only when it
communicates state. Green means success, amber means running/waiting/warning, and
red means failure, danger, or destructive action. Purple and orange are restricted
to Running Trajectory data classes.

Principles:

1. Task result before implementation detail.
2. Semantic tokens before literals; components never reference primitives.
3. Stable desktop geometry before decorative density.
4. Evidence remains reachable without dominating the ordinary task path.
5. Accessibility, explicit state, and reduced motion are release gates.
6. Conversation, Task, and Trajectory share one content axis and one shell.
7. Process detail uses progressive disclosure; summaries stay scannable.
8. Conversation is a document flow, not a stack of dashboard cards.
9. Generated files remain in context and open into a dedicated evidence inspector.
10. Completed tool activity reads as a compact verb phrase; status, time, and
    evidence stay subordinate until the row is expanded.
11. A file inspector keeps preview, raw source, and recorded changes in one
    stable place. Switching views or refreshing content never closes the file.
12. Expanded thinking rows show the complete model-provided transcript when it
    was durably retained, after secret redaction. Historical hash-only segments
    state that the original is unavailable and never fabricate replacement text.

## 2. Color

### 2.1 Canonical DTCG token source

<!-- napier-design-tokens:start -->

```json
{
  "$schema": "https://design-tokens.github.io/community-group/format/",
  "color": {
    "neutral": {
      "0": { "$type": "color", "$value": "#FFFFFF" },
      "50": { "$type": "color", "$value": "#FBFAF7" },
      "100": { "$type": "color", "$value": "#F6F4F0" },
      "150": { "$type": "color", "$value": "#F0EEE9" },
      "200": { "$type": "color", "$value": "#E8E5DF" },
      "300": { "$type": "color", "$value": "#D7D3CB" },
      "400": { "$type": "color", "$value": "#AAA69E" },
      "500": { "$type": "color", "$value": "#858078" },
      "600": { "$type": "color", "$value": "#6F6A63" },
      "700": { "$type": "color", "$value": "#514D47" },
      "900": { "$type": "color", "$value": "#1F1E1B" }
    },
    "brand": {
      "50": { "$type": "color", "$value": "#F3F1ED" },
      "400": { "$type": "color", "$value": "#77736C" },
      "500": { "$type": "color", "$value": "#5B5852" },
      "600": { "$type": "color", "$value": "#34332F" },
      "700": { "$type": "color", "$value": "#292824" },
      "800": { "$type": "color", "$value": "#1F1E1B" }
    },
    "ink": {
      "100": { "$type": "color", "$value": "#EEECE7" },
      "300": { "$type": "color", "$value": "#625E57" },
      "700": { "$type": "color", "$value": "#4A4741" },
      "800": { "$type": "color", "$value": "#35332F" },
      "900": { "$type": "color", "$value": "#272622" },
      "950": { "$type": "color", "$value": "#1F1E1B" }
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
      "navigation-bg": { "$type": "color", "$value": "{color.neutral.100}" },
      "navigation-surface": {
        "$type": "color",
        "$value": "{color.neutral.50}"
      },
      "navigation-surface-hover": {
        "$type": "color",
        "$value": "{color.neutral.150}"
      },
      "navigation-border": {
        "$type": "color",
        "$value": "{color.neutral.200}"
      },
      "navigation-fg": { "$type": "color", "$value": "{color.ink.950}" },
      "navigation-fg-muted": { "$type": "color", "$value": "{color.ink.300}" },
      "execution-spine": { "$type": "color", "$value": "{color.neutral.600}" },
      "execution-spine-subtle": {
        "$type": "color",
        "$value": "{color.neutral.150}"
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
      },
      "blue-11": { "$type": "color", "$value": "#131823" },
      "blue-15": { "$type": "color", "$value": "#25262A" },
      "blue-16": { "$type": "color", "$value": "#17213C" },
      "blue-22": { "$type": "color", "$value": "#33363C" },
      "blue-29": { "$type": "color", "$value": "#304F63" },
      "blue-31": { "$type": "color", "$value": "#374B68" },
      "blue-37": { "$type": "color", "$value": "#4B5674" },
      "blue-42": { "$type": "color", "$value": "#5A647B" },
      "blue-49": { "$type": "color", "$value": "#747B86" },
      "blue-50": { "$type": "color", "$value": "#697694" },
      "blue-60": { "$type": "color", "$value": "#9198A2" },
      "blue-67": { "$type": "color", "$value": "#A2A9B3" },
      "blue-72": { "$type": "color", "$value": "#6F86FF" },
      "blue-74": { "$type": "color", "$value": "#B7BCC4" },
      "blue-75": { "$type": "color", "$value": "#D7A7BC" },
      "blue-77": { "$type": "color", "$value": "#B8BFD2" },
      "blue-82": { "$type": "color", "$value": "#C8CEDC" },
      "blue-90": { "$type": "color", "$value": "#DEE3EB" },
      "gold-25": { "$type": "color", "$value": "#6C4B16" },
      "gold-26": { "$type": "color", "$value": "#604C25" },
      "gold-30": { "$type": "color", "$value": "#78601F" },
      "gold-32": { "$type": "color", "$value": "#79602C" },
      "gold-33": { "$type": "color", "$value": "#896821" },
      "gold-35": { "$type": "color", "$value": "#7E5835" },
      "gold-36": { "$type": "color", "$value": "#9A5D1C" },
      "gold-38": { "$type": "color", "$value": "#6B6256" },
      "gold-39": { "$type": "color", "$value": "#A17720" },
      "gold-43": { "$type": "color", "$value": "#91794B" },
      "gold-44": { "$type": "color", "$value": "#A4833E" },
      "gold-45": { "$type": "color", "$value": "#BC8929" },
      "gold-46": { "$type": "color", "$value": "#B38835" },
      "gold-63": { "$type": "color", "$value": "#CF9A74" },
      "gold-64": { "$type": "color", "$value": "#E4B35F" },
      "gold-68": { "$type": "color", "$value": "#B9CF8B" },
      "gold-69": { "$type": "color", "$value": "#D8C188" },
      "gold-77": { "$type": "color", "$value": "#C7C8C0" },
      "gold-84": { "$type": "color", "$value": "#EEE0BD" },
      "gold-91": { "$type": "color", "$value": "#F2E6DC" },
      "gray-30": { "$type": "color", "$value": "#474A50" },
      "gray-52": { "$type": "color", "$value": "#7E8B82" },
      "green-19": { "$type": "color", "$value": "#1F4035" },
      "green-25": { "$type": "color", "$value": "#1E614B" },
      "green-26": { "$type": "color", "$value": "#2D5547" },
      "green-28": { "$type": "color", "$value": "#315F43" },
      "green-33": { "$type": "color", "$value": "#317950" },
      "green-85": { "$type": "color", "$value": "#CAE7D7" },
      "red-32": { "$type": "color", "$value": "#744331" },
      "red-34": { "$type": "color", "$value": "#80362F" },
      "red-35": { "$type": "color", "$value": "#8A4D28" },
      "red-40": { "$type": "color", "$value": "#A43A26" },
      "red-41": { "$type": "color", "$value": "#9E5634" },
      "red-43": { "$type": "color", "$value": "#9A5A3F" },
      "red-44": { "$type": "color", "$value": "#A44B38" },
      "red-46": { "$type": "color", "$value": "#B74A34" },
      "red-59": { "$type": "color", "$value": "#E5484D" },
      "red-67": { "$type": "color", "$value": "#D0A085" },
      "red-72": { "$type": "color", "$value": "#D9A698" },
      "red-76": { "$type": "color", "$value": "#D6B4AF" },
      "red-77": { "$type": "color", "$value": "#DFB8A8" },
      "red-85": { "$type": "color", "$value": "#F0C9C0" },
      "sage-11": { "$type": "color", "$value": "#18201C" },
      "sage-17": { "$type": "color", "$value": "#25342D" },
      "sage-24": { "$type": "color", "$value": "#38443E" },
      "sage-31": { "$type": "color", "$value": "#47584E" },
      "sage-36": { "$type": "color", "$value": "#52675D" },
      "sage-39": { "$type": "color", "$value": "#4F765D" },
      "sage-40": { "$type": "color", "$value": "#617657" },
      "sage-41": { "$type": "color", "$value": "#5C7665" },
      "sage-53": { "$type": "color", "$value": "#769880" },
      "sage-59": { "$type": "color", "$value": "#8F9D95" },
      "sage-61": { "$type": "color", "$value": "#8CA99A" },
      "sage-67": { "$type": "color", "$value": "#9FB8A8" },
      "sage-71": { "$type": "color", "$value": "#A9C3BD" },
      "sage-76": { "$type": "color", "$value": "#B9CDBF" },
      "sage-91": { "$type": "color", "$value": "#E4ECE8" },
      "shadow": { "$type": "color", "$value": "#000000" },
      "teal-28": { "$type": "color", "$value": "#315D5C" }
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
        "$value": { "value": 12, "unit": "px" }
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
    "full": { "$type": "dimension", "$value": { "value": 999, "unit": "px" } }
  },
  "shadow": {
    "none": { "$type": "string", "$value": "none" },
    "raised": {
      "$type": "string",
      "$value": "0 1px 2px rgb(31 30 27 / 5%), 0 8px 28px rgb(31 30 27 / 9%)"
    },
    "modal": {
      "$type": "string",
      "$value": "0 2px 6px rgb(31 30 27 / 10%), 0 24px 64px rgb(31 30 27 / 16%)"
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
    "center-min": {
      "$type": "dimension",
      "$value": { "value": 640, "unit": "px" }
    },
    "reading-min": {
      "$type": "dimension",
      "$value": { "value": 640, "unit": "px" }
    },
    "reading-target": {
      "$type": "dimension",
      "$value": { "value": 760, "unit": "px" }
    },
    "reading-max": {
      "$type": "dimension",
      "$value": { "value": 820, "unit": "px" }
    },
    "sidebar-expanded-min": {
      "$type": "dimension",
      "$value": { "value": 232, "unit": "px" }
    },
    "sidebar-expanded": {
      "$type": "dimension",
      "$value": { "value": 252, "unit": "px" }
    },
    "sidebar-expanded-max": {
      "$type": "dimension",
      "$value": { "value": 480, "unit": "px" }
    },
    "sidebar-compact": {
      "$type": "dimension",
      "$value": { "value": 56, "unit": "px" }
    },
    "evidence-rail-min": {
      "$type": "dimension",
      "$value": { "value": 360, "unit": "px" }
    },
    "evidence-rail": {
      "$type": "dimension",
      "$value": { "value": 760, "unit": "px" }
    },
    "utility-rail": {
      "$type": "dimension",
      "$value": { "value": 420, "unit": "px" }
    },
    "topbar": { "$type": "dimension", "$value": { "value": 48, "unit": "px" } },
    "command-bar": {
      "$type": "dimension",
      "$value": { "value": 88, "unit": "px" }
    },
    "status-bar": {
      "$type": "dimension",
      "$value": { "value": 40, "unit": "px" }
    },
    "settings-form": {
      "$type": "dimension",
      "$value": { "value": 800, "unit": "px" }
    },
    "composer-min": {
      "$type": "dimension",
      "$value": { "value": 56, "unit": "px" }
    },
    "composer-rest-max": {
      "$type": "dimension",
      "$value": { "value": 88, "unit": "px" }
    },
    "composer-shell": {
      "$type": "dimension",
      "$value": { "value": 72, "unit": "px" }
    },
    "composer-max": {
      "$type": "dimension",
      "$value": { "value": 160, "unit": "px" }
    },
    "composer-expanded-max": {
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
  },
  "component": {
    "button": {
      "height": { "$type": "dimension", "$value": "{control.target}" },
      "height-primary": {
        "$type": "dimension",
        "$value": "{control.target-primary}"
      },
      "radius": { "$type": "dimension", "$value": "{radius.sm}" }
    },
    "composer": {
      "radius": { "$type": "dimension", "$value": "{radius.lg}" },
      "shadow": { "$type": "string", "$value": "{shadow.raised}" }
    },
    "disclosure": {
      "row-height": {
        "$type": "dimension",
        "$value": { "value": 32, "unit": "px" }
      },
      "radius": { "$type": "dimension", "$value": "{radius.sm}" }
    },
    "inspector": {
      "width": { "$type": "dimension", "$value": "{layout.evidence-rail}" },
      "radius": { "$type": "dimension", "$value": "{radius.md}" }
    },
    "trajectory": {
      "row-height": {
        "$type": "dimension",
        "$value": { "value": 30, "unit": "px" }
      },
      "row-height-expanded": {
        "$type": "dimension",
        "$value": { "value": 44, "unit": "px" }
      },
      "preview-lines": { "$type": "number", "$value": 16 }
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
- 50 (color): #FBFAF7
- 100 (color): #F6F4F0
- 150 (color): #F0EEE9
- 200 (color): #E8E5DF
- 300 (color): #D7D3CB
- 400 (color): #AAA69E
- 500 (color): #858078
- 600 (color): #6F6A63
- 700 (color): #514D47
- 900 (color): #1F1E1B
```

```tokens color.brand
- 50 (color): #F3F1ED
- 400 (color): #77736C
- 500 (color): #5B5852
- 600 (color): #34332F
- 700 (color): #292824
- 800 (color): #1F1E1B
```

```tokens color.ink
- 100 (color): #EEECE7
- 300 (color): #625E57
- 700 (color): #4A4741
- 800 (color): #35332F
- 900 (color): #272622
- 950 (color): #1F1E1B
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

| Token                    | Light                 | Dark                  | Role                    | Required contrast        |
| ------------------------ | --------------------- | --------------------- | ----------------------- | ------------------------ |
| `--color-bg`             | `{color.neutral.50}`  | `{color.neutral.50}`  | Page canvas             | —                        |
| `--color-bg-subtle`      | `{color.neutral.100}` | `{color.neutral.100}` | Recessed canvas         | —                        |
| `--color-surface`        | `{color.neutral.0}`   | `{color.neutral.0}`   | Card and panel          | —                        |
| `--color-surface-raised` | `{color.neutral.50}`  | `{color.neutral.50}`  | Elevated surface        | —                        |
| `--color-fg`             | `{color.neutral.900}` | `{color.neutral.900}` | Primary text            | 4.5:1                    |
| `--color-fg-muted`       | `{color.neutral.700}` | `{color.neutral.700}` | Secondary text          | 4.5:1                    |
| `--color-fg-subtle`      | `{color.neutral.600}` | `{color.neutral.600}` | Help text               | 4.5:1                    |
| `--color-fg-on-accent`   | `{color.neutral.0}`   | `{color.neutral.0}`   | Primary-action text     | 4.5:1                    |
| `--color-border`         | `{color.neutral.300}` | `{color.neutral.300}` | Decorative border       | advisory                 |
| `--color-border-subtle`  | `{color.neutral.200}` | `{color.neutral.200}` | Divider                 | —                        |
| `--color-border-strong`  | `{color.neutral.500}` | `{color.neutral.500}` | Sole control boundary   | 3:1                      |
| `--color-accent`         | `{color.brand.600}`   | `{color.brand.600}`   | Primary action and link | 4.5:1 on action          |
| `--color-accent-hover`   | `{color.brand.700}`   | `{color.brand.700}`   | Hover                   | —                        |
| `--color-accent-subtle`  | `{color.brand.50}`    | `{color.brand.50}`    | Selected surface        | —                        |
| `--color-focus-ring`     | `{color.brand.500}`   | `{color.brand.500}`   | Focus and indicator     | 3:1                      |
| `--color-success`        | `{color.success.700}` | `{color.success.700}` | Success                 | 4.5:1 on surface         |
| `--color-warning`        | `{color.warning.700}` | `{color.warning.700}` | Running/waiting/warning | 4.5:1 on warning surface |
| `--color-danger`         | `{color.danger.700}`  | `{color.danger.700}`  | Failure and destructive | 4.5:1 with white         |

### 2.4 Contrast and color boundaries

- White on primary `#34332F` is greater than 12:1.
- Default text `#1F1E1B` on white is greater than 16:1.
- Muted text `#514D47` on white is greater than 8:1.
- Focus `#5B5852` against white exceeds 6:1.
- Decorative `#AAA69E` and `#D7D3CB` never carry text or sole control boundaries.
- Trajectory input/model/tool pairs pass 4.5:1 and are allowlisted only inside
  Running Trajectory, its legend, filters, and this design-system showcase.

## 3. Typography

Generated variables include `--font-sans`, `--font-mono`, `--text-xs`,
`--text-sm`, `--text-base`, `--text-lg`, `--text-xl`, `--text-2xl`,
`--text-3xl`, and `--text-4xl`.

- Product page: 22/29, section: 16/23, compact heading: 15/22.
- 30px and above is reserved for onboarding or an intentionally sparse empty state.
- Conversation/body: 15px with 1.7 line-height.
- Compact body: 14px; control: 13px; help: 12px.
- UI and trajectory annotations use 12px as the minimum size.
- Sans is used for UI and Chinese prose. Mono is restricted to code, paths,
  model IDs, hashes, and other technical data.

## 4. Spacing

The 4/8px rhythm is expressed as `space`, `inset`, `stack`, and `inline`
tokens. Components use role aliases such as `--inset-md`, never raw spacing
values. Use logical properties (`padding-inline`, `margin-inline-start`) for
i18n-safe layout.

## 5. Radius

Only 6, 10, 14, and 18px are available for controls and surfaces as
`--radius-sm`, `--radius-md`, `--radius-lg`, and `--radius-xl`.
`--radius-full` is 999px and is restricted to short status badges and compact
chips. It is never used for panels, text fields, or ordinary buttons.

## 6. Elevation

Only `--shadow-none`, `--shadow-raised`, and `--shadow-modal` are available.
Raised is restricted to the composer, popovers, and drag state. Dialog and
Drawer may use modal. Ordinary cards and panels use spacing and borders instead
of elevation.

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

Conversation disclosures fade their evidence in over `--duration-base`;
chevrons rotate over `--duration-fast`. The artifact inspector may fade its
content when the selected view changes, but its frame and conversation column
must not translate or resize. Refresh retains the current view and announces
busy state without introducing a blocking overlay.

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

## 9. Layout

- Sidebar: 252px default, 232px to 272px adjustable, and 56px compact.
- Center column: 640px hard floor.
- Reading axis: 760px target and 820px maximum.
- Artifact inspector: 760px target and 820px maximum on wide screens. It may
  compress to 360px only to preserve the 640px center-column floor; below
  1280px it overlays the conversation instead of shrinking that floor.
- The inspector toolbar exposes Preview and Source for every text file, Changes
  when a recorded diff is available, plus refresh, download, and close. HTML
  preview remains sandboxed with scripts only; Source is always inert text.
- Utility drawers and compact evidence surfaces remain 420px.
- Top bar: 48px. Task status: 40px and absent when it adds no new information.
- Composer: 56px minimum, up to 88px at rest, 160px in normal editing, and
  240px only in an explicit expanded editor.
- Desktop controls are at least 32px and primary actions at least 40px.
- Validate product baselines at 1280×900, 1440×900, and 1920×1080.
- Validate pressure cases at 1280×720, 720×900, 390×844, and 320×900.

Page shells use desktop viewport queries where needed. Reusable components use
container queries or intrinsic `minmax()`/`clamp()` layout. No document-level
horizontal overflow is permitted.

The layout concession order is deterministic:

1. Preserve the 640px center floor.
2. Shrink Evidence to 320px.
3. Auto-close Evidence while keeping an explicit reopen control.
4. Collapse Sidebar to 56px.
5. Below 720px, move Sidebar and Evidence into modal sheets.

Tables, timelines, code, terminal output, and diffs may scroll horizontally
inside their own bounded surfaces. Ordinary text, navigation, forms, and the
application shell may not.

### 9.1 Arena workbench shell tokens

The shell uses a warm-white navigator, a white conversation canvas, and an
optional bordered evidence inspector. The familiar token names remain available
through the v2.0 migration so existing Task and Trajectory surfaces can adopt the
new system without a flag day:

- `--color-navigation-bg`, `--color-navigation-surface`,
  `--color-navigation-surface-hover`, `--color-navigation-border`,
  `--color-navigation-fg`, and `--color-navigation-fg-muted` now describe the
  persistent warm-white project navigator.
- `--color-execution-spine` and `--color-execution-spine-subtle` express causal
  continuity in legacy Task and Trajectory surfaces. Conversation renders this
  continuity as quiet disclosure rows rather than a visible blue rail.
- `--color-canvas` is the main workspace background; `--color-paper` is the
  bounded reading surface inside it.
- `--layout-command-bar` (88px) separates identity and run controls from the
  view navigation row. `--layout-composer-shell` (72px) is the composer at rest.
  `--layout-execution-gutter` (40px) is the shared spine gutter.

## 10. Agent Prompt Guide

Before editing UI, read this file and the generated token file. New or
materially rewritten components must:

- reference semantic/component variables only;
- export their Props interface;
- stay at or below 300 LOC, 80 LOC per function, JSX depth 6, and 10 hooks;
- implement applicable interaction states, keyboard semantics, `focus-visible`,
  forced colors, and reduced motion;
- keep user-visible copy in the i18n layer;
- validate at the three product baselines and four pressure cases;
- preserve reflow at 320 CSS px without claiming a full mobile product.

Any new primitive, semantic role, trajectory allowlist entry, or target visual
baseline requires an explicit reviewed change to this contract.

## 11. Versioning and Migration

- Major versions may change brand or interaction principles.
- Minor versions may change token structure, layout policy, and component rules.
- Patch versions may correct prose or non-behavioral metadata.
- Deprecated tokens remain generated for one release cycle unless retaining them
  creates an accessibility or security defect.
- Every minor or major change includes an old-to-new token map and regenerates
  `apps/web/src/styles/tokens.css`.
- Feature CSS may consume semantic, layout, control, and component variables.
  Primitive color values remain unavailable outside this source file.

### 11.1 v1.1 to v2.0 map

| v1.1 role                         | v2.0 role                         | Migration                                                                                                                           |
| --------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Blue primary action and focus     | Deep ink primary action and focus | Existing `--color-accent*` names resolve to the new ink values.                                                                     |
| Dark persistent navigator         | Warm-white persistent navigator   | Existing `--color-navigation-*` names resolve to light surfaces and dark text.                                                      |
| Blue conversation execution spine | Neutral disclosure rows           | Keep spine tokens for Task and Trajectory; new conversation CSS removes the visual rail.                                            |
| 240px navigator                   | 252px navigator                   | Existing `--layout-sidebar-*` names adopt the new bounds.                                                                           |
| 340px evidence rail               | 760px artifact inspector          | `--layout-evidence-rail*` and `--component-inspector-width` now define a wide preview; compact drawers use `--layout-utility-rail`. |
| 800–880px reading axis            | 760–820px reading axis            | Existing `--layout-reading-*` names narrow the central document flow.                                                               |

### 11.2 v2.0 to v2.1 map

| v2.0 behavior                    | v2.1 behavior                       | Migration                                                                                                 |
| -------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Inspector mode fixed at open     | In-place Preview / Source / Changes | The inspector owns view selection and refreshes through existing artifact preview APIs.                   |
| Tool rows expose two title lines | One compact activity phrase         | Preserve full evidence inside the disclosure; keep failed and blocked rows expanded for immediate review. |
