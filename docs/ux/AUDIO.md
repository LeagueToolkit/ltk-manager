# Audio

The audio support of the workshop: how a Wwise package, bank or WEM opens, what its document
shows, and how its media play. The terms are the ones of the "Audio" section of `GLOSSARY.md`
and of `ltk_wwise`.

## Changes

| Date       | Change                                        |
| ---------- | --------------------------------------------- |
| 2026-10-30 | Fold the toolbar into a menu bar              |
| 2026-10-30 | Merge Voices and Structure into one tree      |
| 2026-10-30 | Add one keymap, drags, drops and type-ahead   |
| 2026-10-30 | Replace the context badge with Played by      |
| 2026-10-30 | Group voices under headers, add the inspector |
| 2026-10-30 | Replace media, follow units, use events       |
| 2026-10-30 | Add derived node names                        |
| 2026-10-30 | Add new objects and selection                 |
| 2026-10-30 | Replace the document head with a toolbar      |
| 2026-10-30 | Add the Voices view                           |

Each edit of this document adds a row at the top. The table keeps the last ten rows.

## The audio file document

A `.wpk`, a `.bnk` or a `.wem` opens into the audio file document, from a project layer and
from the game browser alike. A chunk without a name opens into it when its magic is a package,
a bank or a RIFF `WAVE` file.

The document draws its controls in one row, the toolbar row of its editor group, and its content
under it. The tab shows the file name. The row contains, from the left:

```
File  Edit  Insert  View  Playback  Bank  EXPERIMENTAL   [Media|Events] [Filter events...] 45 events
```

- The menu bar, per "Menu bar". The Experimental chip follows the titles in a bank that takes
  edits, per "New objects".
- The Media and Events switch of a bank with a hierarchy. Events is the view that opens in a bank
  without media. A file without a hierarchy shows the media table alone.
- The tools of the open view: the filter and the count of events or media. In the Events view the
  count reads the picked rows when more than one is picked, per "Selection". The count is hidden
  in a narrow group. The name entry of New event opens after the count
  while they are in use.

Bank details opens a popover under the row with the `BKHD` facts of a bank: its version, bank
type, alignment, header ID and the ID of its file name where it has one, then its size and its
media count. A package or a WEM shows File details: its kind, size and media count.

Under the row, a notice band shows what needs action:

- A file that does not read shows the reader's error in a danger notice. The error names the
  offset where the reader knows one.
- A bank that the client rejects shows the reason in a warning notice, in the words of
  `Bank::check`.
- A bank whose header ID differs from the bank ID of its file name shows both IDs in an info
  notice. It is information and not a warning, because the client registers a bank under the
  ID of its file name and never reads the header ID (rule W3 of `ltk_wwise`). A game chunk has
  no file name, so it shows no such notice.
- While the audio index of the game builds, the Media view of a bank or a package shows an info
  notice. The Events view shows its own, per "Names".

### Menu bar

The menu bar is the shared `Menubar` of `src/components`, built on the Base UI menubar. Each item
names a command of the keymap (`AUDIO_MENU_SPEC` in `utils/audioMenus.ts`), so an item shows the
glyph, the words and the key that the palette and the sheet show, and it is enabled while the
command applies. A command of a surface that the file does not have is left out: a file without a
hierarchy lists no Insert or Bank items of the event tree, and no Save, Undo or Redo.

| Menu     | Items                                                                                                                 |
| -------- | --------------------------------------------------------------------------------------------------------------------- |
| File     | Save. Copy into the layer, Extract and Save a copy, as the tab offers them. Bank or File details                      |
| Edit     | Undo, Redo. Duplicate, Wrap in container, Cut, Paste into container, Delete. Copy ID. Rename, Reset field. Select all |
| Insert   | New event, Add child... New sound, Container (random, sequence or switch), Import .wem...                             |
| View     | Media and Events as a choice, Inspector as a switch. Expand all, Collapse all. Focus filter, Keys and gestures        |
| Playback | Play or stop, Play event, Stop all. Loop as a switch. Volume up, Volume down, and the preview volume                  |
| Bank     | The bank units, per "Bank units", and Find references. Replace media from file...                                     |
| Voice    | Only in the Voice lines view, per docs/ux/CONTEXTUAL_VOICE.md                                                         |

Edit lists Move up and Move down only in the Voice lines view, because the event tree moves a
row by its keys alone.

A disabled item shows its reason under its words where the reader cannot see it: a command of the
event tree in the Media view reads "Applies in the Events view", an edit of a bank that takes no
edits names the bank's version, and a command that waits for a pick names the pick. Expand all
opens at most 200 events, because each open event reads its tree.

The bar follows the WAI-ARIA menubar pattern. Alt alone or F10 moves focus to the first title from
anywhere in the document, and the same key moves it back. Left and Right move between the titles,
Down opens a menu, a letter moves to the title or the item that starts with it, and Escape closes
the menu and then returns focus to where it was. While a menu is open, a hover on another title
opens that one. A chosen item returns focus to where it was before the bar took it, so a command
of the tree acts on the tree's pick.

In a narrow group the titles move, from Bank backwards, into one overflow menu before the filter
narrows. The filter keeps a width of 14rem until every title is in the overflow menu, and then
narrows to 8rem and no further.

## Bank units

The Bank menu of a bank or a package lists the `BankUnit` objects that name the opened file in
their `bankPath`, such as `Rumble_Base_SFX`. The units come from the bins of the open project and
then from the audio index of the game. An event bank, a media bank and a package each have the
menu, so any file of a unit reaches the others.

The menu holds one group per unit. A unit that several bins declare with the same
name, the same paths and the same voice-over flag is one group. A base voice-over bank that every
skin bin of a champion declares is one group with a list of bins, not one group per bin. A file
that two units name has two groups.

A group contains:

- The unit's `name` as its label, followed by Voice-over if `voiceOver` is set.
- Each `bankPath` file as an item with its kind: event bank, media bank or package. The opened
  file is marked and disabled. A found file opens its document. A file that no layer and no game
  archive contains is disabled.
- A submenu with the bins that declare the unit. An item opens the object and reveals the
  `BankUnit` row.

The declarations are ranked: the project's bins first, then the skin bin whose number matches
the `Skins/SkinNN` segment of the opened path (`Base` is skin 0), then `skins/root.bin`, then the
rest in the order of the index. A declaration whose holder links a `ContextualActionData` object
also has an Open contextual actions item under it, which opens that object.

`SpellDataResource.AudioBankPaths` and `ClientStateAudioDataProperties.BankPaths` name banks
without a unit, a name or events. The bins that list the opened file in one of them follow the
units in a submenu, each an item that opens the list row.

The menu reads before the audio index of the game is ready. It lists the project's units, says
that the index builds, and fills in when the build finishes. A loose file outside a project names
itself by its file name, so no unit names it. The items need a project, which owns the editor
tabs. Outside one, they are disabled. Inside a project, Find references follows the units and
opens the References document on the game path that the bank units name the file by.

## Media table

One row per media, by source ID. A package lists its entries in file order, a bank its media
index in ascending source ID order, and a WEM is one row of source ID 0.

