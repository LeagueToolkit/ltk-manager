# ADR-0031: A layout declares the frame it draws in

- **Status:** Accepted (2026-09-07)
- **Date:** 2026-09-07
- **Crates:** none. A frame is frontend, and Rust knows no class
- **Related:** Amends [ADR-0030](0030-a-class-view-is-a-layout-over-the-rows.md), which draws
  every class view as a stack of sections. [ADR-0028](0028-an-object-is-a-document-of-its-own.md),
  whose object tab a frame fills. [ADR-0023](0023-a-setting-id-and-a-ui-path-are-two-id-spaces.md)
  and [ADR-0024](0024-a-setting-id-is-its-key-in-settings-json.md), whose id space the remembered
  pane sizes join. The rule is stated in "The shell" in `docs/ux/BIN_EDITOR.md`. The evidence is
  `docs/research/bin-editor-curve-panel.md` and one screenshot of RiotEditor.

## Context and problem statement

ADR-0030 draws every class view as a stack of sections in one scrolling column. That holds for a
material and for a skin, which a modder opens to read. A particle system is not read, it is
tuned: a change to one emitter's `rate` is judged against that emitter's curve, its other fields,
and once a renderer exists against the particles themselves. Riot's own editor puts those four
things on screen at once, as an emitter strip, a properties inspector, a graph editor and a
preview viewport. A scrolling column holds two of them in view at best, and which two depends on
where the reader last scrolled.

EPIC #455 then decided that a curve draws in a dock under the object tab. In a stack that dock is
the bottom of the column. In a tuning loop it has to stay visible while the inspector is used,
which a column cannot promise.

The open question was whether the object tab grows a second way to arrange a view, and if it
does, how one class asks for it without every other class paying for it.

## Decision

**A layout declares the frame it draws in, and the frame is the stack unless it says otherwise.**
`frame: "shell"` on the layout is the whole declaration, so the registry stays the one place a
class's view is described and a second class wanting a shell is a one-word change.
`VfxSystemDefinitionData` declares it. Every other layout omits it and stacks as before.

**The shell is two columns over a breadcrumb.** The left column holds the emitter strip over the
curve pane. The right holds the inspector over the preview pane. The breadcrumb names system,
emitter and group, and each of its three segments is a target the inspector draws: the system's
own sections, every group of one emitter, or one group.

**The system's sections are the inspector's root.** Identity, Audio and Other are what the
inspector shows when the breadcrumb's first segment is the target. There is one place a value is
read, and the strip keeps the width above it.

**Table mode takes the shell's whole width** and folds the inspector away, because thirteen
columns down sixty emitters is a reading that answers without an inspector beside it.

**Below the width the shell needs, the same layout draws as the stack.** The shell wants about
900px to hold a strip, an inspector and a curve without any of them being useless, and the object
pane is about 1150px with both sidebars open. The stack is the default, the fallback, and not
legacy.

**The curve surface has two hosts.** In a stack and in Properties it is the dock EPIC #455
decided, absent until a mark targets it. In a shell it is a pane that holds its place and draws a
muted line until targeted, because a pane that appears on a click moves every pane around it.

**Pane sizes are the reader's, remembered on the class hash** across tabs and sessions. The
proportions belong to the kind of work rather than to the file.

## Consequences

- **Positive:** nothing built for the stack is discarded. It is the default frame, the narrow
  fallback, and what every other class still uses.
- **Positive:** a frame is data, so the second class to want a shell costs one word and no new
  registry.
- **Positive:** the four things a VFX modder compares are on screen together, which is the whole
  reason the class has a view of its own.
- **Negative:** two frames to build, test and keep in step. A widget now has two places it can be
  drawn, and a section that assumed a column has to survive a pane.
- **Negative:** the curve surface has to work as a dock and as a pane, so the ticket that builds
  it builds both.
- **Negative:** pane sizes per class are new persisted state, and they join the settings id space
  rather than inventing one.
- **Neutral:** the preview pane ships empty. A WebGL particle renderer is its own ADR, and the
  pane is only the frame it will need.
- **Neutral:** a mark on the value a layer changed waits on bin layer overrides, which are
  Planned. The frame does not decide it.
