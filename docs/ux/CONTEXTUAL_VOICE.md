# Contextual voice

The contextual voice of a unit is a `ContextualActionData` object: its situations, the rules of
each situation, and the short name that each rule plays for each audience. This document covers
the Voice lines view of that object and the Played by column of an event bank, which link the
rules to the events they play.

A class view, its sections and its sandbox are in docs/ux/BIN_EDITOR.md, under "Class views" and
"Editing". The event bank, its event tree and its inspector are in docs/ux/AUDIO.md. The copy for a skin is ADR-0073.

## Changes

| Date       | Change                                                                 |
| ---------- | ---------------------------------------------------------------------- |
| 2026-10-31 | Draw the menu bar in the tab's row, and add Save, Undo and Redo        |
| 2026-10-30 | Author chance, weight and random choice from the list                  |
| 2026-10-30 | Add the menu bar, and lay the rules out as a cue sheet                 |
| 2026-10-30 | Name the event tree of a bank in place of its Voices view              |
| 2026-10-30 | Read the keys from the audio keymap, add drags and type-ahead          |
| 2026-10-30 | Add the Voice lines view, the Played by column and the copy for a skin |

Each edit of this document adds a row at the top. The table keeps the last ten rows.

## Voice lines

A `ContextualActionData` object opens in the Voice lines class view, beside Properties. The skin
layout lists `mContextualActionData` in its own Voice lines section, and its link opens the
object. The view is the one section of a headless stack layout that takes edits in place, so no
section header or fold frames it. The first header row ends with `mObjectPath`. A field that the
view does not draw lists under it as a field row, without the Other header.

```
Edit  Insert  View  Playback  Voice   [Filter............]  [2 unresolved]   [! 86 skins] `Characters/Lux/CAC/Lux_Base`
Resolve as [Skin 7 v] `Lux` `LuxSkin07` (Inferred) | Shared cooldown [15] s    Simulate [Self v]  Target [Any v]  Spell [Any v]
         RULE      LINE                             HEARD BY  CHANCE    WEIGHT  PRIORITY  WHEN
v Spell cast  SpellCast  8 rules                                                                      (>)
         Q         cast3D                     Lux   S A E Sp  (o) 50 %       -10  spell LuxLightBinding
         R         cast3D             [LuxSkin07]   S A E Sp                 100  spell LuxR
         + Add rule
v First encounter  EnemyEncounter  15 rules  cooldown 15 s  ! 1 unresolved                         (>)
         Quinn     FirstEncounter3DQuinn  [! Missing]  S . . .                    other is Quinn, first
```

### Header

The header has two rows. The tab's row holds the menu bar. The first row holds the filter, the unresolved count, the
shared mark and `mObjectPath`. The second row sets what the names resolve as, the shared cooldown and the trigger that a play
simulates.

- The menu bar is the one of the audio file document, per "Menu bar" in docs/ux/AUDIO.md, with the
  commands of this view. File, Edit and View also carry the items of the object tab, per
  "Menu bar" in docs/ux/BIN_EDITOR.md. Alt or F10 moves focus to it from anywhere in the view.

  | Menu     | Items                                                                                                                      |
  | -------- | -------------------------------------------------------------------------------------------------------------------------- |
  | File     | Save. The items of the object tab                                                                                          |
  | Edit     | Undo, Redo. Duplicate, Delete. Move up, Move down. Copy short name. Select all. The items of the object tab                |
  | Insert   | Add rule                                                                                                                   |
  | View     | The layout and Properties. Inspector as a switch. Expand all, Collapse all. Keys and gestures                              |
  | Playback | Play or stop, Play all, Stop all. Loop as a switch. Volume up, Volume down, the volume                                     |
  | Voice    | Add chance, Remove chance, Pick a random rule as a switch. Create event..., Show in bank, Show in tree. Copy for this skin |

  A command of the selected line reads "Select a row" while no line is selected.

- Resolve as lists the skins whose `mContextualActionData` links the object, from the project's
  bins and the game's audio index. The names resolve through the tags of the chosen skin, against
  the events of that skin's voice-over banks. The view opens on the skin that the reader chose last
  for the object, else the first skin of the project, else skin 0, else the first skin. The choice
  is kept per object and per user.
- The tags of the chosen skin, each a code chip, then one Inferred chip. The event names are
  composed, as "Names" in docs/ux/AUDIO.md says, so no line repeats the chip.
- The shared cooldown `mCooldown`, which F2, Enter or a double click opens for an entry.
- The count of unresolved rules. A press keeps only those rules.
- The filter keeps the rules whose name, situation, short names, events or conditions contain its
  text.
- Simulate sets the audience, the target and the spell that a situation's play simulates, per
  "Play situation". The target and spell pickers show only when a condition names one.

### Shared object

When two or more skins link the object, a warning mark before the object path states the count,
such as "86 skins". A hover on it reads "Used by 86 skins. An edit changes the voice lines of
each." The mark stays while the object is shared. Editing the shared object stays possible.