| Column    | Shows                                                                     |
| --------- | ------------------------------------------------------------------------- |
| (play)    | The play or stop button of the row                                        |
| Source ID | The ID in decimal, in the mono font                                       |
| Codec     | Vorbis, PCM, ADPCM or Opus, or the `wFormatTag` in hex                    |
| Ch        | The channel count                                                         |
| Rate      | The sample rate in samples per second                                     |
| Duration  | `m:ss.cc`, from the `data` size and the byte rate. An estimate for Vorbis |
| Size      | The bytes the media takes in the file, in binary units                    |
| Waveform  | The shape of the media, per "Waveform column"                             |

Listing a file reads the `fmt ` chunk of each media and decodes no audio, so a package of
thousands of media lists at once. The table is windowed.

A media whose codec has no decoder, or whose header does not read, stays in the table with its
codec and a disabled play button. The button's tooltip gives the reason. A media that fails to
play takes the same state.

The filter keeps the rows whose source ID contains its text. Source ID, Duration and Size sort.
A press on Duration or Size sorts largest first, a second press smallest first, and a third
returns the file order.

### One player

A document plays through one player. Playing a row stops the row that played before it, and
pressing the playing row stops it. The player stops when the file changes on disk and when
the document closes. The play state of the row is the pressed state of its button, and a live
region announces the source ID that plays.

The player plays every media at the preview volume, as its file holds it, with no property of a
bank. The preview volume starts at 0.2 on each start of the app, `-` and `=` move it by 0.05, and
the Playback menu shows it as a percent under Loop. Loop, or `Ctrl+L`, plays each media of a
press again from its start until it stops.
The webview applies none of the game mixer gain, so shipped media at full volume is much louder
than in a match. The player is a channel of the
app's one Web Audio player, which the event tree and every viewport share.

### Keyboard

The table is one tab stop. Focus selects the first row if no row is selected. Its keys are in
"Keys and gestures". The type-ahead of the table matches the source ID.

### Row actions

The context menu of a row contains Save as `.ogg` (`.wav` for PCM), Save as `.wem` and Copy source
ID. A save asks for its destination in the save dialog and writes through a temporary file.
`.ogg` and `.wav` write the decoded media, and `.wem` writes the bytes as the file contains them.

A layer file that changes on disk lists again, and its media play from the new bytes.

## Event tree

The Events view lists every event of the bank. A named event shows its name, and an event that
no name hashes to shows `#` and its decimal ID. Named events come first, by name, then the
unnamed ones, by ID. The filter keeps the events whose name or decimal ID contains its text, and
the events that reach a node whose name or ID contains it, per "Node names".

The Events view draws one tree. An expanded event lists its actions, a header for each container
and switch state under them, and its voices at the leaves, per "Rows". A voice is one sound that
an event can play. The names, the bank set, "What plays" and the row actions apply to every row.

### Names

An event takes its name from the first of:

1. The bins of the open project. They are read on every open, so an event that a project
   creates has its name without a rebuild.
2. The audio index of the game: every `BankUnit` `events` entry and every string of
   `SoundEventData.mSoundName`, the four sound fields of `VfxSystemDefinitionData`,
   `VfxEmitterAudio.SoundOnCreate` and `SoundPersistent`, and the strings of
   `UiComboBoxSoundEvents` and `UiElementGroupButtonSoundEvents`.
3. The contextual actions of the skins whose units name the bank. A skin's
   `mContextualActionData` links a `ContextualActionData` object, whose rules name voice-over
   events by a short name such as `cast3D`. For each tag of the skin's `tagEventList`, the name
   `Play_vo_<tag>_<name>` is composed, and `Play_vo_<tag>_<spell>_<name>` for a rule with a
   `ContextualConditionSpellName`, where `<spell>` is the last segment of the spell path. A
   composition whose ID is an event of the bank names that event.

The composition is observed in shipped data and not read from the client, so an event that a
rule plays carries the rule as an inferred context, which the Played by column of the event row
draws, per "Played by" in docs/ux/CONTEXTUAL_VOICE.md. If two tags compose two events of the bank
for one rule, both keep the rule, and the column's card says that the match is ambiguous.
`mRuleName` is not in the meta class, and the shipped rules carry it. The name composition is one
function, `compose_vo_names`, which the Voice lines view resolves its names with too.

The audio index is built on a background thread the first time an event bank opens, and again
when the game build changes. It is cached beside the game index cache. While it builds, the Events
view shows an info notice and lists the events with the names of the project alone. The list updates
when the build finishes. The index uses `events` as a name source only, never as a list of what
a bank contains, because the skin loader reads neither `BankUnit.name` nor `BankUnit.events`.

### Node names

A shipped bank names its events and no other object. Every other object shows a name that is
derived from the events of the bank and stored nowhere, then its decimal ID as a muted `#id`.

| Object    | Name                                                       | Example                 |
| --------- | ---------------------------------------------------------- | ----------------------- |
| Play      | The stem of its event and `Play`                           | `Death3D_cast / Play`   |
| Container | The stem of its events and its kind                        | `Death3D_cast / Random` |
| Sound     | The stem of its events and its slot                        | `Death3D_cast #2`       |
| Imported  | A sound whose media the document imported: the file's name | `my_cast`               |
| Media     | The name of the first sound that plays it, in the pickers  | `Death3D_cast #2`       |

The stem of an event is its name without the prefix of the verb, the category and the champion,
such as `Play_sfx_Rumble_`. The stem of a node is the stem of the named events whose Play actions
reach it, and for a node that several events reach, their longest common stem. A common stem that
cuts a `_` segment short falls back to the last whole segment. A slot counts the sounds of the
first named event that reaches the sound, in the order that the tree draws them, from 1. A node
that no named event reaches, or whose events share no stem of three or more characters, shows its
kind, such as `Random #500572873`. A switch group and a switch show their IDs.

The names are a function of the events and their trees, so an edit renames only what it moves: a
new or copied node takes its name from its new parent, and an undo returns the names before it. An
imported file names its media until the document closes. Copy and Copy object ID copy the ID. The
filter of the Events view and the filters of the pickers match a name and an ID.

### Bank set

The media of an event live in other files. The bank set of an opened event bank is the bank
first, then every file of every bank unit that names its path, from the project's bins and
then from the audio index. A voice-over unit reads its paths under the client's locale.

If no bank unit names the bank, the set falls back to the sibling convention: the same
directory, the stem with `_events` replaced by `_audio`, as a `.bnk` and a `.wpk`. An info
notice says so. A bank whose stem has no `_events` suffix is read alone. In a set that bank
units name, a file that no layer and no game archive contains is listed in a warning notice.

A project layer's copy of a file comes before the game's, as the client reads them.

### Rows

The tree draws these rows:

| Row           | Shows                                                                                 |
| ------------- | ------------------------------------------------------------------------------------- |
| Event         | The name, the action count, the status, and `Play +250 ms` for one Play action        |
| Action header | Play, the target, the delay and the voice count, for each Play of an event of several |
| Header        | A container or a switch state: its name, the voice count and its knobs                |
| Voice         | A sound: the play button, the name and the media, and its knobs                       |
| Action        | An action that plays no tree, such as Stop or SetSwitch: the class, target and delay  |
| Add           | `+ Add`, under a header that adds a child and at the end of an event                  |
| Empty         | No actions, under an event without an action                                          |

