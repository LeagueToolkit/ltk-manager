# ADR-0077: One dispatcher runs every in-app key

- **Status:** Accepted (2026-11-03)
- **Date:** 2026-11-03
- **Crates:** none. The change is in `src/modules/keys`
- **Related:** "Keys" in `docs/ux/KEYS.md`, #969

## Context and problem statement

About 150 key handlers sat across the frontend in three forms: `useHotkeys` calls of
`react-hotkeys-hook`, `keydown` listeners on the window, and `onKeyDown` props. Seven local tables
named keys, each in its own spelling: the audio keymap, `VFX_KEYS`, `SKIN_KEYS`, `MAP_KEYS`, the
atlas canvas, preview and sprite keys, and the tree collapse key. Menus and the palette wrote key
labels as text beside the handler that bound the key. Nothing could list every key, and a
collision showed up only when two handlers ran on one press.

## Considered options

- Keep `react-hotkeys-hook` and use its scopes
- One registry and one dispatcher of the app's own

## Decision

**The registry lists every command, and its chords, scopes and guards.** It lives in
`src/modules/keys` and imports no other module, so every module can read it.

**One `keydown` listener runs a press through the active scopes, narrowest first.** A component
makes a scope active with `useKeys`. The first command on the chord whose guards hold and whose
instance has a handler takes the press. A widget that answers its own keys in `onKeyDown` resolves
them through the registry and stops the press.

**A unit test fails on two commands that one press could reach, and on a reserved chord.** A
narrower scope takes a wider command's chord only when it says so in `shadows`.

`react-hotkeys-hook` is removed. Its scopes are flat on and off sets with no order between them,
and it matches the physical key, which puts `Ctrl+Z` on another letter of an AZERTY keyboard.

## Consequences

- The Projects palette moves from `Ctrl+R` to `Ctrl+Shift+O`, because `Ctrl+R` reloads the webview.
- The audio document and the object tabs lose their own key sheets to the one shortcut sheet.
- The explorer's `Ctrl+1` to `Ctrl+3` stop at the explorer, where they also navigated the app.
- The details document saves once on `Ctrl+S`, where a window listener saved it a second time.
- User rebinding can apply overrides to the registry's chords. It is not part of this change.