Copy for this skin, in the Voice menu, copies the object into the chosen skin's bin as `<path>_SkinNN`, sets the copy's
`mObjectPath`, links the skin's `mContextualActionData` to the copy, and opens the copy's tab in the
Voice lines view. The three changes are one edit of the skin bin, so one undo in that bin reverts
them. ADR-0073.

### Situations

A situation is a header row with a filled band: the caret, the situation's word, its key in mono
where the word differs, and the rule count, with the play button at the band's end. Settings show only where they differ
from the default: a Random chip for `mChooseRandomValidRule`, whose press turns random choice off, the situation cooldown when it is not
0, and the count of unresolved rules as a warning. An unnamed key shows its hash. The view writes a
word for the named keys a modder meets most, such as Spell cast for `SpellCast` and Attack order
for the four `Attack*2D` keys, and the key itself for the rest.

The column heads stay at the top of the list while it scrolls, and the header of the situation in
view stays under them until the next situation reaches it. A hairline separates two situations.
The rows draw no tree guides.

### Rule lines

Each rule is one line under the column heads, and each column has one width, so the lines of every
situation align. The fixed columns come first and When, the one column of prose, takes the rest of
the width. The dim play button before a rule's name shows on hover, on the selected rule and while
the line plays. Space and a middle click play any rule.

| Cell     | Shows                                                                        | Edit                      |
| -------- | ---------------------------------------------------------------------------- | ------------------------- |
| (play)   | Plays the line for the audience of the trigger, else the first named line    |                           |
| Rule     | `mRuleName`, or `#` and the rule's index muted                               | F2 on a named rule        |
| Line     | The short name, `+N` when other audiences name others, then the resolved tag | F2                        |
| Heard by | Four slots, Self, Ally, Enemy and Spectator: a letter if named, else a dot   |                           |
| Chance   | The knob and the percent of the rule's one `ContextualConditionChanceToPlay` | The knob, F2              |
| Weight   | `ChanceWeight`, in a situation that picks a random rule, else empty          | F2                        |
| Priority | `mPriority`, empty while unset                                               | F2, an empty entry clears |
| When     | The conditions in words, joined by `·`, but the chance. `One passes` before  | In the inspector          |

The tag is the tag of the chosen skin that the event name starts with, such as `LuxSkin07` for
`Play_vo_LuxSkin07_Move2DFirst`. A tag that is longer than another tag of the skin is the skin's own
and draws as an accent chip, and the base tag draws as dim text, so the lines that the skin
overrides stand out. A hover on the tag shows the full event name. A short name that resolves no event draws a Missing warning, and a
hover on it names the skin's event bank. Create event... in the menu opens that bank.

A rule without an audio action draws its animation or its chained situation in the Line column,
muted. A condition class that the view has no words for reads as its short class name and its
fields, such as `GameTimer(mGameTimeInMinutes = 20)`.

### Play situation

The play button of a header simulates one trigger. The conditions that the header sets are
evaluated: the target champion against `ContextualConditionCharacterName` of the other unit, and
the spell against `ContextualConditionSpellName`. Each chance is rolled once. A rule is valid when
it names a line for the trigger's audience and its conditions pass under its relationship. A
first-valid situation plays its first valid rule, and a random one draws a valid rule by
`ChanceWeight`, where a weight of 0 is drawn only when every weight is 0. Any other condition
passes. A trigger that no rule plays shows a toast.

Play all, in the header's menu, plays every resolved line of the situation in list order, one after
another. Playback reads each event's tree from its bank and plays one press of it.

### Inspector

Inspector in the View menu, or `Ctrl+Alt+B`, shows the pane of the event tree, with the same
remembered state.

| Selected      | The pane lists                                                               |
| ------------- | ---------------------------------------------------------------------------- |
| Situation     | Situation: Choose random rule, Situation cooldown                            |
| Rule          | Rule, Cooldown, Conditions, Plays, and Other actions where the rule has them |
| Several rules | The fields of Rule and Cooldown, with the values of the first                |

- A row names its field in words. A hover on the name opens the field card of the field's class,
  with the meta wiki's prose.
- A condition is a block of its fields under its class, whose card opens on hover. A child
  condition draws as a block under its parent. A boolean takes a switch, a number and a text take
  an entry, and a hash or a list reads as text. Delete condition removes it, and Add condition
  lists the classes that `mConditions` takes.
- Plays lists each audience's short name with the event it resolves to and its play button, then
  Max plays, Wait for announcer and Wait timeout.
- With several rules picked, an edit sets the field of each pick in one step.

### Edits

Every edit is one `bin_edit` of the object's document (ADR-0051), so the document's undo, marks
and save apply. An edit of several picked rules is one `EditProperty` of `mSituations`, so it is one
undo step. A field the rule does not write is added at its default in the same step, and a field of
a null `CooldownModifications` or `mAudioAction` gives the pointer its class first.

- Add rule pastes a rule named New rule with an empty owner name and `IgnoreTimer` set, then opens
  the entry of its short name.