```
v Play_sfx_Rumble_BasicAttack_OnHit  2 actions  Play +0 ms
|-- v OnHit / Switch  4 voices  group #1153642577    (o) 0.0 dB
|   |-- v default · Random by weight  2 voices       (o) 0.0 dB   (o) 0 cents
|   |   |-- > OnHit #1  #3125548773  audio.bnk       (o) 0.0 dB   (o) 0 cents  (o) 50  50%
|   |   |-- > OnHit #2  #3125548774  audio.bnk       (o) 0.0 dB   (o) 0 cents  (o) 50  50%
|   |   |-- + Add
|   |-- > #2 · Random  2 voices
|-- Stop  OnHit / Random #500572873  +200 ms
|-- + Add
v Play_sfx_Rumble_Death3D_cast  1 action  Play +250 ms
|-- > Death3D_cast #1  #546979792  audio.bnk         (o) -3.0 dB
|-- + Add
```

The node of the one Play action of an event is listed under the event, and the event row names
the Play and its delay. An event of several Play actions has one action header per Play, and the
node of each Play is listed under its header. Every other action is an action row, in the order
that the client runs the actions. An event's tree is read when the event expands or plays, so a
bank of hundreds of events lists at once.

| Status         | Tone    | When                                                        |
| -------------- | ------- | ----------------------------------------------------------- |
| Media missing  | Warning | A sound names a media that no file of the set contains      |
| Object missing | Warning | An action or a target names an object that no bank contains |
| Decode error   | Error   | An object does not decode. The row gives its ID and error   |

### Group headers

A header row has the shape and the value columns of a voice row: the caret, the play button, the
name, the voice count, and the knobs of its container. A header's knobs edit the container's own
fields. A header shows `volume` and `pitch`, the `weight` if the pick of its parent reads weights,
and `delay`, LPF and HPF if they are not 0. A press on the play button plays what the header
plays.

| Container          | Name on the header                                          |
| ------------------ | ----------------------------------------------------------- |
| Random container   | Random by weight if its pick reads the weights, else Random |
| Sequence container | Sequence                                                    |
| Switch container   | Switch, then its switch group as `group #id`                |
| Layer container    | Layer                                                       |
| Actor-mixer        | Actor-mixer                                                 |

- Every container is a header, nested as deep as the bank holds it. A container whose derived
  name has a stem draws the stem before its name, unless the header above it, or else the event,
  has the same stem. The tooltip of the name gives the name and the ID of the container.
- A container other than a switch whose only child is a container has a compact header: its name
  is muted and it shows no voice count. Its child is the header below it.
- A switch container lists one header per switch state. The default state comes first and is
  open, and is named `default`, or `first child` for a switch without a default switch. Each
  other child is a state of its own, named `#n` after its place among the children, and starts
  folded. No table names a switch, so a state is named by its place. A state of one container is
  the header of that container, named after both, such as `default · Random`, with the
  container's knobs. A state of sounds is named alone and has no knobs.
- An action header names Play, the target and the delay of its action.
- A random container lists its children in playlist order, and every other container in file
  order.
- Left folds a header on its name cell and Right opens a folded one. A fold is kept while the
  document is open.

### Lanes

The rows of the tree draw bracket lanes in place of plain guides. A lane runs from below a
header's caret down the rows of the header, and on the last row it stops at the row's middle and
turns toward the row. Nested headers draw nested lanes. The lane of the selected row's header
takes the accent. While the pointer is over a row, the lane of its header lifts a rung from the
header down to that row. The bin tree keeps its plain guides.

### Voice rows

| Cell     | Shows                                                                       |
| -------- | --------------------------------------------------------------------------- |
| (play)   | The play button of the voice                                                |
| Media    | The sound's name and ID, the file that contains the media                   |
| `volume` | The knob and the value in dB                                                |
| `pitch`  | The knob and the value in cents                                             |
| `weight` | The knob, the weight and its share, if the pick of the parent reads weights |
| `delay`  | The value in seconds, if it is not 0                                        |
| LPF, HPF | A smaller knob and the value in %, if it is not 0                           |

The cells of the headers, the voices and the actions of one event line up. A column that one row
of the event shows is drawn on every row of the event, and it stays empty on a row without that
value.

A sound whose media is missing shows its name greyed and the Media missing status. An object
that no bank contains, and an object that does not play, show the reason in place of the media.

### Action rows

An action row draws the fields of its action that the event tree carries, from the action types
of `ltk_wwise` 0.2.0:

| Field  | Shows                                                              |
| ------ | ------------------------------------------------------------------ |
| Class  | The class name, such as Stop, Pause, Resume, SetSwitch or SetState |
| Target | The derived name of the object that it targets and `#` and its ID  |
| Delay  | `+` and the `DelayTime` in ms, if it is not 0                      |

An action class outside the table of Wwise classes shows as `0x` and four hex digits. An action
that no bank contains shows `Action #id missing` in place of its class. The fade time of a Stop and the switch
or the state that a SetSwitch or a SetState sets are not drawn, because the event tree does not
carry the props of an action other than its delay. A Play whose target the walk visited before
is an action row too.

### What plays

A press on a row plays what one press of the game plays from that row:

| Node               | Plays                                                                      |
| ------------------ | -------------------------------------------------------------------------- |
| Random container   | One playlist item, picked by its weight on every press                     |
| Sequence container | The first item of its playlist                                             |
| Switch container   | The nodes of its default switch, or the first child if the switch has none |
| Layer container    | Every child at once                                                        |
| Actor-mixer        | Every child at once                                                        |
| Sound              | Its media                                                                  |

A random container that does not use weights picks every playlist item with the same chance. A
child outside the playlist does not play. A switch state header plays the nodes of its state.
The press does not read a switch or a state that the game sets, and it does not avoid a repeat
or shuffle the playlist. An action row does not play.

An event plays the picks of all its Play actions, and each pick starts after the `DelayTime` of
its action. The random range of a delay is not read. A press on a header or a voice row does not
wait the `DelayTime` of the action. A seek on the waveform moves every voice of the press to the
playhead without its delay. A press stops what the press before it started, so a second press on
a random container plays another variation. A sound whose media is missing and an object that
does not play give nothing to play and show no play button. Every voice plays at the volume of
the media table's player, with the properties of its path, per "Playback of properties".

### Inspector

View - Inspector shows a pane on the right of the tree. The pane is remembered
per user. It lists every field of the selected row's object as field rows, with the knobs, the
value entry and the units of "Editing". The rows stay editable in place, and the pane adds the
fields that they hide.

| Selected row  | The pane lists                                                                     |
| ------------- | ---------------------------------------------------------------------------------- |
| Voice         | The sound: `source` and its media, every property, and `weight` in a random parent |
| Header        | The container, or the switch of a switch state of sounds                           |
| Action header | The Play action: `target` and `delay`                                              |
| Action        | The action: `target` and `delay`, read-only for a class other than Play            |
| Event         | Each Play action                                                                   |

- A container also lists its facts read-only: the playlist mode and the weight mode of a random
  container, and the switch group and the default switch of a switch container.
- Each object's fields and facts are grouped under the section headers Media, Mix, Filters, Timing
  and Selection, in that order. A section without a row is left out.
