# ADR-0036: A shell's panes are its layout's own

- **Status:** Accepted (2026-09-10)
- **Date:** 2026-09-10
- **Crates:** none. A pane is frontend, and Rust knows no frame
- **Related:** Amends [ADR-0034](0034-the-shells-panes-are-the-editors-split-tree.md), whose one
  tree per project held the particle system's four panes, and
  [ADR-0031](0031-a-layout-declares-the-frame-it-draws-in.md), where the particle system was the
  one layout with a shell. [ADR-0035](0035-a-skinned-preview-is-a-skinned-mesh-posed-by-a-baked-clip.md),
  whose character the skin's shell centres. The rule is stated in "The shell" in
  `docs/ux/BIN_EDITOR.md`.

## Context and problem statement

The skin layout drew its preview as a small square inside the Mesh section, beside the fields, so
the posed character was the smallest thing on screen, although it is what a reader of a skin is
looking at. The shell of ADR-0031 already puts a preview pane beside an inspector, but its panes
are the particle system's four, and ADR-0034 gives every project one tree of them. A skin has no
emitters and no curve, so a second layout declaring that shell would inherit panes it cannot fill.

The open question was whether a skin grows a frame of its own, or the shell grows a way to hold a
different set of panes.

## Decision

**A layout names the shell it draws in, and the shell names its panes.** `shell: "vfx"` holds the
emitter strip, the curve, the inspector and the preview. `shell: "skin"` holds the preview and the
inspector, the preview first and the wider of the two. A layout that names no shell stacks as
before, and `frame` is read off the shell rather than declared beside it.

**Each shell's tree is its own, per project.** The particle system's arrangement and the skin's
are two trees under `shells` in `.ltk/editor.json`, and a reset puts one back without touching the
other. A file written with the lone `shellLayout` reads it back as the particle system's.

**Below the width a shell needs, the preview stands above the stack.** A narrow pane keeps the
character on screen in the box a pane would give it, and the sections scroll under it.

**The curve docks wherever the shell holds no curve pane**, so a curve aimed from a skin still has
a surface to draw on.

## Consequences

- **Positive:** the character is the largest thing in a skin's view, with its transport under it,
  and the sections are one glance to the side.
- **Positive:** a third shelled layout is a pane set and a default tree. The tree ops, the drag and
  the Panes menu are unchanged.
- **Negative:** `.ltk/editor.json` gains a field an older build ignores, so an older build
  reopening the project puts the particle system's panes back where they ship.
- **Negative:** every shell action takes the kind of shell it acts on, and every caller names it.
- **Neutral:** the skin shell's top row holds the Panes menu alone, since a skin has no emitter to
  aim an inspector at.
