# Design tokens - `src/styles/`

Rules for **authoring the stylesheets**. How to _consume_ tokens from a component
lives in `src/CLAUDE.md`, which loads for all frontend work. This file loads only when
you are in here.

## What each file owns

| File             | Owns                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `global.css`     | Every value: palette, brand pair, state colours, surfaces, scales, glass tiers, gradients                                  |
| `tailwind.css`   | Nothing of its own - the entry point, the font imports, and a `@theme` block aliasing `global.css` into Tailwind utilities |
| `animations.css` | Keyframes and the stagger utility                                                                                          |

`tailwind.css` is the single CSS entry point, imported in `main.tsx`. Keep the section
banner comments in `global.css` and add to the right section rather than appending to
the end.

The theme is shared with the [LTK Wiki](https://github.com/LeagueToolkit/wiki) and the
LoL Meta Wiki. Their `custom.css` is what to diff against when the brand moves.

## Comments name their tokens and stop

A comment on a token group says _what the group is_, in one line:

```css
/* The logo colours. */
/* State colours, for components that derive their look from state. */
/* Colours for mod category pills. */
```

That is the whole budget. **Never write, in CSS:**

- **the values** - they are on the very next line
- **which components or pages consume a token** - that belongs in `src/CLAUDE.md`, and the
  list goes stale the moment a component changes
- **contrast measurements, or the reasoning behind a chosen value** - stale on the next tweak
- **what a token is _not_**, or how another project in the ecosystem does it differently

A comment earns more than one line only for a mechanical fact a reader cannot recover
from the code: declaration order a minifier would break, or which of two competing
blocks wins. `global.css` has exactly two of those. Match that bar.

If a rule feels worth writing next to a token, it belongs in `src/CLAUDE.md` instead.

## Adding a token

Numbered scales are the convention:

| Category   | Pattern            | Example                            |
| ---------- | ------------------ | ---------------------------------- |
| Spacing    | `--space-{NNN}`    | `--space-004` → 18px (NNN × 4.5px) |
| Radius     | `--radius-{NNN}`   | `--radius-003` → 6px               |
| Icon sizes | `--icon-{NNN}`     | `--icon-003` → 12px                |
| Shadows    | `--shadow-{name}`  | `--shadow-sm`, `--shadow-glass`    |
| Z-index    | `--z-{name}`       | `--z-modal`, `--z-toast`           |
| Duration   | `--duration-{NNN}` | `--duration-004` → 200ms           |
| Easing     | `--ease-{name}`    | `--ease-spring`                    |

A new token is defined in `global.css` and aliased in the `@theme` block, or Tailwind
cannot see it. Colour tokens carrying an LTK value are `--ltk-*`, and the app's own scales
are unprefixed (`--surface-*`, `--accent-*`).

**No `@apply`.** Reference the custom properties directly:
`background-color: var(--surface-900)`.

## Theme mechanics

Dark is the bare `:root`. Light overrides land in a `[data-theme="light"]` block, set by
`useTheme`. A colour that flips is defined once and aliased - never as a pair of literals
in two places. Rung numbers encode **role, not luminance**, so both scales invert
wholesale between the themes.

Elevation is dark-first: `--shadow-*` carries depths tuned for the dark theme and the
light block softens them, because those depths read as smudges on a near-white surface.

Density is `[data-density]` on `<html>` and may only touch `--space-*` and `--icon-*` -
never `--radius-*`, `--shadow-*`, `--z-*`, or colours.

## The accent ramp has two sources

`--accent-{50..900}` is fed either by the literal `:root[data-accent="ltk"]` block or by
the `hsl(var(--accent-hue) …)` ramp, and the literal block wins when the attribute is
set. The brand ramp is spelled out rather than generated because its light end drifts
toward cyan, which a single-hue ramp cannot reach. Keep both in step when adding a rung.

## Frosted surfaces

Take the fill and the blur from the same `--ltk-glass-*` tier: `chrome` for the titlebar
and session bar, `panel` for floating UI, `scrim` for chips over imagery. A thin fill
needs an `@supports` guard and a solid fallback.

Keep `-webkit-backdrop-filter` **before** the standard property. The minifier collapses
the pair into whichever comes last, and Chromium never aliased the prefixed form, so a
bundle keeping only one of them ships no blur to either WebView2 or the macOS WKWebView.
Tailwind's `backdrop-blur-*` utilities already emit both.

## Deliberately absent

The wiki's brand-gradient row washes (`--ltk-nav-hover` / `--ltk-nav-current`) are not
ported. They fade to transparent across the row, which needs a full-width sidebar row to
resolve. Every nav surface here is a narrow horizontal tab, where the fade cuts off
mid-ramp at the trailing edge. Nav hover is a flat surface fill - see the `ghost` Button
variant.