- A row names its field in words, as "What an edit changes" lists. A hover on the name opens the
  field card: what the field does in the game, its values, its default and its Wwise property.
- The pane starts with the path from the action down to the row, as muted text that takes no
  press. It is the one place that the tree writes a path.
- With several voice and header rows picked, the pane lists the properties that every pick has,
  with the values of the first. An edit applies to each pick as "Selection" describes.
- Each field row is a tab stop. F2, Enter or a double click opens its entry, and the row takes
  focus back when the entry closes. An edit in the pane replays as an edit of the selected row.

### States

- An event without an action lists one row, No actions.
- The game sandbox takes no edit. The knobs are disabled, and no picker opens.

### Edits

The tree sends the edits of "Editing" to the document, with its undo history and its marks. A
knob turns and an entry opens as "Knob" describes.

- When an edit of a cell of a voice row lands, the voice plays once at the volume of the player. An
  edit of a header, an action or an event plays the event once. The replay plays with the edited
  properties, per "Playback of properties". An edit of an object that a playing voice reads does
  not replay, as the voice follows the edit.
- A double click or F2 on the media cell opens the media picker in place of the name. It lists the
  media of the bank set that the sound can read: the media of the banks for a sound of a bank's
  media index, and the media of the packages for a streamed sound. A prefetched sound takes no
  pick. A media shows its name, per "Node names", its source ID and the file that holds it. The
  text filters by name, source ID or file name, and a source ID that two files hold is listed
  once, from the first. A highlighted media plays. Enter points the `source` of the sound at the
  highlighted media and plays it, and Escape closes the picker. Replacing the file of a media is
  not part of the picker.
- F2 or Enter on the name cell of an action header opens the entry of its `target`, which
  retargets the Play. The `target` field of the inspector does the same.
- A header that adds a child has a `+ Add` row under its rows, and an expanded event ends in its
  own. A switch adds from its default state, because a child added to a switch joins its default
  switch. A press or Enter on one opens the menu of "New objects".
- Delete deletes the picked rows from their parents. Alt+Up and Alt+Down and a drag move the
  selected voice or header in the playlist of a random parent. Wrap in container, Cut, Paste and
  Duplicate take the picked rows, per "New objects". A weight is edited in its cell.

### Keyboard

The tree is one tab stop. Focus selects the first row if no row is selected. Its keys are in
"Keys and gestures".

### Row actions

An event's context menu contains Copy event name, which copies `#` and the ID for an unnamed
event. Inside a project it also contains Show contextual rule, which opens the `ContextualActionData`
object in its Voice lines view at the first rule that plays the event, and Show in bank unit,
which opens the bin at the `events[i]` row of the first ranked unit that lists the event's name.
An action's and an object's menu contains Copy object ID. A sound whose media is found also
contains Show media, which opens the document of the file that contains the media, switches it
to the Media view and selects the row of the source ID.

An event row takes the menu of an event, an action header and an action row the menu of the
action, a header the menu of its container, or of its switch for a switch state of sounds, and a
voice row the menu of its sound. A header row also offers Show in inspector while the inspector is
hidden. An editable bank adds the actions of "New objects" to each menu. Every item of a menu
shows its icon, and its key where it has one.

## Editing

Inside a project, an event bank opens as a document that takes edits. The tab takes the unsaved
dot, `Ctrl+S` saves it, and `Ctrl+Z`, `Ctrl+Shift+Z` and `Ctrl+Y` step its history. The game
sandbox takes no edit. Every read of the tree applies the unsaved edits, so a press plays the
edited bank before a save. Save, Undo and Redo of the Edit and File menus do the same as the keys.
The event tree edits the document, and the document stays open while the Media view shows. The
field rows below are those of the inspector, and "Edits" lists those of the tree rows. The keys
are in "Keys and gestures".

Each edit decodes the objects it changes, changes them and encodes them at the bank's version, or
adds or removes whole objects, so every other object keeps its bytes. Only the objects of the
opened bank take edits. An object of another bank of the set is edited in the document of that
bank. An import also adds a media to a media bank or a package of the set, which the document
holds beside the bank.

### What an edit changes

A field row shows its value as plain text, and no box is drawn at rest. A double click on the
row, F2 or Enter opens the value entry, prefilled with the value and selected. A field with a knob
opens the entry as a popup under the knob, and any other field opens it in place of the text.
Enter and a press outside commit the entry, and Escape cancels it. An entry left with the text it
opened with writes nothing. An action of another class than Play and an object outside the opened
bank list their fields read-only, and their entry does not open.

| Row                          | Field rows and keys                                                        |
| ---------------------------- | -------------------------------------------------------------------------- |
| Play action                  | `target`, the object ID it plays. `delay`                                  |
| Sound                        | `source`, the source ID of its media, and the properties of the next table |
| Container                    | The properties of the next table but `loopCount`                           |
| Child of a random container  | `weight`, and its place in the playlist                                    |
| Container that takes a child | The add row under its header, per "New objects"                            |
| Sound in a container         | Remove from container on its row, which deletes it as "New objects" says   |

| Field        | Wwise property                        | Shows                                           | Default |
| ------------ | ------------------------------------- | ----------------------------------------------- | ------- |
| `target`     | the object ID of a Play               | The name of the object, then `#` and the ID     |         |
| `source`     | the source ID of a sound              | The file name of the media, then `#` and the ID |         |
| `volume`     | `Volume`                              | dB, signed, one decimal                         | 0       |
| `makeUpGain` | `MakeUpGain`                          | dB, signed, one decimal                         | 0       |
| `pitch`      | `Pitch`                               | cents, signed, whole                            | 0       |
| `lpf`        | `LPF`                                 | %, 0 to 100                                     | 0       |
| `hpf`        | `HPF`                                 | %, 0 to 100                                     | 0       |
| `delay`      | `InitialDelay`, `DelayTime` of a Play | s                                               | 0       |
| `loopCount`  | `Loop` of a sound                     | The plays, or "Loops forever" for 0             | 1       |
| `weight`     | the playlist item's weight            | Wwise's weight, stored as 1000 times it         | 50      |

A row names each field in words: Target, Source, Volume, Make-up gain, Pitch, Low-pass filter,
High-pass filter, Initial delay, Delay for the delay of a Play, Loop count and Weight.

A weight in a random container whose pick reads the weights also shows its share of the total
weight of the playlist, as a percentage of picks. A target or a source that the tree does not
resolve shows `#` and the ID.

The entry opens with the exact value, without the rounding of the row. A typed value may end in
its unit, in any case: `dB`, `cents` or `ct`, `%`, and `s` or `ms` for a delay. A target or a
source takes a decimal ID, with or without a leading `#`. A value at its default removes the
property from the object, as Wwise writes it. An empty entry sets the default. Other properties of
an object are not listed.

### Knob

A bounded field draws a knob before its value text. A double click on the knob, or F2 or Enter
while the knob has focus, opens the value entry under it.

| Field                  | Knob span           | Source                                          |
| ---------------------- | ------------------- | ----------------------------------------------- |
| `volume`, `makeUpGain` | -96 to 24 dB        | The manager's own. `ltk_wwise` gives no range   |
| `pitch`                | -2400 to 2400 cents | `docs/design/wwise-audio.md` of `ltk_wwise`     |
| `lpf`, `hpf`           | 0 to 100            | The property table of `ltk_wwise`               |
| `weight`               | 0 to 100            | The manager's own. Neither source gives a range |

