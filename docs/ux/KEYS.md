# Keys

Every in-app key of the manager is a command of one registry, and one dispatcher runs a press
through the scopes that are active for it. The OS-global hotkeys stay in the backend and take part
in the conflict check and the shortcut sheet. See
[ADR-0077](../adr/0077-one-dispatcher-runs-every-in-app-key.md).

## The registry

`src/modules/keys/utils/registry.ts` lists every command. A command has:

| Field     | What it holds                                                                        |
| --------- | ------------------------------------------------------------------------------------ |
| `id`      | `<area>.<name>`, such as `editor.save` or `audio.duplicate`                          |
| `title`   | The words of the command in the shortcut sheet, as a message                         |
| `group`   | The group of the sheet: General, Playback, Navigation, View, Tools, Editing, Pointer |
| `scopes`  | The scopes the command applies in                                                    |
| `keys`    | The chords that run it. The first is the one a menu, a tooltip or the palette shows  |
| `when`    | The guards that must hold for a press to run it                                      |
| `shadows` | The commands of a wider scope whose chords it takes on purpose                       |
| `gesture` | Lists a command without a chord in the sheet, such as a drag or the type-ahead       |

The tables are grouped by area in `src/modules/keys/utils/commands/`. The module that owns an
action registers its handler at runtime, so the registry holds no behaviour.

A chord is canonical text: `Ctrl`, `Alt` and `Shift` in that order, then the key, joined by `+`.
Meta reads as Ctrl. A digit reads from the physical key, so `Alt+1` holds on a layout that types
`&` there. A Latin letter reads from the character, so `Ctrl+Z` is the key printed Z on any Latin
layout. A letter of another script reads from the physical key. A symbol drops Shift, because the
layout already folds Shift into it: `?` is Shift and `/` on a US keyboard.

Every menu item, palette row, tooltip and hint that shows a key reads it from the registry through
`shortcutOf`. A widget that answers its own keys in its `onKeyDown` matches the press through
`isChord` or `commandAt`, so its key and the key it shows are one entry.

## Scopes

The scopes form one tree:

```
app
|-- library
|-- workshop
    |-- focus:projects
    |-- project
        |-- editor
            |-- focus:tree
            |   |-- focus:content
            |   |-- focus:outline
            |-- focus:explorer
            |-- focus:objects
            |-- focus:knob
            |-- focus:audio.lines
            |-- focus:vfx.curve
            |-- document:audio
            |   |-- focus:audio.media
            |   |-- focus:audio.events
            |-- document:vfx
            |   |-- focus:vfx.timeline
            |   |-- focus:vfx.graph
            |-- document:skin
            |-- document:map
            |-- document:atlas
                |-- focus:atlas.canvas
                |-- focus:atlas.layers
                |-- focus:atlas.sprites
```

A mounted component makes a scope active with `useKeys(scope, handlers, options)`. An instance
without a `ref` answers presses from the whole page. An instance with a `ref` answers presses from
inside that element alone. `enabled: false` keeps it mounted and silent, which is how only the
focused editor group answers the editor's keys.

## The dispatcher

One `keydown` listener on the document runs every press. It reads the chord, then walks the
active instances narrowest first: the deeper scope, then the element that lies inside the other,
then the newer mount. The first command on the chord whose guards hold and whose instance has a
handler runs, and the press stops there with its default action prevented. A handler that returns
`false` declines the press, which goes on to a wider scope and keeps its default action. The
editor's undo does this when the document takes no step, so a text field keeps its own undo.

A widget's own `onKeyDown` runs before the dispatcher, because React answers at its root and the
dispatcher listens on the document. A widget that answers a key and stops it keeps that key from
every wider scope. That is the rule that keeps Ctrl+D in the audio event tree away from
Diagnostics.

### Guards

| Guard          | Holds when                                                                      |
| -------------- | ------------------------------------------------------------------------------- |
| `typing`       | The target takes typed text: a field, a text area, a combobox, editable content |
| `overlay`      | A dialog or a menu is open, or the palette has the caret                        |
| `keyedControl` | The target uses the key itself: a tab, a menu item, an option, a slider's keys  |
| `project`      | A project is open                                                               |
| `dev`          | The build is a development build                                                |

A guard with `!` must not hold.

## Conflicts

A unit test over the registry fails when one press could reach two commands: the same chord on
two scopes that lie on one path of the tree, unless their guards exclude each other or the
narrower one lists the wider one in `shadows`. A command of a scope under `project` holds the
`project` guard by being active, so `app.diagnostics`, which requires `!project`, shares Ctrl+D
with every editor's Duplicate.

### Reserved chords

No command takes a chord that the webview, the window or the devtools answer:

| Chord                          | Owner          |
| ------------------------------ | -------------- |
| `Ctrl+Shift+I`, `F12`          | Devtools       |
| `Alt+F4`                       | The window     |
| `F5`, `Ctrl+R`, `Ctrl+Shift+R` | Webview reload |

The capture in Settings > Hotkeys refuses an OS-global hotkey on a chord that a command takes,
because the system would hand that chord to the hotkey while the app has focus.

## The shortcut sheet

`?` and F1 open the sheet outside a text field, and so does Keys and gestures in the View menu of
an object tab or an audio document. The sheet lists every command with a chord and every gesture,
by section and then by group. The sections of the scopes that were active when it opened come
first, narrowest first, and the others follow. The OS-global hotkeys that are set close the sheet
under System.