- Ctrl+D copies each picked rule after itself, and Delete removes the picked rules.
- Alt+Up and Alt+Down move the selected rule, because list order decides the first valid rule.
- Add chance appends a `ContextualConditionChanceToPlay` of 100 % to each picked rule without one,
  then opens the entry of its knob. An empty Chance cell shows + Chance on hover, and F2 or Enter on
  it does the same. Remove chance removes the chance condition of each picked rule.
- Pick a random rule, in the menu of a line and the Voice menu, switches
  `mChooseRandomValidRule` of the line's situation. A random situation draws the Weight column.

### Keys and gestures

The list is one tab stop. Focus selects the first line if no line is selected. The keys are the
audio commands of the key registry, per "Keys and gestures" in docs/ux/AUDIO.md. The menus, the
tooltips and the shortcut sheet read the same registry. `?` and F1 open the sheet with this view's
keys first, and Keys and gestures in the View menu opens it too.

| Key                                 | Action                                                     |
| ----------------------------------- | ---------------------------------------------------------- |
| Up, Down                            | Select the line above or below                             |
| Page Up, Page Down                  | Move the selection one page                                |
| Home, End                           | Select the first or the last line                          |
| Shift+Up, Down, Page Up, Page Down  | Pick the range to the line                                 |
| Ctrl+A                              | Pick every rule                                            |
| Left, Right                         | Move between the cells of a rule line, or fold a header    |
| Ctrl+Up, Ctrl+Down                  | Select the previous or the next situation                  |
| A letter, a digit, `_`, `#`         | Select the next line whose name starts with the typed text |
| Space                               | Play or stop the line, or simulate the header's trigger    |
| Shift+Space                         | Play every resolved line of the situation, in list order   |
| Escape                              | Stop what plays, or keep only the selected line picked     |
| Enter, F2                           | Open the entry of the cell, or add a rule on the add line  |
| Ctrl+Enter                          | Add a rule to the situation                                |
| Ctrl+D                              | Duplicate the picked rules                                 |
| Delete                              | Delete the picked rules                                    |
| Alt+Up, Alt+Down                    | Move the selected rule                                     |
| Ctrl+C                              | Copy the short name of the line                            |
| Ctrl+L                              | Loop the preview                                           |
| `-`, `=`                            | Lower or raise the preview volume                          |
| Ctrl+Alt+B                          | Show or hide the inspector                                 |
| `?`                                 | Show the keys and gestures                                 |
| Shift+F10, Menu                     | Open the context menu of the selected line                 |
| Up, Down on a focused knob          | Step the chance, a tenth as far with Shift, ten with Ctrl  |
| Delete, Backspace on a focused knob | Reset the chance                                           |

The type-ahead text runs on while the keys follow within 700 ms. A name that starts with the text
wins over one that holds a word that starts with it, and a run of one letter cycles the lines that
start with it. Loop, the volume, the inspector and `?` answer from anywhere in the view but a text
field.

- A drag of a rule line, past 4 pixels, moves the rule to the place of the line it is dropped on,
  within its situation.
- A drag of a named event row from an event bank onto a rule line makes the rule play the event. The
  drop writes the short name that `compose_vo_names` reads back from the event name: the name after
  `Play_vo_`, the longest tag of the chosen skin and the spell segment of a rule with a spell
  condition. A name that no tag composes is refused with a toast.
- A middle click on a line plays it or stops it.
  Every menu item shows its icon, and its key where it has one: Play, Play all, Add rule, Duplicate,
  Move up, Move down, Delete, Create event..., Show in bank, Show in tree and Copy short name.

## Played by

An event row of an event bank has a Played by column at one x, before the waveform, in place of the
context badge.

| Cell              | When                                                            |
| ----------------- | --------------------------------------------------------------- |
| `Spell cast 50 %` | One rule plays the event, and the rule has one chance condition |
| `Attack order x3` | Three distinct rules play the event                             |
| `Listed only`     | Only the `events` list of a bank unit names the event, muted    |
| `Not played`      | No bin of the index names the event, muted                      |

- Two contexts are one rule when they share the situation key and the rule name, which collapses the
  four audiences of a rule and the copies of a rule in other skins' objects.
- A hover card lists every rule with its chance and audiences, and states that the match is
  inferred, or ambiguous where two tags name two events of the bank.
- Inside a project a press opens the rule's voice line, and with several rules the press opens a
  menu of them. Show contextual rule in the event's menu opens the same view.

### Linking the views

| From                     | Action          | Opens                                                                |
| ------------------------ | --------------- | -------------------------------------------------------------------- |
| Played by cell           | Press           | The object's tab in the Voice lines view, the rule selected          |
| Rule line                | Show in bank    | The event's bank, Events view, the event selected and scrolled to    |
| Rule line with a warning | Create event... | The skin's event bank, with the composed name in its new event entry |

Create event... prefills the name, and Enter creates the event in the bank document, which updates
the `events` list of the bank units as one step of the bank's history (ADR-0072).