A vertical drag turns the knob, the full span over 200 pixels, and the wheel steps it while the
pointer is over it, and never while it is elsewhere. Up and Right step up, Down and Left step down,
Page Up and Page Down move a tenth of the span, and Home and End go to its ends. Shift moves a
tenth as far, and Ctrl ten steps at a time. A Shift drag is the fine drag. An Alt drag is not
offered, because an Alt press resets the knob. Alt+click, and
Delete or Backspace while the knob has focus, reset the field to 0. The value arc starts at 0, so
a cut and a boost read apart.

A drag is one edit, sent when the button is released. A run of keys or wheel steps is one edit,
sent 400 ms after the last step or when the knob loses focus. A reset and a committed entry are
one edit each. Each edit is one undo step. A typed value outside the span is kept, and the knob
points at the nearer end. Escape on the knob returns focus to the tree.

A weight edit also makes the container's random pick read the weights, which bit 0 of its flags
turns on. The other items then pick by the weights they carry.

A random container draws its children in playlist order, which is the order a sequence plays.
Moving a child moves its playlist item. An added child joins the children in ID order, as shipped
banks write them, and the end of the playlist at weight 50. A child added to a switch container
joins its default switch. A layer container takes no added child, because its layers name the
children again. A removed child leaves every list of the container that names it.

### Refusals

An edit is refused with the reason in a toast, and the bank is unchanged:

- A bank that is not version 145 shows an info notice that points at the Convert repair of its
  Problems entry, and takes no edit
- A new Play target or child that no bank of the set holds as a sound or a container
- A child the container holds already, or the container itself
- A source ID that no media index of the set holds for a sound in a bank, or that no package holds
  for a streamed sound. A prefetched sound takes no source edit, because its media is in two files
- A value outside the range of its property
- A new event whose name is empty or whose ID is taken, and a moved node of another bank or one
  that holds the container
- A new sound in a set with no sound to copy, and a new switch container in a set with no switch
  container
- An imported file that is not a WEM, whose codec is not Wwise Vorbis, or whose media does not
  decode, and an import into a set with no media bank and no package
- A replacement whose file gives no Vorbis WEM, of a media that the opened event bank holds
  itself, or of a media that a sound of another bank reads from a bank, whose size would change

A refused entry opens again with the typed text, marked, until Escape drops it. An entry whose
text holds no number stays open and marked on Enter, and a press outside drops it.

### Add rows

The add row of a container sits at the end of the rows of its header, and Add on a row opens the
nearest add row above it, else the event's, and expands the event. The node picker of Existing
lists the sounds and containers of the bank set by name and ID, filtered by name, kind or ID as
the text is typed. Enter adds the highlighted one and Escape closes the picker. A voice row in a
container shows Remove from container on hover.

### New objects

New objects are experimental until the in-game checks of #954 confirm them in a match. One
Experimental chip after the titles of the menu bar marks them in the bar, and the context menu holds
these actions in one group under one chip. An add row reads a plain `+ Add`, and its tooltip says that the actions are
experimental. An edit of an existing value carries no mark.

An event ends in an add row, and so does the header of a random or sequence container, of an
actor-mixer and of the default state of a switch. A layer container has no add row, because its
layers name the children again. The row reads `+ Add`, and a press, Enter or Ctrl+Enter opens its menu:

| Item      | Under a container                                       | Under an event                            |
| --------- | ------------------------------------------------------- | ----------------------------------------- |
| New sound | A sound that plays a media of the bank set              | The same, played by a new Play action     |
| From file | A sound that plays a `.wem` imported from disk          | The same, played by a new Play action     |
| Container | An empty random, sequence or switch container           | The same, played by a new Play action     |
| Existing  | Move existing here: the node leaves its parent for this | Play existing: a new Play action plays it |

New sound opens the media picker of "Edits" over every media of the set. Existing opens the node
picker. Insert - New event opens a name entry after the filter. Enter creates the event, and Escape
or a press outside drops the entry.

A context menu holds the actions on the picked rows. Each item shows its icon and its key.

| Item                 | Key        | Action                                                                     |
| -------------------- | ---------- | -------------------------------------------------------------------------- |
| Add                  | Ctrl+Enter | Opens the add row of the row's container or event                          |
| Duplicate            | Ctrl+D     | Adds a copy of each picked node or action beside it                        |
| Cut                  | Ctrl+X     | Holds the picked sounds and containers for a paste that moves them         |
| Paste into container | Ctrl+V     | Moves the cut nodes into the selected container, or into its container     |
| Wrap in container    | Ctrl+G     | Puts the picked nodes of one parent into a random container, or of a kind  |
| Delete               | Delete     | Deletes each picked row from its parent                                    |
| Copy                 | Ctrl+C     | Copies the event names and object IDs of the picked rows, one on each line |
| Rename               | none       | Opens the name entry of the picked event with its name                     |
| Replace media...     | none       | Replaces the media of the picked sound from a file, per "Replacing media"  |

Duplicate on an event opens the name entry with the name and `_copy`, and the new event copies
every action and every node below them. Rename gives the event the ID of the new name in its place
in the file, and keeps its actions.

**Play targets.** A Play action names the bank that holds its target. A retarget to an object of
another file of the set writes the bank ID of that file into the action. `ltk_wwise` 0.2.0 keeps
the field private, so the edit writes the four bytes before the last field of the encoded action
and checks that `Action::play_bank` reads the new ID back. A retarget inside one file keeps the
bank ID that the action has.

**IDs.** A new event's ID is the FNV-1 hash of its name, because a bin names an event by its name.
A name whose ID an object of the set or an event name of the audio indexes holds is refused. Every
other new object takes the FNV-1 hash of `ltk-manager/<bank ID>/<n>`, and a new media takes that of
`ltk-manager/<bank ID>/media/<xxh64 of the WEM>/<n>`. `n` counts up from 0 to the first ID that no
object or media of the set, of the project and game audio indexes, and of the document holds. The
bank ID is the header ID of the opened bank. Two banks therefore draw apart, and a WEM imported
again after an undo takes the ID it had, which the decoded media cache keys on.

**Parent links.** Every container lists each child whose `parent` field names it, and every child
names the container that lists it. A new node under a container takes the container as its parent.
A node that a Play action plays directly takes the actor-mixer above the template sound, which
lists it. A copy keeps the parent of its original, and each node below it is copied with a fresh ID
under the copy. Move existing here takes the node out of the container that listed it.

**Templates.** A new sound copies the node base of the first sound below its container, else of the
first sound of the opened bank, else of the set, so it routes to the bus that the bank already
uses. A new container copies the node base of a container of its kind and drops its properties. A
switch container takes the switch group and the default switch of a switch container of the set,
and is refused if the set has none. A child added to a switch container joins its default switch.

**Delete.** A delete unlinks the row from its parent: a container drops the child, a Play action
whose target is deleted leaves its event, and an event drops the action. The object is then kept if
another container, action or event of the set still references it, and its `parent` moves to a
container that lists it. Otherwise it is removed, with every object below it that the delete leaves
unreferenced. An actor-mixer is never removed. A media that the document imported and that no sound
plays any more leaves its file. A delete never changes another bank.

**Wrap in container.** The new container takes the place of the first picked node in the lists of
the parent, the other picked nodes leave the parent, and the container lists them all in their
playlist order and weights. A node that a Play action plays is wrapped alone, and the Play then
plays the container.

**From file.** The import reads the file as a WEM, refuses any codec other than Wwise Vorbis, and
decodes it with the decoder of the Media view. Only Vorbis plays in the game. The import takes
no other format. The media goes into the media bank of the set if the template sound plays from a
bank, and into the package if it streams, and into the other file if the set has no such file. The
sound's `in_memory_size` is the length of the WEM. A game media file is copied into the project
layer on its first import, as a game event bank is on its first edit.

### Bank unit events

An edit that creates, renames or deletes an event updates the `events` list of the bank units that
name the bank, as a second change of the same action:

- Every unit of the project's bins that names the bank takes the change. If no project bin names
  it, the first ranked unit of the game takes it, and its bin is copied into the project layer
  first, as a game bank is on its first edit.
- A created event's name joins the end of the list, and a name that the list holds already is
  skipped. A renamed event's item takes the new name in its place. A deleted event's item leaves.
- The change is one `EditProperty` of the bin document (ADR-0051), which is one step of that bin's
  history. The bank document holds the bin open and keeps that step beside its own, so one undo
  reverts both. A save of the bank writes the bin too, and closing the bank drops the bin's
  unsaved change.
- A unit that cannot be updated, such as a unit of a `PTCH` bin, is logged, and the bank edit
  stays.

A bin tab open on the same file shows the change, because both read one tree. Its own undo then
reverts the step too, so a mix of undo in the bin tab and in the bank can revert another change
than the reader expects.

### Using an event

An event is set in a clip or a VFX system from the bin's side: the sound field suggests the
events of the bin's character skin, per "A sound field" in docs/ux/BIN_EDITOR.md.

Create event from a sound field of a bin is not built yet.

### Replacing media

Replace media from file... on a voice row replaces the media that the sound plays,
at its source ID, so every sound that plays it plays the new media. The action is experimental
until #954.

- The file dialog takes a `.wem`, which is used as it is, and a `.wav`, `.ogg` or `.flac`, which
  converts to a Vorbis WEM through the Wwise console of Settings > Workshop > Audio. Without that
  path such a file is refused with a pointer to the setting. Only Vorbis plays in the game, so the
  WEM is refused for any other codec.
- The conversion runs `WwiseConsole.exe create-new-project` and then `convert-external-source`
  with a `.wsources` list of the one file and the `Vorbis Quality High` conversion, in a temporary
  folder. The commands follow the Wwise command line reference. They have not been run against
  the Wwise version that writes bank version 145.
- The media is replaced in the file of the set that holds it, the package first and else the
  media bank. That file joins the document and is copied into the project layer on its first
  change, as an import copies it.
- Each sound of the opened bank that plays the media takes the new `in_memory_size`: the length of
  the WEM for a sound of a bank's media index, and the prefetched length for a prefetched sound,
  whose start in its bank is replaced with the start of the new WEM. A streamed sound keeps its
  fields. `plugin_id` is Vorbis.
- Before it writes, the replacement reads what it changes. If several sounds play the media, if a
  sound of another bank plays it, or if the codec, the channel count or the rate changes, a
  confirm lists the sounds by ID and the changed facts.
- One replacement is one undo step over the bank and the media file. A delete of the last sound
  that plays a replaced media keeps the replacement.

The media table of a package or a media bank has no document of its own, so its rows take no
replacement. Revert of one row, the durations before and after, and a warning for a much longer
media are not built.

### Selection

A press picks one row. Ctrl+click adds or drops a row, Shift+click and Shift+Up or Down pick the
range from the last row picked without Shift, Ctrl+A picks every drawn row, and Escape keeps the
row under the keyboard alone. A switch state of sounds, an add row and a loading row take no pick. The
count after the filter reads the picked rows when more than one is picked.

Delete, Duplicate, Wrap in container and Copy take every picked row, and each is one undo step. A
row below another picked row is left to it. Space plays the picked rows together. A knob edit of a
picked node applies to every picked node that takes the property: volume, make-up gain and pitch
move by the same amount, and every other property takes the same value. A knob is disabled while
one picked row does not take its property.

### Marks and saving

A row whose object differs from the bank as it was opened carries an accent dot. Undoing every
edit of an object removes its dot.

The first edit of a game bank writes the game's bytes into the project, in the layer of the
sandbox or else the base layer, at the chunk's path below its archive folder. The first import
into a game media file copies that file the same way. The edit is refused if the project already
has a file there. One edit is one undo step over the bank and its media files, and an undo of an
import restores the bytes of both. A save writes each changed file through a temporary file, and
the tab then opens the layer file of the bank. A save refuses, and writes no file, if a file
changed on disk since it was opened or last saved, and the edits stay in the document until the
bank is reopened.

## Playback of properties

Every player plays a voice with the properties along its path in the play tree: the sound, each
container above it, and the Play action. One Web Audio graph per voice carries them: the source,
a high-pass filter, a low-pass filter and a gain. The media table plays each media as its file
holds it.

| Property               | How the levels combine                                        | Web Audio                                             |
| ---------------------- | ------------------------------------------------------------- | ----------------------------------------------------- |
| `volume`, `makeUpGain` | Add, in dB                                                    | The gain: the player's volume times `10^(dB/20)`      |
| `pitch`                | Adds, in cents                                                | The `detune` of the source                            |
| `lpf`                  | Adds, then clamps to 0-100                                    | A low-pass biquad. At 0 the voice has none            |
| `hpf`                  | Adds, then clamps to 0-100                                    | A high-pass biquad. At 0 the voice has none           |
| `delay`                | Every `InitialDelay` and the Play `DelayTime` add, in seconds | The start time of the source                          |
| `loopCount`            | The sound's own                                               | The plays of the media. 0 loops until the voice stops |

Wwise adds the relative properties of an object to those of its parent and every object above it,
per "Understanding property and behavior inheritance" in the
[Wwise Help](https://www.audiokinetic.com/library/edge/?source=Help&id=understanding_property_and_behavior_inheritance).
The manager assumes that `MakeUpGain` and `InitialDelay` add as `Volume` and `Pitch` do.

Wwise does not publish how `LPF` and `HPF` map to a frequency. The preview maps `LPF` on a log
scale from a 20 kHz cutoff at 0 to 50 Hz at 100, and `HPF` from 20 Hz at 0 to 8 kHz at 100, as
many octaves as `LPF` spans. This is an approximation, and the field card of each filter says so.

- A press on an event plays each pick under its Play action. A press on a voice, a header or a node
  row applies the object and the containers above it, and not the `DelayTime` of the action.
- A loop count of N plays the media N times, and 0 loops it until the press stops. A persistent
  VFX sound loops until it stops, whatever its loop count.
- While a voice plays, a turn of a knob eases its gain, its detune and its filter cutoffs to the
  new value, with a time constant of 20 ms, and the voice does not restart. A knob of a header
  reaches every voice under the header. With several rows picked, the turn reaches the voices of
  the turned object, and the others follow when the edit lands. A delay and a loop count apply
  from the next press.
- An unsaved edit applies the same way, because every read of the tree applies the edits.
- The waveform strip draws the media as its file holds it. Its playhead moves at the playback rate
  of the detune, so a voice at +1200 cents moves it twice as fast.
- The gain of a voice clamps to 1, so no voice plays louder than its media at full scale, whatever
  its make-up gain. The sum of every voice passes a limiter before the output, a
  `DynamicsCompressorNode` at -1 dB with a ratio of 20, a 1 ms attack and a 100 ms release. The
  clamp keeps one boosted voice at full scale, and the limiter holds the sum of many.
- The viewport, VFX and ability sounds read the properties of each tree from the answer of
  the sound lookup, and play them through the same graph. A persistent VFX sound keeps looping
  whatever its loop count.

## Keys and gestures

The keys of the media table, the event tree and the Voice lines view are commands of the key
registry, per "The registry" in docs/ux/KEYS.md. The key handlers resolve a press through it, and
the menu bar, the context menus and the palette read their keys from it. `?`, F1 and View - Keys
and gestures open the app's shortcut sheet, which lists the keys of the document's views first.
The palette lists the commands of the active audio document under Audio, each with its key, while
the command applies.

A list answers its keys while it has focus, and a key that it answers stops there. A key that is
marked Document answers from anywhere in the document but a text field and an open menu or dialog.

| Key                                  | Where    | Action                                                                                               |
| ------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------- |
| Space                                | Lists    | Play or stop the selected row, or the picked rows together                                           |
| Shift+Space                          | Tree     | Play the whole event of the selected row                                                             |
| Escape                               | Lists    | Stop what plays, or keep only the selected row picked                                                |
| Ctrl+L                               | Document | Loop the preview                                                                                     |
| `-`, `=`                             | Document | Lower or raise the preview volume                                                                    |
| Up, Down                             | Lists    | Select the row above or below                                                                        |
| Page Up, Page Down                   | Lists    | Move the selection one page of the list                                                              |
| Home, End                            | Lists    | Select the first or the last row                                                                     |
| Shift+Up, Down, Page Up, Page Down   | Tree     | Pick the range to the row, per "Selection". Shift+Home and Shift+End too                             |
| Ctrl+A                               | Tree     | Pick every drawn row                                                                                 |
| Right                                | Tree     | Open a folded header, move to the next cell, then expand the row                                     |
| Left                                 | Tree     | Move to the previous cell, then collapse the row or select its parent                                |
| Ctrl+Up, Ctrl+Down                   | Tree     | Select the previous or the next event                                                                |
| A letter, a digit, `_`, `#`          | Lists    | Select the next row whose name starts with the typed text                                            |
| Ctrl+F                               | Document | Focus the filter of the view                                                                         |
| Shift+F10, Menu                      | Lists    | Open the context menu of the selected row                                                            |
| Ctrl+Shift+M                         | Document | Show the Media view                                                                                  |
| Ctrl+Shift+E                         | Document | Show the Events view                                                                                 |
| Ctrl+Alt+B                           | Document | Show or hide the inspector of the event tree                                                         |
| `?`, F1                              | Document | Show the shortcut sheet, per "The shortcut sheet" in docs/ux/KEYS.md                                 |
| Enter, F2                            | Lists    | Open the entry of the cell, a target, the media picker or the add row. Enter plays a row without one |
| Backspace                            | Tree     | Reset the field of the active cell or the field row to its default                                   |
| Ctrl+Enter                           | Tree     | Open the add row of the nearest container that has one, or of the event                              |
| Ctrl+D                               | Tree     | Duplicate the picked rows                                                                            |
| Delete                               | Tree     | Delete the picked rows from their parents                                                            |
| Alt+Up, Alt+Down                     | Tree     | Move the selected row in the playlist of its random container                                        |
| Ctrl+G                               | Tree     | Wrap the picked nodes in a random container                                                          |
| Ctrl+C                               | Lists    | Copy the names of the picked events and the IDs of the others                                        |
| Ctrl+X                               | Tree     | Cut the picked sounds and containers                                                                 |
| Ctrl+V                               | Tree     | Move the cut nodes into the selected container, or into its container                                |
| Ctrl+S, Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y | Document | Save, undo and redo, per "Editing"                                                                   |
| Up, Down on a focused knob           | Knob     | Step the knob, a tenth as far with Shift, ten steps with Ctrl                                        |
| Delete, Backspace on a focused knob  | Knob     | Reset the knob                                                                                       |

Lists are the media table and the event tree, and Tree is the event tree. In the media table,
Space and Enter play the selected row, Ctrl+C copies its source ID, and the type-ahead matches the source
ID. The type-ahead text runs on
while the keys follow within 700 ms. A name that starts with the text wins over one that holds a
word that starts with it, such as `death` in `Play_sfx_Rumble_Death3D_cast`, and a run of one
letter cycles the rows that start with it. A key of an edit in a bank that takes no edit does
nothing, and it does not reach the app either.

### Gestures

- A drag of a voice or a header in a random container, past 4 pixels, moves it to the place in
  the playlist of the row that it is dropped on. A row of another container takes no drop.
- A `.wem` dropped on a voice row replaces the sound's media, per "Replacing media". A
  `.wav`, `.ogg` or `.flac` converts first. A `.wem` dropped on `+ Add` imports it, as From file
  does. The file comes from the OS or from the content tree of the project.
- A named event row dragged onto a rule of the Voice lines view makes the rule play the event, per
  "Keys and gestures" in docs/ux/CONTEXTUAL_VOICE.md.
- A middle click on a row plays it or stops it. A double click opens the entry of a field, as F2
  does, or expands the row.
- Ctrl+click adds or drops a pick, and Shift+click picks a range, per "Selection". A drag starts
  only from a press without a modifier, so a modified press stays a pick.
- The wheel turns a knob only while the pointer is over it, and a Shift drag of a knob is fine.

The row under a drag draws the accent ring, and a cut row is dimmed until a paste moves it.

### Keys the app holds

The keymap takes no key that the app answers outside the document. Where a key meets an app key,
this is how the two resolve:

- `Ctrl+D` opens Diagnostics app-wide. The trees answer it as Duplicate and stop it there, as the
  VFX timeline does, also in a bank that takes no edit, so a press in a tree never leaves the
  document.
- `Escape` restores a maximized panel. A list answers it only when something plays or several rows
  are picked, and otherwise the panel restores.
- `Ctrl+F` belongs to the editor, which reaches the filter of the open view through the document's
  find.
- `Ctrl+S` and the undo keys belong to the editor, so the keymap lists them and adds no handler.
- `Ctrl+Shift+I` opens the developer tools, so the inspector takes `Ctrl+Alt+B`. `Alt+Left` and
  `Alt+Right` walk the navigation history and `Alt+1` to `Alt+9` take a tab, so no list binds them.
- `Ctrl+Up` and `Ctrl+Down` step a focused knob ten steps. The knob answers them first, so they
  reach the next-event key only from the row.
- An Alt drag of a knob is not offered, because an Alt press resets the knob.

## Waveform

The media table and the event tree each have a waveform strip under them: a play and pause
button, the waveform of one media with its playhead, and the time as `m:ss.cc` of the playhead
and of the media.

| Panel  | The strip shows                                                                       |
| ------ | ------------------------------------------------------------------------------------- |
| Media  | The row that plays, else the selected row if it plays                                 |
| Events | The first media of the press that plays, else the selected sound, else the last press |

The strip plays through the channel of its panel, at the panel's volume, and adds no player
of the strip. The media decodes once, through the cache that playback reads, and the strip draws its
peaks. A selection decodes after it stays unchanged for 150 ms, so a run of arrow keys decodes one media.

- A click on the waveform moves the playhead there. A drag moves it where the drag ends.
- A seek on a media that plays or is paused keeps that state. A seek on a media that does not play
  plays it from the playhead.
- An event plays all of its media at once, and a seek moves each of them to the playhead. A media
  shorter than the playhead ends.
- Pause stops every voice of the panel in place, and Play resumes them. Play on a media that does not play
  plays it from the start. A row of the table or the tree that is paused shows as playing, and a
  press on it stops it.
- The playhead returns to the start when the media ends or stops.

The waveform is one tab stop, a slider of the playhead, with the keys of a slider. Right and Up
move the playhead on a twentieth of the media and Left and Down back, Page Up and Page Down move it
a quarter, Home and End go to the start and the end, and Space plays or pauses.

### Waveform column

Each row of the media table and of the event tree ends in a small waveform of its media. A row
of the event tree draws the first media that a press on it plays, with the first playlist item
that has a weight in each random container. An event row reads its event first. A voice row draws its
own media. A row that plays no media draws none.

- A row decodes when it scrolls into view, three rows at a time. A row that leaves the view
  before its turn does not decode.
- The column decodes outside the cache that playback reads, so it evicts nothing that plays.
- The bars are scaled to the loudest bar of the media, so a quiet media still shows its shape.
- The row that plays draws its waveform in the accent.

## Viewport sound

The skin viewport plays the `SoundEventData` events of the clip it plays. Sound is off by
default. The speaker switch in the viewport's toolbar turns it on, and its caret opens the
volume, which defaults to 0.2. Both are remembered, and the Project editor card of the settings
lists them in its Viewport group.

The playback approximates the game's mix. It applies no bus, no RTPC, no attenuation and no 3D
position, and the switch's tooltip says so. Each voice plays with the properties of its path, per
"Playback of properties". The tooltip also counts the event names of the view
that resolve to no event or to no media, so a missing sound reads apart from a muted one.

### Firing

An event fires when forward playback crosses its start frame.

| Field                         | Effect                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------- |
| `mIsLoop` true                | The event fires on every loop of the clip                                       |
| `mIsLoop` false               | The event fires on the first pass alone                                         |
| `mIsKillEvent` true           | The sound stops when the clip loops or stops, and restarts when the event fires |
| `mIsKillEvent` false          | The sound plays to its end                                                      |
| `mSkipIfPastEndFrame` true    | A frame that lands past the end frame when it crosses the start fires nothing   |
| `mEndFrame`                   | Does not stop the sound                                                         |
| `ConditionClipTransitionType` | Read into the clip model. The viewport enters no condition clip past a start    |

A scrub, a restart and a clip switch fire nothing and stop every kill sound. A seek that the
viewport makes without a press, such as the fold of the clock when an effect model loads, changes
nothing. Pause stops every sound in place and play resumes them. The playback speed does not change the
pitch or the rate of a sound. Sound stops when the viewport's tab is hidden or closed.

An edit of a clip event takes effect on the next pass.

### Resolution

The viewport asks once per view for every event name its cues contain. The bank set is every
`BankUnit` of the open document, then the bank units that the project's bins and the game's audio
index register a missing name in. A document without a `BankUnit`, such as a VFX bin that a skin links, takes the units of the skin bins that the paths of its objects name. The units of the document come first, and a project layer's copy
of a file comes before the game's, so a replacement media plays. A voice-over unit reads its paths
under the client's locale. A layer file write asks again.

An event plays what one press of the event tree plays, per "What plays" above, with a random
container picked again on every firing.

### Voices

A viewport plays at most 32 sounds at once. A new sound past the cap stops the oldest one.

## VFX sound

The VFX preview plays the sounds of the system it runs, and the skin viewport plays the sounds of
each system that a clip's particle event spawns. Both follow the speaker switch, the volume and
the resolution of "Viewport sound". The grid previews of the objects browser play no sound.

A system names its sounds in `soundOnCreateDefault`, `soundPersistentDefault`,
`voiceOverOnCreateDefault` and `voiceOverPersistentDefault`. An emitter names its sounds in `Audio`,
a `VfxEmitterAudio` with `SoundOnCreate` and `SoundPersistent`. An empty name is no sound.

### Firing

A sound fires when forward playback reaches the moment it belongs to.

| Moment                              | Effect                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| The system starts                   | Every sound of the run stops. The system's on-create and persistent play      |
| The rig stops the system            | Every persistent sound of the system and of its emitters stops                |
| An emitter emits for the first time | The emitter's `SoundOnCreate` and `SoundPersistent` play                      |
| An emitter's emission ends          | Its `SoundPersistent` stops if the system's flags set `soundsEndOnEmitterEnd` |
| A child system is spawned           | The child system's on-create sounds play                                      |

An on-create sound plays its media once. A persistent sound loops its media until it stops. An
emitter that the `ChanceToNotExist` roll removes plays nothing. A restart, a replay of a looping
rig and the restart of a run that ended each start the system again, so the on-create sounds play
on every run.

A seek, a scrub and a step fire nothing and stop every sound of the run. An edit of a sound field
takes effect on the next firing.

In the skin viewport, a clip effect's sounds play when forward playback crosses its particle
event and stop when the pass leaves the event or a scrub moves the run. Pause stops them in place with the
sounds of the clip.

The bank set is the one of "Resolution". A system opened from a skin bin resolves through that
skin's bank units. A system in a bin without bank units resolves through the audio index.

## Ability sound

The ability preview plays the `SoundEventData` events of the cast clip and the sounds of each
step's effect: cast, projectile and impact. It follows the speaker switch, the volume and the
resolution of "Viewport sound". The switch sits in the preview's controls row.

The bank set adds one unit to the skin's bank units: the spell's `AudioBankPaths`. A recipe made
from a spell keeps those paths, and a recipe made by hand has none. A path with an `en_US` segment
reads under the client's locale first. `SpellEventToAudioEventSuffix` is not read.

### Firing

| Source              | Effect                                                                    |
| ------------------- | ------------------------------------------------------------------------- |
| A cast clip event   | Fires when forward playback crosses its start frame, per "Viewport sound" |
| A kill event        | The sound stops where the cast clip ends                                  |
| A step's effect     | Fires on the run of the step, per "VFX sound", from the step's start      |
| The end of the cast | Every sound plays to its end                                              |

The cast clip plays once, so `mIsLoop` does not fire an event a second time. A seek, a scrub, Cast
from the end and Replay fire nothing and stop every sound, and the next forward frame fires from
the time it starts at. Pause stops every sound in place and play resumes them.
