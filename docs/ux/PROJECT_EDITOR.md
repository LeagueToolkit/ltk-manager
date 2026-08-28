# Project Editor

## Changes

| Date       | Change                                                                 |
| ---------- | ---------------------------------------------------------------------- |
| 2026-08-24 | Hand the shell-wide pieces to [Workshop](WORKSHOP.md)                  |
| 2026-08-22 | Give the problems list a model, and the bin retype rule that fills it  |
| 2026-08-22 | Delete a layer file or folder from its own tree row                    |
| 2026-08-22 | Give every tab its chrome in a row, and a menu on the tab itself       |
| 2026-08-22 | Extract with no dialog, and copy a game file into a layer              |
| 2026-08-22 | Implement the extract to disk, on the branch's extractor               |
| 2026-08-21 | Key every chunk by `WadHash` upstream, the bin tooling's own hash type |
| 2026-08-21 | Reshape the extractor API upstream, one resolver type and closures     |
| 2026-08-21 | Recover chunk names from the bins, on a byte scan the crate runs       |
| 2026-08-21 | Pan and zoom a preview, on `react-zoom-pan-pinch`                      |

Each edit of this document adds a row at the top. The table keeps the last ten rows.

The project editor is the LTK Manager screen for work on one mod project. The core design
idea is an IDE for League mods. A user opens a project, reads its content, changes what the
mod declares, and packs the result.

The header row and the bar in it are drawn by the workshop shell over both of its routes, so
what they mean outside a project is [Workshop](WORKSHOP.md). This document describes them from
inside one.

## Goals

- A new modder can find the first step without a guide
- Each action has one clear place in the layout
- Features that do a lot stay simple to reach
- The layout follows an editor that most users already know

## Feature status

This table holds every major feature of the editor. A status word has one meaning.

- **Available** - the feature is in the application today
- **In progress** - work started, and the feature is not complete
- **Planned** - the team agreed on the feature, and work did not start
- **Proposed** - an idea for review, and not a decision
- **Blocked** - the team agreed on the feature, and a change outside this repository has
  to land first

| Feature                | Status      | Note                                                               |
| ---------------------- | ----------- | ------------------------------------------------------------------ |
| Layer file tree        | Available   | Moves to the secondary side panel                                  |
| Mod details document   | Available   | -                                                                  |
| String overrides       | Available   | -                                                                  |
| Tab strip, per project | Available   | -                                                                  |
| Tab context menu       | Available   | The four closes, copy path and copy name, and the splits           |
| Secondary side panel   | In progress | Holds the file tree and the asset inspector                        |
| Preview tabs           | Available   | A tab of its own, or one replaceable tab. A setting picks          |
| Tree search            | Planned     | Reads every layer, and groups a result by layer                    |
| Tab title prefix       | Planned     | `<layer>/<file>` when two tabs take the same name                  |
| Panel host choice      | Planned     | Either side panel accepts any panel type                           |
| Tree expansion rules   | Planned     | Stops the full expand of every directory                           |
| Layer conflict mark    | Planned     | No backend work, because the payload holds every layer             |
| Asset inspector        | Planned     | Takes the fields that a tree row cannot hold                       |
| Directory size and bar | Planned     | Needs a size total for each directory                              |
| File type filter       | Planned     | One of the three explorer filters. Uses the reported kind          |
| Explorer bar           | Proposed    | The location, the breadcrumb and the view controls, one row        |
| Breadcrumb navigator   | Proposed    | Crumbs with sibling menus, and `Ctrl+L` for a typed path           |
| Grid view              | Proposed    | One directory as tiles, in any of the three explorers              |
| Asset thumbnails       | Proposed    | A small mipmap over `ltk-asset`, at the tile's own width           |
| Details list           | Proposed    | The third view. Name, size, kind, and modified where it is         |
| Explorer sorting       | Proposed    | Name, size and kind, and the directories first                     |
| Multi-select and copy  | Proposed    | One model under every view. A directory is its files               |
| Image preview          | Available   | DDS and TEX through the `ltk_texture` crate                        |
| Preview pan and zoom   | Available   | Wheel, drag, pinch and double click, on the library                |
| Bin preview            | Planned     | Blocks over the parsed tree. [Bin editor](BIN_EDITOR.md)           |
| Mesh preview           | Planned     | A model in a small viewport                                        |
| Modified time          | Planned     | Needs a time field in the content scan                             |
| Game archive check     | Planned     | Finds a path that the game never reads. Uses the index             |
| Game browser           | In progress | One folded read-only tree. Search remains                          |
| Game index             | In progress | Folded, in memory and searchable. The mmap cache remains           |
| Scoped game browser    | Available   | One tab for each archive, from either list of archives             |
| Hash names from mimir  | Available   | The shared cache, synced from a Cache tab in the settings          |
| Copy into a layer      | In progress | The menu route writes a row or a directory. Three remain           |
| Shared chunk archives  | Proposed    | The index keeps every archive of a chunk, for the pick             |
| Copy conflict setting  | Proposed    | Ask, skip or replace. Ask is the default, and asks once            |
| Game clipboard         | Proposed    | `Ctrl+C` in a game browser, `Ctrl+V` into a layer                  |
| Held mark              | Proposed    | A game row that the selected layer holds. No backend work          |
| Extract to disk        | Available   | A row, a directory or an archive. Quick, or into a layer           |
| Extractor in `ltk_wad` | In progress | Pinned to the branch's rev. The release remains                    |
| Item drag              | Proposed    | Onto a surface to open, onto a layer to copy. Every view           |
| Property bin links     | Planned     | First declarative type. `league-mod` issue **#190**                |
| PTCH targeting         | Planned     | Second declarative type. `league-mod` issue **#191**               |
| Source control section | Planned     | Git history for the declarative data                               |
| Panel split layout     | Available   | A split tree, on `react-resizable-panels` seams                    |
| Per-project layout     | In progress | `.ltk/editor.json` is in, versioned. An in-app pass remains        |
| Project bar            | Available   | Takes the header's middle, from the project name title             |
| Command palette        | In progress | The project and the game are in. The bin objects remain            |
| Bin object search      | Planned     | The project's objects, and the install's behind the blocker        |
| Project object index   | Planned     | The layers' own bins, rebuilt with the content scan                |
| Bin object index       | Blocked     | The install's half. A lazy `ltk_meta` read comes first             |
| Bin dependency graph   | Proposed    | Kept by the object scan. `#190` is its first reader                |
| Navigation history     | Available   | The `←` `→` arrows, one stack for the whole workshop shell         |
| Quick open             | Available   | Absorbed by the project bar, which is the box it asked for         |
| Merged layer view      | Proposed    | Names the layer that wins for each path                            |
| Layer diff             | Proposed    | Compares one path across two layers                                |
| Problems list          | Planned     | One panel for every check. [Project problems](PROJECT_PROBLEMS.md) |
| Bin retype fix         | Planned     | Repairs the properties Riot changed to `File`. Urgent              |
| Preserved fix names    | Available   | A fix keeps every path it hashes in the mod's own `hashes/`        |
| Texture facts          | Available   | In the preview's status strip. The inspector row remains           |

## Scope

The editor separates two kinds of content, and treats them in opposite ways.

**Declarative data.** The project declares this data in its own configuration. The overlay
builder applies it when the manager patches the mod into the game. A user edits declarative
data in the editor.

**Assets.** These are the game files that the mod ships, such as a texture, a mesh or a
`.bin` file. The editor reads an asset and can show a preview. It does not change the bytes
of an asset. A user manages which files a layer holds, and edits a file itself elsewhere.

The [game browser](#game-browser) reads the assets of the installed game under the same
rule. It never writes into the game directory. A copy into a layer and an extract to disk
are its two outputs.

### Declarative data

| Data               | Status    | Order  | Reference                                 |
| ------------------ | --------- | ------ | ----------------------------------------- |
| String overrides   | Available | -      | -                                         |
| Property bin links | Planned   | First  | `LeagueToolkit/league-mod` issue **#190** |
| PTCH targeting     | Planned   | Second | `LeagueToolkit/league-mod` issue **#191** |

A property bin link lets a project declare the links to add to a `.bin` file, and the
target of each link. PTCH targeting lets a project declare a patch container and the
targets that receive it. The game client applies the patch under its own rules.

Property bin links come first in the editor. PTCH targeting follows it.

Both are future additions. The editor design for them comes later, and this document does
not describe one yet.

## Layout

The screen has four regions.

```
┌────────────────────────────────────────────────────────────────────────┐
│ ← →  ⌕ Workshop / Charizard Smolder X  v1.0.0   ⬓ ▷ Test  ⬚ Pack    ⋮  │
├────────────────┬──────────────────────────────────┬────────────────────┤
│  info  dir  ⑂  │ ⧉ charizard_circle.tex  ×    ⬓   │ base           446 │
├────────────────┼──────────────────────────────────┼────────────────────┤
│ ▾ CONTENT    2 │                                  │ ▾ assets           │
│   ▪ Base       │                                  │   ▾ characters     │
│   ▫ test       │          editor surface          │     ▾ hud          │
│ ▾ WADS       1 │                                  │       circle.tex   │
│   Smolder.wad  │                                  │       square.tex   │
│ ▾ STRINGS    1 │                                  ├────────────────────┤
│   default    1 │                                  │ INSPECTOR          │
│                │                                  │ 14.1 KB · DDS      │
└────────────────┴──────────────────────────────────┴────────────────────┘
  primary                 editor surface               secondary
```

1. The project header names the project and holds the actions that apply to the whole
   project.
2. The primary side panel is the navigation stack. It answers the question "what can I
   change in this mod?"
3. The editor surface holds the open documents behind a tab row.
4. The secondary side panel holds the file tree of the selected layer, and the inspector
   for the selected file. It answers the question "which file?"

Regions 2 to 4 together are the **content browser**. The project header is above the content
browser and is not part of it. The code uses the same name for the same region.

A user can hide each side panel. The layout control in the project header sets which side
each panel takes, and which panel shows.

This arrangement is the default. The [panel layout](#the-panel-layout) lets a user build a
custom arrangement instead.

## Project header

The header carries the project identity, the actions for the whole project, and the one
control that answers for the whole view.

| Control  | Meaning                                                                 |
| -------- | ----------------------------------------------------------------------- |
| `←` `→`  | Walks the project's navigation history                                  |
| Bar      | Names the project, and searches it. The crumb in it returns to Workshop |
| Layout   | Sets which side each side panel takes, and whether one shows            |
| Test     | Builds the overlay and starts the patcher                               |
| Pack     | Writes a distributable archive                                          |
| Overflow | Opens the project folder, or deletes the project                        |

The back arrow and the project name title are both gone. The bar took the name, the version
tag and the route back to the project list. Read [the project bar](#the-project-bar).

The row itself belongs to the shell, which draws the same five slots over the project grid and
refills them rather than swapping the chrome. What the slots hold there, and how the row
balances around the bar, is [Layout](WORKSHOP.md#layout).

## The project bar

The header's middle holds one control. It names the project while nothing is happening, and it
is the route to every file, every command and every path of the game as soon as a user types
in it. To its left are the two arrows that walk the navigation history.

The same control stands over the project grid, where it names the workshop and filters the
cards. Its three modes, and which one a click and `Ctrl+F` each land in, are
[The bar](WORKSHOP.md#the-bar).

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ←  →   ⌕ Workshop / Charizard Smolder X  v1.0.0   Ctrl+P    ⬓  Test  Pack  ⋮ │
└──────────────────────────────────────────────────────────────────────────────┘
  history        the project bar, idle                       view, and project
```

This replaces the project name that the header carried on the left. A title is the one thing in
a header that a user never clicks, and it held the widest part of the row. The bar reads as the
same identity and answers a question as well.

### Why one control

A project editor gathers a lot of routes. There is a file tree for each layer, a locale table
for each locale, a tree over 819,136 game files, a list of archives, the details form and the
actions of the header. Each has a place in the layout, and each costs a user two or three moves
to reach.

One box takes every one of them in a keystroke. This is the shape that Visual Studio Code,
GitHub and every browser use, so a user arrives already knowing it.

The bar removes no route. The primary side panel still lists the layers, the tree still holds
the files, and the game browser still opens from the project row. The bar is the fast path over
the same surface, and it is the one control a user needs to learn to find anything.

### The idle state

| Part        | Reads                                                        |
| ----------- | ------------------------------------------------------------ |
| Glyph       | A magnifier, so the box reads as a search and not as a title |
| Crumb       | `Workshop`, and a click on it returns to the project list    |
| Separator   | `/`                                                          |
| Name        | The project's display name                                   |
| Version tag | The version of the mod, as the title carried it              |
| Hint        | `Ctrl+P`, dim, at the trailing edge                          |

The crumb is what the back arrow of the old header did. Three arrow glyphs in a row is a row
that a user has to read twice, so the route out of the project moves into the bar and the two
arrows beside it mean one thing.

The bar takes the width between the history arrows and the action group, to a limit of 720px,
and centers itself in that space. A window twice as wide does not want a search box twice the
width, because a path is the longest thing the box ever holds.

### The expanded state

A click on the bar, or `Ctrl+P`, turns it into the input. The crumb and the version tag give
way to the caret, the results drop below the bar at the bar's own width, and a scrim dims the
editor under them. `Escape` returns the bar to idle.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ←  →   ⌕ aatrox_base                                        ⬓  Test  Pack  ⋮ │
└────────┬────────────────────────────────────────────────────┬────────────────┘
         │ FILES · base                                     3 │
         │  ▣ aatrox_base_tx_cm.dds                           │
         │    assets/characters/aatrox/skins/base             │
         │  ▣ aatrox_base_mat.bin                             │
         │    assets/characters/aatrox/skins/base             │
         │ COMMANDS                                         1 │
         │  ▷ Test the project                       Ctrl+F5  │
         │ GAME · 456 archives                            412 │
         │  ▣ aatrox_base_tx_cm.dds                           │
         │    assets/characters/aatrox/skins/base   Aatrox.wad│
         │  … 409 more                                    Tab │
         └────────────────────────────────────────────────────┘
```

A row carries the name, a dim path under it and its source at the trailing edge. The matched
characters of the name and of the path are marked. A group header names its source and the
count of what matched, and a group is capped so no source pushes another off the list.

### What it searches

| Source    | Rows                                            | Where the data is        |
| --------- | ----------------------------------------------- | ------------------------ |
| Files     | Every file of every layer                       | The content tree query   |
| Layers    | The layers of the project                       | The project record       |
| Strings   | The keys and values of every locale override    | The layer content        |
| Documents | The open tabs                                   | The editor store         |
| Commands  | The actions of the header, the editor, settings | A registry               |
| Game      | Every file of the installed game                | The backend's game index |
| Objects   | Every bin object the install declares           | The bin object index     |

Files reads every layer and not the selected one, the rule the [tree search](#search) already
obeys. A result names the layer that holds it, because a relative path is the same string in
every layer.

Game is the source with a cost. Read [The scan of the game](#the-scan-of-the-game).

Objects is the source with a blocker. Read [The bin object index](#the-bin-object-index).

### The setting

The Project editor section of the settings gains one row, **Search the game**. Every source is
on by default.

One switch rather than one per source, because Game is the only one that costs anything. The
rest read what the frontend already holds, so a switch on any of them would save a scan of a
few thousand rows that nobody can measure and would leave a user wondering why a file they can
see in the tree does not come back.

The switch that matters is Game. A modder who never copies a game file pays nothing for the
scan, and a modder who does gets the whole install in the same box as their own project. The
setting belongs to the application and not to the project, because it describes how a user
works rather than what a project holds. It sits beside **Opening a file** in the same section,
and `workshopLayout` persists it.

### Scopes

A user narrows the box to one source, and there are two ways to ask.

- `Tab` on a highlighted row scopes to that row's source. `Tab` on a group's `… n more` row
  does the same for the whole group
- A prefix typed at the start of the query scopes without a highlight

| Prefix | Scope                                                                 |
| ------ | --------------------------------------------------------------------- |
| `>`    | Commands                                                              |
| `#`    | The string override keys of the project                               |
| `$`    | The bin objects of the install                                        |
| `@`    | Inside the active document, so a tree's directories or a table's keys |
| `?`    | A list of these prefixes                                              |

A scope shows as a chip before the caret. `Backspace` on an empty query removes it. Game has no
prefix, because it is in the default result set and `Tab` reaches it.

`Ctrl+Shift+P` opens the bar with the Commands scope already set, which is the binding a user
brings from Visual Studio Code. `Ctrl+K` is an alias of `Ctrl+P`.

### Keys

| Key            | Does                                                |
| -------------- | --------------------------------------------------- |
| `Ctrl+P`       | Opens the bar. `Ctrl+K` is the same                 |
| `Ctrl+Shift+P` | Opens the bar in the Commands scope                 |
| `↑` `↓`        | Moves the highlight, across a group header          |
| `Enter`        | Runs the row's action                               |
| `Ctrl+Enter`   | Opens into a group beside the focused one           |
| `Alt+Enter`    | Opens as a permanent tab while the reuse mode is on |
| `Tab`          | Scopes to the highlighted row's source              |
| `Backspace`    | Removes the scope chip, on an empty query           |
| `Escape`       | Returns the bar to idle                             |

An empty query lists the documents of the history, most recent first, and then the commands.
`Ctrl+P` and `Enter` is therefore the switch back to the last file, with no query typed.

### Commands

A command is a record, and the module that owns the action owns the record.

```ts
interface ProjectCommand {
  id: string;
  title: string;
  group: string;
  /** Words a user might type that the title does not hold. */
  keywords?: readonly string[];
  shortcut?: string;
  /** False greys the row and states why. A pack with no layers cannot run. */
  enabled?: boolean;
  run: () => void;
}
```

`useProjectCommands` composes the list out of the modules' own hooks, so a command closes over
the real mutation rather than over a copy of it. Nothing registers into a global table at
import time, and a command that needs project state reads it the way every other panel does.

The first set is the actions the editor already holds: Test, Pack, Open project folder, Delete
project, Mod details, Game index, Game WADs, Rebuild the game index, Reset the layout, Split
right, Split down, the four closes, and the routes into the settings.

## The scan of the game

The project holds hundreds of files and the install holds 819,136. One box reads both, and the
two want opposite treatment.

**Whatever the frontend already holds, the frontend matches. Whatever only the backend holds,
the backend matches.** The content tree query returns every layer's files already, the store
holds the open tabs, and the command list is built in the frontend. The game index lives in
Rust and its paths never cross IPC as a whole. This gives one scorer in each language, which is
not a duplication this design creates. Each side needs a scorer whatever the other side does.

### The project side

A project of a few thousand candidates needs no index. A scan of a flat array per keystroke is
well under a frame, and the cost that shows up is not the matching.

- One flat array of candidates, built with `useMemo` from the content tree, the layers, the
  locales, the open tabs and the commands
- Each candidate carries its lowercase forms, computed once at build. A `toLowerCase` per row
  per keystroke is the real cost, and this removes it
- Each candidate carries a 32-bit mask of the letters it holds. A query whose mask is not a
  subset of a candidate's cannot match, so one `AND` rejects most rows before the matcher reads
  a character
- The scan runs in the render pass. A worker is the answer to a measurement, and no measurement
  asks for one yet

### The backend side

The backend answers a query and returns the top rows. The frontend debounces by 120ms, keeps
the previous game section on screen while the next one arrives, and renders the project rows
without waiting for either.

`GameIndex` holds a directory arena, and each directory holds its files. A search wants a flat
list of paths, and building 819,136 of them for each query would allocate more than the match
costs. Three things make the scan cheap instead.

1. **A letter mask on each file and each directory.** A file's mask covers its name. A
   directory's mask covers its own path, and a second mask covers the union of its subtree. A
   query mask that is not a subset of the subtree mask skips that subtree whole, and a query
   mask that is not a subset of `directory path mask | file name mask` skips that file before
   its path is built. `File` is 48 bytes today, of which four are padding, so the mask on a file
   costs nothing at all.
2. **One reusable buffer.** The walk is depth first and pushes and pops a segment on a single
   `String`, so a path that survives the mask is built with no allocation.
3. **A bounded heap.** A fixed min-heap of the top 100 by score. Nothing sorts a million rows.

A query carries a generation, and an `AtomicU64` beside the index holds the newest one. The
scan tests it every few thousand files and returns nothing once it is stale. Without this a
ten-character query queues ten full scans, and the last of them is the only one anybody wants.

The command runs on `spawn_blocking`, the way `read_dir` and the index build already do.

### Ranking

Both scorers obey one rule, and a fixture of query and candidate pairs is checked into both
test suites so the two agree on order.

A query is split on whitespace, and every term has to appear as a run of characters. This is the
search a file manager does, and the one a modder expects of a path.

| Signal                                              | Effect                                        |
| --------------------------------------------------- | --------------------------------------------- |
| The file name opens with the query                  | Highest band                                  |
| Every term is somewhere in the file name            | Second band                                   |
| The terms are found over the directory part as well | Third band                                    |
| A term begins after `/`, `_`, `.`, `-` or a capital | A bonus, for each                             |
| A term is a whole word rather than part of one      | A bonus, for each                             |
| A term appears nowhere in the candidate             | No match at all                               |
| The candidate is in the selected layer              | A bonus                                       |
| The candidate is in the navigation history          | A bonus, decaying with its depth in the stack |
| Two candidates score the same                       | The shorter path wins                         |

### The budget

These are targets and not measurements. The install they are sized against is the one that
[the game index](#the-game-index) measures, at 456 archives and 819,136 files.

| Stage                                     | Budget                                      |
| ----------------------------------------- | ------------------------------------------- |
| A keystroke to the project rows on screen | 16ms                                        |
| A keystroke to the game section           | 150ms, of which 120ms is the debounce       |
| The search structure of the game index    | Built with the index, in no extra pass      |
| The memory the masks add                  | Nothing on a file, 240KB on the directories |

**A subsequence match is the wrong default here, and this is what replaced it.** `nasus` has its
five letters in that order inside nearly every long asset path, so as a subsequence it matched
137,032 files of a live install and buried the four a modder wanted. Scoring alone did not
rescue it: the good rows outscored the noise, and there was still a wall of noise under them.
Requiring a run removes the question. A fuzzy mode can come back as a setting if anyone asks for
one, and it is not the default.

Groups are ordered by their own best row rather than by a fixed source order, for the same
reason: a project holding no `nasus` still answers with whatever it can scatter the query
across, and a fixed order put that above the install's own `nasus.bin`. The declared order is
the tiebreak.

A trigram index over the game paths is the escalation, and it is not the first move. It costs a
build pass and a hundred megabytes, and it serves a substring query rather than the subsequence
query a palette asks for. A pruned linear scan over 819,136 short strings is interactive
already, and a measurement is what should buy anything more.

## The bin object index

The game's content is not authored as files. It is authored as objects with paths, and the
`.bin` files are how the packaging step ships them. Riot describes that split in
[Content efficiency and the game data server][gds], where the game data server addresses
content by path and the file that carries it stops being the interesting part.

[gds]: https://www.riotgames.com/en/news/content-efficiency-game-data-server

A modder works the same way. The thing they want is
`Characters/Aatrox/Skins/Skin0/Resources`, and the question they have to answer first is which
`.bin` declares it - one of the install's 42,306, or one of their own project's. Nothing in the
manager takes that string today. [The project bar](#the-project-bar) is the box that should.

The source is worth its own section because it is the one search source with a build behind it
that the manager does not have yet, and because that build waits on a change to `ltk_meta`.

### What a row is

```
│ OBJECTS · 359,095                                       12 │
│  ◈ Characters/Aatrox/Skins/Skin0/Resources                 │
│    SkinCharacterDataProperties     Aatrox.wad/…/skin0.bin  │
│  ◈ Characters/Aatrox/Skins/Skin0                           │
│    SkinCharacterDataProperties     Aatrox.wad/…/skin0.bin  │
```

| Part   | Reads                                                                |
| ------ | -------------------------------------------------------------------- |
| Name   | The object's path, with the matched characters marked                |
| Class  | The class the object declares, such as `SkinCharacterDataProperties` |
| Source | The `.bin` that declares it, and the archive or the layer it is in   |
| An `n` | The count of declaring files, where more than one declares it        |

`Enter` opens the declaring `.bin`. Until the [bin preview](#planned-document-types) lands
that means revealing the file in its explorer, which the
[location](#the-location) makes one call. With the preview it means opening the file and
scrolling to the object, which is a position the
[navigation history](#the-position-a-document-restores) can restore.

An object that no hash table names still has a row, under its hash in hex. A query of eight
hex digits is looked up in the index directly rather than matched, because a modder holding a
hash pasted it out of another tool.

### The two halves

**The names come from the mimir cache. The locations come from a scan of the install.** Neither
half holds the other's data, and this is what keeps the whole feature cheap.

| Half      | Holds                                    | Costs                                         |
| --------- | ---------------------------------------- | --------------------------------------------- |
| Names     | Every object path CommunityDragon knows  | Nothing. The cache is shared                  |
| Locations | Object hash to the files that declare it | A scan of the install, and one of the project |

The `binentries` table of the [mimir cache](#hash-names) holds 421,835 object paths in 2.2MB
on disk, and the manager already opens that cache for the WAD path tables. A bin object path
hashes to 32 bits, so the table answers hash to name and `hash_path` answers name to hash.

The scan answers the other direction. It reads what each `.bin` declares and keeps
`(object hash, class hash, file)`, and nothing else. 383,357 declarations at 12 bytes is
4.6MB.

The palette therefore matches a query against the table's strings and turns each survivor into
a file through the index. The install declares 359,095 distinct objects and the table names
325,357 of them, so the two agree on nine rows in ten. A name the install does not declare
never reaches the list, because the index answers no file for it.

### The project's own objects

The install is one source of locations. The project is the other, and it is the one a modder is
editing.

A layer's `.bin` files are loose on disk, and a project holds tens of them rather than 42,306.
That changes three things.

|            | The install                         | The project                                |
| ---------- | ----------------------------------- | ------------------------------------------ |
| The reader | Waits on the blocker below          | Either one. The eager read runs at 250MB/s |
| The build  | 42,306 files, kept in the cache     | Rebuilt with the content tree query        |
| The match  | Rust, and the rows stream in behind | The frontend, in the same frame            |

The third row is the seam that [The scan of the game](#the-scan-of-the-game) already draws.
Whatever the frontend holds, the frontend matches. The project's objects cross IPC once with
the content scan, so a few hundred bins declaring a few thousand objects become a smaller array
than the file list beside it, and the rows render without a debounce.

The first row is why this half ships first. A project's bins are megabytes, and 250MB/s is what
the reader the manager can call today costs, so the project half never waits on `ltk_meta`. A
modder who wants to find an object in their own mod gets it before the install's half exists.

**A layer row names its layer**, the way a Files row does, and the group is its own.

```
│ OBJECTS · Charizard Smolder X                            2 │
│  ◈ Characters/Smolder/Skins/Skin0                          │
│    SkinCharacterDataProperties    base · overrides Smolder │
│ OBJECTS · game                                          12 │
│  ◈ Characters/Smolder/Skins/Skin0                          │
│    SkinCharacterDataProperties    Smolder.wad/…/skin0.bin  │
```

An object that both sides declare is an override, and the row says so. That line is the
cheapest answer the editor has to "does my mod already change this?", and it costs a lookup in
the install's index against a hash the project's index already holds. The
[merged layer view](#ideas-for-review) answers the same question for files.

**The scan runs with the content tree query and keeps nothing.** A modder edits a `.bin` in
Visual Studio Code and comes back, so an index that outlives that edit is an index that lies.
The refresh control of the layer document already reloads the content tree, and the objects
come with it. Nothing about the project is written into `.ltk`, and no checksum decides what to
rebuild, because rescanning a project's bins is cheaper than working out which one moved.

**A path a modder invents has no string anywhere.** A bin stores the hash and not the path, so
an object nobody has published a name for reads as hex even in the modder's own project.
`LayeredHashDb` takes an overlay over its base tables, which is where a project-local list of
names belongs. Nothing writes one today.

### The scan, and the reader it needs

A `.bin` is a header, a list of class hashes, and then the objects. Each object is a `u32`
length, a `u32` path hash, and then its properties.

```
PROP                   the magic, or PTCH and then PROP        read
version                1 to 3                                  read
dependencies           a count, and a sized string for each    read
object count           u32                                     read
[class hash] × count   u32 each, in object order               read
  size        u32      the length of the object's body         read
  path hash   u32      what addresses the object               read
  properties           the object itself                       seek past
```

The scan wants eight bytes of each object and none of the rest. `ltk_meta::Bin::from_reader`
reads all of it: an `IndexMap` for each object, a `PropertyValueEnum` for each property, and a
`String` for each string. Over the same 194.8MB of already-decompressed bins, the header scan
costs **3.1ms** and the full parse costs **760ms**. That is 242 times the work for a field the
header carries anyway.

Over a whole install the difference is the whole feature. The scan adds 14ms to a build that
spends its time in zstd, and the full parse would add about nine seconds to it.

### What has to land first

**`ltk_meta` has no lazy read, and this is the blocker.** The right place for it is upstream
rather than a second bin parser in this repository. The format belongs to `ltk_meta`, every
other LeagueToolkit tool wants the same read, and a private copy is a second thing to keep
current with the format.

The shape the index needs:

```rust
/// What a bin declares, without reading a property.
pub struct BinHeader {
    pub is_override: bool,
    pub version: u32,
    pub dependencies: Vec<String>,
}

/// One object, as its header names it.
pub struct BinObjectHeader {
    pub path_hash: BinHash,
    pub class_hash: BinHash,
    /// Where the body starts, and how long it is, so a reader can seek past it.
    pub offset: u64,
    pub size: u32,
}

impl Bin {
    /// Read the header and every object header, and no property.
    pub fn scan<R: Read + Seek>(reader: &mut R) -> Result<BinScan<'_, R>, Error>;
}
```

`BinScan` iterates `BinObjectHeader`, and a second call materialises one object from its
header. That is the lazy resolution the rest of the editor wants as well.

| Reader               | Wants                                        |
| -------------------- | -------------------------------------------- |
| The object index     | Every object header, and no property         |
| The bin preview      | Nothing. It parses one file eagerly          |
| Property bin links   | The objects of one file, to offer as targets |
| The linked bin check | The dependency list alone                    |

Two of those four read a header and no more, so the eager read is the wrong default for most
readers the manager has. The [bin editor](BIN_EDITOR.md#the-parse-is-not-the-problem) is the
exception, and it needs no part of this: one file parses in single-digit milliseconds, so it
ships on `ltk_meta` as published and takes the lazy read later as an optimisation.

`ltk_meta` is not a dependency of this workspace yet. It is `MIT OR Apache-2.0`, which is the
workspace's own license, so adding it needs a `pnpm generate:licenses` and nothing else.

### The build, measured

The install is the one the rest of this document measures, at 456 archives and 939,329 chunks.

| Measurement                               | Value                             |
| ----------------------------------------- | --------------------------------- |
| `.bin` chunks                             | 50,390, and 42,306 after the fold |
| What they hold                            | 2,261MB, decompressed             |
| The build, on a cold file cache           | 4.7s                              |
| The build, on a warm one                  | 1.3s                              |
| Of which the header scan                  | 14ms                              |
| Object declarations                       | 383,357                           |
| Distinct objects                          | 359,095                           |
| Named by the mimir table                  | 325,357, which is 90.6%           |
| Declared by more than one file            | 5,965                             |
| Distinct classes                          | 539                               |
| Dependency edges                          | 121,665, of which 116,201 resolve |
| Files that would not scan                 | 3                                 |
| The index, at 12 bytes a declaration      | 4.6MB                             |
| Resolving every hash to its name, at load | 200ms, for 21.1MB of names        |

The build is decompression and nothing else. Every millisecond above belongs to zstd, so the
work parallelizes across archives the way the game index build already does.

Three files of 42,306 fail to scan. A file that will not scan is skipped and logged, and it
never fails the build, because a build that stops on one bad chunk in an install of a million
is a build that never finishes.

### Where it is kept

The object table is a section of the memory-mapped cache that
[One cache, not two](#one-cache-not-two) describes, under the same archive checksums. A game
patch rebuilds the archives it changed and no others, and a format version in the header
forces a full rebuild when this manager writes the section differently.

**The cache holds hashes and no names.** The mimir tables update on their own schedule, so a
name written into the cache today is a name that can be wrong tomorrow. Resolving all 359,095
hashes at load costs 200ms against a table that is already mapped, which is less than the
cost of keeping a second copy correct.

### The dependency graph

A bin header names the files it imports, and the scan reads 121,665 of those edges on its way
past. **No search reads one.** The graph is worth keeping anyway, because it is the byproduct
of an expensive pass and the answer to a question the editor cannot answer at all today.

| Measurement                                     | Value                                               |
| ----------------------------------------------- | --------------------------------------------------- |
| Edges                                           | 121,665                                             |
| Resolving to a file the install ships           | 116,201, which is 95.5%                             |
| Naming a directory rather than a file           | 5,430, such as `Characters/PetBunny`                |
| Naming a `.bin` the install does not ship       | 34                                                  |
| Files with a dependent                          | 13,780                                              |
| Roots, meaning no dependent and some dependency | 25,911                                              |
| Isolated, meaning neither                       | 2,615                                               |
| A closure, on average                           | 5.5 files and 57 objects                            |
| The deepest chain                               | 5                                                   |
| The widest closure                              | 41 files, from `characters/evelynn/skins/skin0.bin` |
| Every closure in the install, computed          | 2.5ms                                               |
| The graph, at 8 bytes an edge                   | 0.9MB                                               |

An edge costs no string. A dependency is written as `DATA/Characters/Aatrox/Aatrox.bin`, which
is the archive path of the file it names, so the manager hashes it the way a WAD path hashes and
looks the result up in the game index. What survives is a pair of file ids.

The 5,430 that name no file are a second convention. `Characters/PetBunny` is not a path, and
the game resolves it by a rule this document does not know, so the index records those edges as
unresolved rather than guessing at one. The 34 that do name a `.bin` and still miss are the
interesting ones, because those are dependencies on content the install does not carry.

### Why the closure is not folded in

Folding a dependency's objects into the roots that reach them turns 383,357 declarations into
1,472,453 object-by-root pairs. Four times the storage is survivable, so that is not the
argument.

**The argument is the last two rows of the table.** Every closure in the install computes in
2.5ms over a graph of 0.9MB. A derived fact that cheap is one to compute, and storing it buys
nothing but a second thing to invalidate.

The fold also destroys the fact a search result needs. "Declared by" names the file to open in
order to change the object. "Reachable from" names the roots that load it. One row cannot carry
both, and a modder clicking a result wants the first.

So the index stores the edges in both directions and answers reachability as a query.

| Question                       | Reads                                  |
| ------------------------------ | -------------------------------------- |
| What does this file import?    | The forward edges of one node          |
| What imports this file?        | The reverse edges of one node          |
| Which roots reach this object? | A reverse walk, over a graph five deep |
| What does this root load?      | A forward walk, 5.5 files on average   |

### What the graph is for

Not search. A palette row that said "in 47 roots" would be noise in the one place that has to
stay legible. The graph answers whether a reference resolves when the game loads it, which is a
different question with a different reader.

| Reader                                    | Asks                                                          |
| ----------------------------------------- | ------------------------------------------------------------- |
| Property bin links, `league-mod` **#190** | Which objects may this file link to, given what it imports?   |
| The problems list                         | Does a link point into a file that no root of this mod loads? |
| The linked bin check                      | Which files does this one need, so a mod ships all of them?   |
| The bin preview                           | What this file imports, as a header a reader can follow       |

The link picker is the case that pays. A link into a file the root never loads does nothing in
the game and passes every check the manager has, which is the failure the
[game archive check](#requirements) exists to catch for paths. The graph makes the same check
possible for links: offer the objects the file already reaches first, and warn on the rest.

None of that blocks the object index. The edges are stored because the scan reads them anyway,
and the first reader arrives with **#190**.

### Searching it

The project's objects match in the frontend, on the array the content scan already sent. The
install's match in Rust, because 325,357 names are not an array to send anywhere. Two scorers
for one source is the seam the palette already has for files, and not a second one.

The install's name side is a scan of the same shape as [the project side](#the-project-side),
over 325,357 candidates rather than a few thousand.

- One name list, built once from `get_batch` over the index's hashes. 21.1MB of text and
  10 bytes of offsets for each entry
- A 32-bit letter mask on each name, so one `AND` rejects most rows before the matcher reads a
  character
- The bounded heap and the generation token of [the backend side](#the-backend-side), because
  this scan runs in Rust beside the game one and answers the same command

| Stage                                | Budget                                       |
| ------------------------------------ | -------------------------------------------- |
| A keystroke to the project's objects | 16ms, in the render pass                     |
| A keystroke to the install's objects | 150ms, of which 120ms is the debounce        |
| The scan itself                      | Under a frame, at a third of the game's rows |
| The memory the name list holds       | 25MB, resident while the palette is used     |
| The memory the index holds           | 4.6MB, mapped                                |

Ranking follows [the same table](#ranking), with one addition. A segment boundary in an object
path is `/`, and the last segment is what a modder types, so a match in it takes the prefix
band that a file name takes.

### The scopes it adds

| Prefix | Scope                                             |
| ------ | ------------------------------------------------- |
| `$`    | Every bin object, the project's and the install's |
| `@`    | Inside an open `.bin`, the objects of that file   |

`@` already means "inside the active document". A bin document's contents are its objects, so
the scope needs no new rule and the index answers it as a range rather than a search.

**What the search reads** gains an Objects switch beside Game. The index is not built while
that switch is off, so a modder who never touches a `.bin` pays nothing for it.

### What it gives the rest of the editor

| Feature                                   | What the index supplies                          |
| ----------------------------------------- | ------------------------------------------------ |
| Property bin links, `league-mod` **#190** | The picker for a link's target                   |
| PTCH targeting, `league-mod` **#191**     | The picker for a patch's target                  |
| The bin preview                           | The outline of a file, without parsing it        |
| The linked bin check                      | A dependency edge that is read rather than found |
| The problems list                         | A link no file declares, or that no root reaches |

The two declarative types are the reason to build this before it is only a search source. Both
ask a modder to name an object, and a text field that accepts any string is a text field that
accepts a typo. A picker over 359,095 real objects does not.

### When a half is missing

| Missing             | The palette still                                      |
| ------------------- | ------------------------------------------------------ |
| The mimir tables    | Matches no name. A pasted hash still finds its file    |
| The install's index | Answers for the project alone                          |
| Both                | Drops the object groups, the way any empty source does |

The second row is not a failure. It is where the editor sits between step 1 and step 3 below,
and a modder searching the objects of their own mod needs neither the install's scan nor the
change upstream.

### What ships in what order

| Step | Holds                                                                         |
| ---- | ----------------------------------------------------------------------------- |
| 1    | The project's own objects, on the reader that exists, and the `@` scope       |
| 2    | `ltk_meta::Bin::scan` upstream, which is the blocker for everything below     |
| 3    | The install's scan, its cache section, and the override line on a project row |
| 4    | The `$` scope, and the object pickers that **#190** and **#191** want         |

Step 1 is navigable on its own and blocks on nothing. A modder searches the objects of the mod
they are editing, which is the half they ask for most, and the install's half follows the
upstream change.

## The navigation history

The two arrows to the left of the bar walk one stack, and it spans the workshop shell rather
than sitting under each project - a stop is a document in a named project or the project grid
itself, and a back that lands in another project routes to it. Read
[the navigation history](WORKSHOP.md#the-navigation-history). This is the Go Back of Visual
Studio Code and not the Back of a browser, so it answers where a user was in the editor rather
than which page the application showed.

```ts
interface HistoryEntry {
  documentId: string;
  leafId: string;
  /** Opaque to the stack. The document that wrote it is the one that reads it. */
  position: unknown;
}
```

What ships holds the document id alone. A document sits in exactly one group, so the group is
a lookup rather than a field, and no document supplies a position yet. The two return with
[the position a document restores](#the-position-a-document-restores).

| Rule                                                      | What the stack does                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------ |
| An open, an activate, a focus, a reveal or a palette jump | Pushes an entry                                                          |
| A scroll                                                  | Nothing. A position is read at a push and not at a move                  |
| The same document pushed twice in a row                   | Replaces the top entry's position                                        |
| A move after a back                                       | Drops the forward part, the way a browser does                           |
| A document closes                                         | Its entries leave the stack, so a back never lands on a tab that is gone |
| The stack passes 50 entries                               | The oldest one goes                                                      |

`Alt+←` and `Alt+→` are the keys, and the mouse's fourth and fifth buttons do the same. An
arrow with nothing behind it is disabled, and the tooltip of a live arrow names what it returns
to.

The stack belongs to the session. `.ltk/editor.json` holds the documents and the layout, which
is where a user left the project, and a history is how they got there. Restoring it a day later
hands a user a back button into a session they no longer remember.

### The position a document restores

A document supplies its own position through `useDocumentPosition(documentId, read, restore)`.
The store keeps the reader in a ref map and calls it at a push. A document kind that supplies
nothing restores its scroll and no more.

| Document     | Position                                   |
| ------------ | ------------------------------------------ |
| Layer files  | The scroll offset and the selected row     |
| Strings      | The row index                              |
| Game index   | The scroll offset and the open directories |
| Game archive | The same                                   |
| Mod details  | The scroll offset                          |
| Preview      | Nothing. A preview holds one view          |

## Building the palette

The palette is a component of `@/components`, on the primitives the repo already wraps.

```
@/components/CommandPalette.tsx
  ├─ Dialog          the base-ui wrapper that is already there
  ├─ useVirtualizer  @tanstack/react-virtual, already a dependency
  └─ useListNav      ↑ ↓ ⏎ esc, and aria-activedescendant
```

`cmdk` was the first candidate. It is the right library for a palette over a menu of items and
the wrong one for this surface. Its value is its scorer and its list, and this design uses
neither. The scorer runs in the DOM over mounted rows, and a section over the game index cannot
mount its rows. Turning the filter off with `shouldFilter={false}` leaves the keyboard model,
which `useListNav` is sixty lines of. `Command.Dialog` would also pull a second dialog
implementation in beside base-ui, against the rule that module code reaches base-ui through
`@/components` alone.

### Accessibility

A virtualized listbox holds a window of its rows, so a row has to say where it sits.

- The input is `role="combobox"`, with `aria-expanded`, `aria-controls` and
  `aria-activedescendant`
- The list is `role="listbox"`, a group is `role="group"` with `aria-labelledby` on its header,
  and a row is `role="option"`
- Each row carries `aria-setsize` and `aria-posinset`, because the DOM holds a window and not
  the list
- Focus never leaves the input. The highlight moves through `aria-activedescendant`

### What ships in what order

| Step | Holds                                                                      | Status  |
| ---- | -------------------------------------------------------------------------- | ------- |
| 1    | The bar, the crumb, the history arrows, and the project sources            | Shipped |
| 2    | The game source, its Rust scorer, and the generation token that cancels it | Shipped |
| 3    | The scope chips, the `@` scope, and the settings row                       | Part    |
| 4    | The Objects source, once [its index](#the-bin-object-index) is buildable   | -       |

Step 1 needs no backend change at all. Every source it reads is in the frontend already.

Step 3 came forward as far as its sources allow. The chips, the `>` and `#` prefixes, `?` and
`Tab` all ship with step 1, because a scope costs little once the sources are a list. The
settings row ships with step 2, as the one switch that pays for itself. The `@` scope waits on
a document that can answer for its own contents.

### What it replaces

The [quick open](#search-and-the-project-bar) proposal. The bar is the floating box that proposal
asked for, in a place a user can see rather than behind a shortcut somebody has to tell them
about.

It replaces no search box. The tree's box filters the tree in place, which is a read of the
structure around a result, and the game browser's box does the same for its own tree. The bar
is the route straight to one thing. The two shapes answer different questions, and one
candidate array feeds both.

## Primary side panel

The primary side panel is the map of the project. It shows every route into the mod, so a
new user reads the whole surface at one look.

### Project row

The top row holds the routes that stay on screen whatever the selected layer is, and
whatever the editor grid holds.

| Control              | Meaning                                                      |
| -------------------- | ------------------------------------------------------------ |
| Mod details          | Opens the metadata editor as a document                      |
| Game index           | Opens the game browser as a document                         |
| Open project folder  | Shows the project directory in the file manager              |
| Source control (Git) | Version control for the declarative data. Under construction |

The metadata editor holds the display name, the version, the description, the thumbnail,
the categorization and the authors. It is a document and not a dialog, so a user can keep
it open beside a layer and switch between the two.

Source control gives a mod a history. A user can see what changed since the last known good
build, and can return to it. This suits a mod project, because the layers hold text data
definitions as well as binary assets. The implementation is out of scope for this document.

### Content

The Content section lists every layer in the project. A click on a layer selects that layer.
The secondary side panel then shows the files of that layer.

A layer is the unit a modder thinks in. The base layer is the content that the project
starts from. Each other layer is a variant that the patcher can apply on top.

### WADs

The WADs section names the game archives that the selected layer changes. It reads the
files of the layer and groups them by their target WAD.

This section adds no new data. It answers one question that the file tree answers slowly.
The question is "which parts of the game does this layer touch?"

An archive row keeps its click for the file tree, and a hover action on the row opens a
[scoped game browser](#scope-to-one-archive) for it. The section then answers a second
question, which is "what else does that archive hold?"

### Strings

The Strings section lists the locales that the selected layer overrides. A click on a
locale opens a table of key and value pairs.

A string override is declarative. The manager applies the override when it patches the mod
into the game, so the mod does not ship a full translation file.

## Secondary side panel

The file tree is navigation and not a document. A tab holds work that a user reads or edits,
and a file tree is neither. The tree also stays open for a whole session, so a tab for it
costs the surface and returns nothing.

The secondary side panel gives the tree a home. A click in the tree opens the file in the
editor surface. This is the shape that Visual Studio Code uses, and most users know it
already.

The panel holds no other view today. It is still a generic host and not a file tree with a
border, so it accepts any panel from the [panel types](#panel-types) list. The primary side
panel accepts the same list, and a user can put the file tree there instead.

This is the cheap form of the [panel layout](#the-panel-layout). A user chooses which panel
hosts which view, and a sash sets the width.

### File tree

The tree shows one layer at a time. The selection in the Content section sets the layer. A
search is the one exception, and it reads every layer.

- A directory row shows the count of the files below it
- A file row shows an icon for the file type, and the size of the file
- A run of directories that each hold one directory folds into one row
- The tree renders through a virtualizer, so the file count does not change the cost

#### What a row's menu holds

- **Open**, on a file row, which is the menu's route to what a double click does
- **Open in VS Code**, on a property bin, when the ritobin integration is set up
- **Copy Name** and **Copy Relative Path**
- **Reveal in Explorer**, on the row's own path
- **Delete**, on `Del`

#### Deleting a row

A delete takes what the row names. A file row takes the file, a directory row takes the
directory and everything below it, and a folded row takes the whole run its name spells out.

Every delete is confirmed, and not only the ones that look expensive. A layer file is often
the only copy of an edit and nothing here reaches the recycle bin, so being wrong costs the
same either way. What the confirmation varies is how much it says is going, and a
directory names the count of files below it before the button is in reach.

The confirmation opens on the row rather than in the middle of the screen. A tree is a
place as much as it is a list, and a modal in the centre asks the reader to carry the
row's identity across the gap and back. Anchored, the answer stands next to the question.

Everything else dims behind it, and the row itself is cut out of the dim. Blurring the row
the popover is pointing at would undo what the anchoring bought, so the scrim is drawn as
four strips around the row, with a ring on it to keep the gap from reading as a seam.

The path leads the popover, set on its own as mono text rather than quoted inside the
prompt. A folded row spells out five or six segments, and a path wrapped mid-segment
inside a sentence reads as prose, when it is the one thing on screen a reader has to check
character by character. The part the delete takes is the bright tail of it, and whatever
stays behind is dim.

The directories a delete empties go with it, up to the layer root. The listing is built from
files, so a directory holding none has no row and no size, and one left behind is a folder
the tree cannot show. It would still be what makes the layer read as non-empty to the
project validator.

### Search

A layer holds hundreds of files. A search box at the top of the panel is the fastest route
to one of them.

The box reads every layer of the project, and not the selected layer alone. A modder does
not always know which layer holds a file, and a search that reads one layer answers with
nothing in that case.

- The box matches the full relative path, and not the file name alone
- A match keeps every parent directory of the match, so the result is still a tree
- The tree expands to each match, and marks the matched part of each name
- A result groups under the name of the layer that holds it
- An empty box returns the tree to the selected layer
- `Ctrl+F` and `/` move the focus to the box

The layer group row is what a search across layers needs. A relative path is the same
string in every layer, so a flat result list cannot say which layer a row came from.

#### Search and the project bar

This box and [the project bar](#the-project-bar) read the same data. One candidate array
feeds both, and the two differ only in the front end.

| Route       | Shape                                     | Suits                                     |
| ----------- | ----------------------------------------- | ----------------------------------------- |
| Search box  | Filters the tree in place                 | A read of the structure around the result |
| Project bar | A list under the header, and every source | A keyboard route straight to one thing    |

The quick open proposal is the bar. A floating box behind a shortcut asks a user to be told
that it exists, and a bar in the header does not.

### Expansion

The tree expands every directory today. For a layer with 446 files this fills the panel with
rows that carry no information, and a user scrolls before the first read.

- The first render expands to the first directory that holds more than one child
- An expand-all control and a collapse-all control are in the panel header
- `Alt` and a click on a chevron expand or collapse the whole subtree

### Size

A user asks "which part of this layer is large?" A pack size grows with no warning, and the
tree can answer this question at one look.

- A directory row shows the total size of the files below it, next to the count
- A bar behind the size shows the share of the layer that the row holds
- [Sorting](#sorting) orders each directory by name, by size or by file kind

### File type filter

A control filters the tree to one group of file types. This uses the file type that the
backend already reports, so the filter needs no new data. [Filtering](#filtering) names the
groups, and gives the same control to all three explorers.

### Asset inspector

A tree row in a side panel is narrow. It carries a name and one number, and no more. Every
other fact about a file belongs in the inspector below the tree.

| Field               | Source                                                    |
| ------------------- | --------------------------------------------------------- |
| Path                | The content entry                                         |
| Size                | The content entry                                         |
| File type           | The content entry                                         |
| Target WAD          | The first segment of the relative path                    |
| Also in layer       | Every other layer of the project that holds the same path |
| Modified            | Needs a time field in the content scan                    |
| In the game archive | The game index of the game browser                        |
| Texture facts       | Needs a read of the texture header                        |

**Also in layer** is the field with the highest value for the lowest cost. The content tree
request already returns every layer in one payload, so the frontend can compute this field
with no change to the backend. A layer conflict is invisible in the editor today.

**In the game archive** is the field with the highest value overall. A path with a typo
passes every check in the manager and then does nothing in the game. This is the most common
fault in a new mod, and a check against the archive of the installed game finds it. The
[game index](#the-game-index) holds every path of the game, so this field arrives with the
game browser.

## Why the file tree is not a table

A proposal asked for a data grid with more columns to the right of the tree. The answer is
no, for two reasons.

First, there is no data for the columns. A content entry carries the path, the size and the
file type. A row shows all three already, as the label, the right rail and the icon. A
header row, a resize control and a sort arrow add chrome and no information.

Second, the tree now lives in a side panel, and a side panel is narrow. A table needs width.
A table that loses its width reads worse than the tree that it replaced.

The extra data is still worth the work. It goes to the asset inspector, which has the room
and describes one file at a time.

A table returns in the editor surface, and it does not return in the side panel. The
[details list](#the-details-list) is that table: the location gives it a flat set of rows to
draw, and the surface gives it the width. Both objections above hold for the side panel, and
the tree stays there.

These constraints hold wherever it draws.

- One `grid-template-columns` value, shared by the header row and every data row
- A fixed row height, because the virtualizer computes each row position from it
- A drop to the name column and the size column below a pane width of 640px
- A hand written row model, because the folded directory chains do not fit a flat table
- `role="grid"` for a flat list of one directory. A table that keeps the hierarchy stays
  `role="tree"`, because `role="treegrid"` changes what the arrow keys mean and a tree needs
  those keys for expand and collapse

## The explorers

Three views in the editor read a tree of files: the layer file tree, the root game browser and
a scoped game browser. Each of them is a tree and nothing else. A modder who knows the name of
the file they want is served. A modder who would know the texture on sight is not.

This section gives all three one set of controls: a location, a breadcrumb over it, a second
view that draws tiles, the sorting and filtering that a list of files asks for, and one
selection under every view.

### Three explorers, one set of controls

| Explorer     | Source                          | Reads                       | A row carries                      |
| ------------ | ------------------------------- | --------------------------- | ---------------------------------- |
| Layer files  | one layer of the project        | every entry, in one payload | a relative path, a size, a kind    |
| Game index   | the folded index of the install | one directory at a time     | a path, a size, a hash, an archive |
| Game archive | one archive of the install      | its whole chunk table       | the same                           |

Everything below is a view over rows that a source already returns. The thumbnail is the one
addition that reaches the backend, and it is a parameter on a URL that exists.

### The location

A tree has no current directory. A grid needs one, because a grid draws one directory rather
than a hierarchy. The location is that directory: a path inside the explorer's source, where
the root is the empty path.

| Gesture                                    | The location becomes        |
| ------------------------------------------ | --------------------------- |
| A click on a crumb                         | the crumb's directory       |
| A double click on a directory, in the grid | that directory              |
| The up control, `Alt+↑` or `Backspace`     | the parent                  |
| A focused row, in the tree                 | the directory that holds it |
| A reveal request                           | the directory of the path   |
| A path typed into the bar                  | whatever it names           |

In tree mode the location follows the focus and drives the breadcrumb alone. In grid mode it is
what the grid lists. A switch from the tree to the grid opens the grid where the tree was, and a
switch back expands to that directory and reveals it. This is what makes the two views one
explorer rather than two.

### The explorer bar

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ↑ │ base / assets / characters / smolder ⌄ │ ⌕ filter │ ⇅ Name │ ⊞ │ ⋮      │
├──────────────────────────────────────────────────────────────────────────────┤
│                                  the rows                                    │
```

| Control    | Does                                                      |
| ---------- | --------------------------------------------------------- |
| `↑`        | Goes to the parent directory                              |
| Breadcrumb | Names the location, and navigates to any part of it       |
| Filter box | Narrows the rows. `Ctrl+F` and `/` focus it               |
| Sort       | The field, and the direction                              |
| View       | Tree, grid or details                                     |
| Overflow   | The tile size, the thumbnail switch, and what a row shows |

[Document chrome](#document-chrome) says that a leaf draws one row and not two, and this bar is
a second row. That rule was written against a bar that repeats the title its tab already
carries. This one carries the location, which no tab can hold and which changes at every move.
The explorers are the only documents that draw it, and the controls they keep in the tab row
today - the refresh, the Add WAD menu, the rebuild and the file counts - move into it, so a leaf
still pays for one row of chrome. Visual Studio Code draws the same bar under its tabs for the
same reason.

A side panel is narrower than a surface. There the bar keeps the up control, the last two crumbs
and the filter box, and folds the rest into the overflow.

### The breadcrumb

- The first crumb names the source: the layer's display name, `Game`, or the archive's file name
- Each later crumb is one path segment. A folded chain of single-child directories draws one
  crumb for each of its segments, because a crumb is a place a user lands on and the fold would
  hide those places
- A chevron after a crumb lists the sibling directories of the next one, so a move from
  `skins/base` to `skins/skin01` costs one click and does not go up first
- The leading crumbs collapse into one `…` crumb with a menu as soon as the row runs out of
  width. The bar never wraps to a second line
- The last crumb reads as the location, and carries the count of what it holds
- A crumb's context menu holds **Copy path**, **Open in a new tab**, and **Copy into the layer**
  in a game explorer

`@/components` holds no breadcrumb yet. [The project bar](#the-project-bar) wants the same shape
for its `Workshop /` crumb, so one component serves both and neither module writes the markup
itself.

#### The path input

A click on the empty space after the last crumb, or `Ctrl+L`, turns the bar into a text input
holding the location. `Enter` navigates, and `Escape` returns the crumbs.

This is the cheapest route the game browser has. A `.bin` file names
`assets/characters/aatrox/skins/base/aatrox_base_tx_cm.dds`, and a modder holding that string
wants the directory it names rather than eight expand clicks through an index of 60,151
directories. The input completes the segment being typed against the children of the directory
before it, which the index answers in 30 microseconds.

A path that names nothing reports so in place of the rows. The view does not empty itself,
because an empty view reads as an empty directory and a typo is not one.

### The views

| Mode    | Draws                              | Suits                                  |
| ------- | ---------------------------------- | -------------------------------------- |
| Tree    | the hierarchy, as today            | reading the shape of a layer           |
| Grid    | one directory as tiles             | recognising an asset by its picture    |
| Details | one directory as rows with columns | sorting by size, and reading the facts |

Tree is the default, and it is the mode a side panel opens in. The mode is remembered for the
editor surface and for the side panel apart, because a 280px panel and a 900px surface do not
want the same view.

#### The grid

```
┌──────────────────────────────────────────────────────────────┐
│  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐       │
│  │ ▨▨▨▨▨▨▨ │   │ ▨▨▨▨▨▨▨ │   │         │   │ ▨▨▨▨▨▨▨ │       │
│  │ ▨▨▨▨▨▨▨ │   │ ▨▨▨▨▨▨▨ │   │   dir   │   │ ▨▨▨▨▨▨▨ │       │
│  │ ▣   tex │   │ ▣   dds │   │         │   │ ▣   tex │       │
│  └─────────┘   └─────────┘   └─────────┘   └─────────┘       │
│  smolder_      smolder_      hud            smolder_         │
│  base_tx_cm    base_tx_nm    12 files       base_tx_sm       │
│  1.4 MB        1.4 MB                       340 KB           │
└──────────────────────────────────────────────────────────────┘
```

- A directory tile draws a folder glyph and its file count, and the directories come first
- A file tile draws its thumbnail where a viewer produces one, and its kind glyph where none
  does
- The kind sits as a badge on a tile that carries a thumbnail, so a `.tex` and a `.dds` of the
  same art still read apart
- A name wraps to two lines and then ellipsizes in the middle. A game file differs from its
  neighbour at the end of the name
- The size reads under the name, and drops out at the two smallest tile sizes
- A texture with alpha draws on the checkerboard the preview already offers, under the
  `previewCheckered` setting that governs the preview
- The grid virtualizes one row of tiles at a time

The tile size is a slider in the overflow, on the ruler variant that the library's card size
uses, over 64, 96, 128, 160, 192 and 256 pixels. `Ctrl` and the wheel steps it, the way a file
manager does, and `Ctrl+=` and `Ctrl+-` do the same from the keyboard.

#### Thumbnails

The pixels arrive the way a preview's pixels arrive. The `ltk-asset` scheme renders any asset
the backend has a viewer for, so a tile is an `<img>` at that URL and nothing crosses the
JavaScript heap.

The URL gains one parameter.

```
ltk-asset://localhost/<token>?w=128
```

| Concern                 | The answer                                                                |
| ----------------------- | ------------------------------------------------------------------------- |
| The decode              | The smallest mipmap that is still at least `w` wide                       |
| A texture with no chain | Level 0, and the `<img>` scales it                                        |
| A PNG or a JPEG         | Passes through untouched, as it does today                                |
| A kind with no viewer   | Is never asked for. The tile reads the kind off the extension first       |
| The value of `w`        | One of the tile sizes, so the slider asks for six widths and not for many |
| The store               | None. The response keeps `no-store`, so a scroll back up decodes again    |

`Texture::decode_mipmap` takes the level, and both containers hold their chain, so a 1024px
`.tex` at `w=128` decodes 128×128 and reads a sixty-fourth of the block data. This is what makes
a screen of tiles affordable at all, because a full decode for each tile is the work of sixty
open previews.

**What the queue is for.** The scheme is served over `http://ltk-asset.localhost` on Windows, so
the webview caps itself at six connections to that host and the preview of the open tab would
queue behind a screen of thumbnails. The frontend holds its own queue instead, and decides what
goes first.

- A tile asks when it mounts, and the virtualizer mounts one row beyond the viewport
- Nothing is asked for until the scroll has been still for 120ms, which is the debounce the
  project bar uses for the same reason
- A tile that scrolls away drops its `<img>`, which cancels the request in flight
- Six in flight, and one slot is held for whatever a preview tab asks for
- The queue orders by archive. A directory of the folded index draws its files from many
  archives and [the mount cache](#how-a-preview-reaches-the-screen) holds four, so an unordered
  screen of tiles evicts a mount that the next tile wants

The last rule is the one worth a measurement. Raising the mount capacity is the other answer to
it, and it costs a chunk table for each archive it adds.

#### The details list

Name, size and kind as columns, and modified where the source reports one. A game chunk carries
no time at all, so that column is absent in the two game explorers rather than empty in them.

The constraints are the ones that
[Why the file tree is not a table](#why-the-file-tree-is-not-a-table) already sets: one
`grid-template-columns` for the header row and every data row, a fixed row height for the
virtualizer, and a drop to the name and the size below a pane width of 640px. A header cell
sorts, and a second click on it flips the direction.

`@/components/DataTable` is the wrong host for it. That component mounts every row, and one
directory of the game index holds thousands.

### Sorting

| Field    | Reads                                       | Available in       |
| -------- | ------------------------------------------- | ------------------ |
| Name     | the label, in natural order                 | every explorer     |
| Size     | the file's size                             | every explorer     |
| Kind     | the file kind, and the name inside one kind | every explorer     |
| Modified | a time that no content scan reports yet     | the layer explorer |

- Directories sort before the files whatever the field is. An explorer that mixed the two would
  hide a directory behind a thousand files
- A directory sorts by the total below it once [Size](#size) supplies that total. Until then the
  size field orders the files and leaves the directories in name order
- Names sort in natural order, so `mip2` comes before `mip10`. Game file names carry numbers
- A sort applies to the whole explorer and not to the open directory alone, so a tree sorted by
  size is sorted by size at every depth

Nothing here reaches the backend. The layer explorer holds every entry already, and the game
index answers one directory at a time, so a sort reads rows that the frontend holds either way.

The control is the shape the library's sort already draws: the fields as toggle pills, and the
direction as a button that names what the current direction means.

### Filtering

Three filters, and a row shows when it passes all three.

| Filter | Control              | Matches                                            |
| ------ | -------------------- | -------------------------------------------------- |
| Text   | the box in the bar   | the name, and the path once the depth is below     |
| Kind   | a menu of the groups | the file kind, which a row already carries         |
| Extra  | the same menu        | one condition that the source makes worth offering |

**The box reads the location and everything below it.** In tree mode the result is the filtered
tree that [Search](#search) describes, with every parent of a match kept. In grid mode the
result is a flat list, each tile carrying its path in dim text under the name, because a grid
has no way to draw depth. This is what a file manager does with the same box.

The layer explorer keeps the widening to every layer, in the box's own menu. A relative path is
the same string in every layer, so a result names the layer that holds it.

The root game browser is the one explorer where a read below the location is not free. It holds
one directory and Rust holds the rest, so the recursive form is the query that
[The scan of the game](#the-scan-of-the-game) builds, with the location as its prefix. It
arrives with that scorer and not before, and a filter of the open directory alone works today.

**The kind groups.** These use the file kind that the backend reports, and a game explorer reads
it off the extension the way its row glyph already does.

| Group      | Kinds                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| Textures   | `texture`, `texture_dds`, `png`, `jpeg`, `tga`, `svg`                                                  |
| Meshes     | `simple_skin`, `static_mesh_ascii`, `static_mesh_binary`, `map_geometry`, `world_geometry`, `skeleton` |
| Animations | `animation`                                                                                            |
| Data       | `property_bin`, `property_bin_override`, `riot_string_table`, `preload`, `lua_obj`, `light_grid`       |
| Audio      | `wwise_bank`, `wwise_package`                                                                          |
| Other      | `unknown`                                                                                              |

**The extra condition** differs by source, and each one is a single switch.

| Explorer     | Condition        | Answers                                               |
| ------------ | ---------------- | ----------------------------------------------------- |
| Game index   | Unnamed only     | Which chunks no hash table names, after a game patch  |
| Game archive | The same         | The same, for one archive                             |
| Layer files  | In another layer | Which files of this layer another layer holds as well |

An active filter shows as a chip under the bar, on the shape the workshop's filter chips already
draw, and one click clears one.

### Selection

Every explorer holds a selection, and the selection belongs to the explorer and not to the view
that draws it. A tree, a grid and a details list are three drawings of one set of items, and a
user who selects four textures in the grid and switches to the tree to read where they sit
keeps the four. The same holds for a view nobody has built yet. A tree held a focused row and
nothing else until the copy that the game browser exists for asked for more than one file at a
time.

**The model.** One set of item ids and one anchor, in one hook that every view mounts and no
view writes for itself. An id is what the source names an item by: a file's path hash, or a
directory's path. Those ids hold across a sort, a filter, a search and a view switch, which is
what lets the selection outlive all four. The model offers select, toggle, extend, select all
and clear, and it answers the count, the size and the targets a copy takes. No view reads the
set to decide anything. A view asks the model.

| Gesture              | Does                                                     |
| -------------------- | -------------------------------------------------------- |
| A click              | Selects one, and drops the rest                          |
| `Ctrl` and a click   | Adds one, or removes one                                 |
| `Shift` and a click  | Extends from the anchor, over every item between the two |
| `Shift` and an arrow | The same, along the order the view walks                 |
| `Ctrl+Space`         | Adds the focused item, or removes it                     |
| `Ctrl+A`             | Selects every item in the directory that holds the focus |
| `Escape`             | Clears the selection                                     |
| A double click       | Opens a file, and descends into a directory in the grid  |
| A right click        | Selects the item alone, unless the selection holds it    |

The gestures are the same in every view. What differs is what "between" and "the directory that
holds the focus" mean, and the view answers both.

**What a view supplies.** Three answers, and nothing else.

| The view gives             | In the tree                              | In the grid and the list       |
| -------------------------- | ---------------------------------------- | ------------------------------ |
| The visible order          | the flattened rows, whatever their depth | the tiles or rows, in the sort |
| The focused item           | the focused row                          | the focused tile or row        |
| The directory of the focus | the focused row's parent                 | the location                   |

A range therefore runs over the rows on screen between the anchor and the click in the tree,
whatever their depth, which is what Visual Studio Code's explorer does, and over the tiles in
reading order in the grid. Under a filter, the directory that holds the focus is the filtered
set, so `Ctrl+A` selects what the filter shows.

**A selected directory is every file below it.** That is the whole answer to what a selection
that spans depths means, and it holds in every view: a directory tile in the grid selects the
same files as the directory row in the tree. A copy of it writes the files below it, and a
count of it counts them. The copy writes each file once, whatever selected items cover it.

The root game browser holds a collapsed directory's listing only once it opens, and a selection
of that directory loads nothing. The backend walks the directory when the copy runs, because the
index holds the files and the frontend does not.

**What a view draws.** The model names three states for an item, and every view draws them with
the same two marks: a fill for the set, and a ring for the focus.

| State    | Means                               | Drawn as                  |
| -------- | ----------------------------------- | ------------------------- |
| Selected | the set holds the item              | the accent fill           |
| Covered  | a selected directory holds the item | the fill at half strength |
| Focused  | the keys act here                   | the ring                  |

A row's fill is its band and a tile's fill is its background, and the two read as one system.
Covered is what makes the reach of a selected directory visible without a count: the rows under
it in the tree, and the tiles inside it once the grid descends. The focus and the selection are
two marks, and an item can hold one without the other, which is what an arrow key without
`Shift` moves. Every view sets `aria-multiselectable`, and `aria-selected` reports the selection
and not the focus.

**The bar.** The toolbar row states the selection at its right end, where the match count sits:
the file count, the size, the explorer's action where it has one, and a clear control after
them. The bar is the explorer's and sits above whichever view is showing, so a view switch does
not move it. An empty selection shows nothing there, so the row reads as it does today. A
directory's size needs a total on each directory entry, which the game index computes at the
build beside the file count it keeps already.

The context menu acts on the selection in every view, so **Copy into base** writes every
selected file whether the menu opened on a row or on a tile. That is the gesture that turns a
screen of thumbnails, or a tree of rows, into a layer. [Copy into a layer](#copy-into-a-layer)
holds the rest.

### An item is a drag source

Every item of an explorer drags, in every view, and the drop target decides what the drop
means. A surface opens it, and a layer takes a copy of it. The item carries one payload
wherever it goes, so a target never asks which view or which explorer it came from.

**The payload.** The model's item list: for each item its source, its id, its kind and its
name. A drag that starts on a selected item carries the selection, and a drag on any other
item carries that item alone, under the rule the context menu obeys. A target derives what it
needs: a surface builds a preview reference for each file, and a layer copy builds its
targets. Neither reads the view.

| Dropped on                         | Does                                                     |
| ---------------------------------- | -------------------------------------------------------- |
| A tab strip                        | Opens each file there, at the index, as a tab drag lands |
| The centre of a surface            | Opens each file there, at the end of the strip           |
| An edge of a surface               | Splits there, and opens each file in the new group       |
| A layer row of the Content section | Copies into that layer                                   |
| The layer explorer                 | Copies into the layer it shows                           |

The first three are the zones that [a tab drag](#a-tab-drag-creates-a-panel) has already, and
an item lands on them with one difference: a tab moves and an item opens. The last two are
new, and [Copy into a layer](#copy-into-a-layer) says what the copy writes.

- A drop names the group, so the rule that puts a preview in a group of its own does not apply
- A drag is a deliberate open, so it adds a tab whatever the tab open mode says, the way a
  double click on a replaceable tab keeps it
- Each file opens as its own tab, in the order dragged, and the first takes the focus. A drop
  of many files opens many tabs, which is what a user asked for by dragging many
- A file that is open already activates its tab, the rule every open obeys
- A directory dropped on a surface opens nothing. A directory is a place and not a document,
  and the surface paints no preview for it, the way it paints none for a split the resolver
  refuses. Its files still drop on a layer

**The ghost.** The kind glyph and the name for one item, and the count for more, the way a
file manager draws it. A layer row under the pointer lights and names the copy,
`Copy into base`, and the layer explorer lights whole, on the overlay the WAD drop draws
already.

**One context.** The editor's one `DndContext` sits at the grid's root today and never wraps a
side panel, so the sidebar's layer reorder does not nest inside it. An item drag starts in a
document and ends on a layer row, or starts in a side panel that hosts a browser and ends on
a surface, so the context climbs to the content browser's root and wraps both. The layer
reorder joins it as a sortable, and the collision rank tells a layer row under an item apart
from a layer row under a layer. The activation distance stays, so a click on an item is still
a click.

**The keys exist already.** `Enter` opens, `Ctrl+Enter` opens beside, and `Ctrl+C` then
`Ctrl+V` copies, so the drag adds no reach that a keyboard lacks.

A layer file is the same draggable, and a drop of one on a surface opens it the same way. A
drop of one on another layer is a later pass, once the layer explorer takes the selection.

### Keys

| Key                | Does                                       |
| ------------------ | ------------------------------------------ |
| `Ctrl+L`           | Turns the breadcrumb into the path input   |
| `Alt+↑`            | Goes to the parent                         |
| `Backspace`        | The same, while no input holds the focus   |
| `Ctrl+F`, `/`      | Focuses the filter box                     |
| `Ctrl+1` `2` `3`   | Tree, grid, details                        |
| `Ctrl+=` `Ctrl+-`  | Steps the tile size                        |
| `Ctrl` and a wheel | The same                                   |
| The arrows         | Move the focus, by a column in the grid    |
| A letter           | Jumps to the next name that starts with it |
| `Enter`            | Opens, and descends into a directory       |
| `Ctrl+C`           | Copies the selection, in a game explorer   |
| `Ctrl+V`           | Writes the copied files into the layer     |
| `Ctrl+E`           | Opens the extract dialog for the selection |

`Alt+←` stays with [the navigation history](#the-navigation-history). A move to a parent is not
a move back.

### Where the state lives

| State                   | Belongs to                     | Because                                                 |
| ----------------------- | ------------------------------ | ------------------------------------------------------- |
| The view mode           | the app, per host              | a work habit, and a panel and a surface differ          |
| The tile size           | the app                        | a work habit                                            |
| Thumbnails on or off    | the app                        | a work habit, and a modder on a laptop turns them off   |
| The sort                | the app                        | a modder who reads by size reads every explorer by size |
| The location            | the document                   | it is where the user left the project                   |
| The expansion           | the document                   | the same, and the trees hold it already                 |
| The filter and the text | the document, and not the file | it answers one question and is gone by the next open    |
| The selection           | the document, for the session  | it feeds one copy, and a restart has no copy pending    |
| The copied files        | the app, for the session       | a copy in one project pastes into another               |
| The conflict answer     | the app                        | a work habit, and the dialog's checkbox writes it       |

`workshopLayout` holds the application's four, beside the alpha checkerboard and the tab open
mode that it holds now. `.ltk/editor.json` holds the document's, with the tabs and the split
tree. A preview's zoom and pan are in neither. They belong to one open preview and go when it
closes, which [Panning and zooming a preview](#panning-and-zooming-a-preview) gives the reason
for.
The layer file tree of the side panel is not a document, so its location joins the collapse
state that the workshop store already keys by layer.

### Accessibility

- The grid is `role="grid"` over `role="row"` and `role="gridcell"`, and the tree keeps
  `role="tree"`
- The breadcrumb is a `nav` labelled `Location` over an ordered list, and the last crumb carries
  `aria-current="page"`
- A thumbnail is `alt=""`. The tile's name is the label, and a second reading of it is noise
- The grid holds one tab stop and moves a roving focus, the rule that the trees obey
- Every drop has a key: `Enter` opens, `Ctrl+Enter` opens beside, and `Ctrl+C` then `Ctrl+V`
  copies

### What ships in what order

| Step | Holds                                                                  |
| ---- | ---------------------------------------------------------------------- |
| 1    | The bar, the location, the breadcrumb and the path input, in tree mode |
| 2    | The grid, the tile size, the thumbnail switch, and the `w` parameter   |
| 3    | The sort, the kind filter and the chips, over every view               |
| 4    | The details list, and the recursive filter of the game index           |

Step 1 changes no backend. Step 2 changes one URL. Step 3 changes none. Step 4 waits on the
scorer that [the project bar](#the-project-bar) builds.

The selection is not in this table. It ships ahead of the grid, in the tree, under the order
that [Copy into a layer](#copy-into-a-layer) sets, because the copy wants it first.

## Editor surface

The tab row works like the tab row in Visual Studio Code and has the same purpose. A tab is
one open document. The active document fills the surface below the row.

- Every open document stays mounted. A scroll position and a half typed edit survive a trip
  to another tab
- A document with unsaved edits shows a dot in place of its close button
- A close on a document with unsaved edits asks first
- The tab strip keeps its state per project, so a return to a project restores the documents

The first visit opens the details document when the project still carries every default
from the scaffold. In every other case the first visit selects the first layer.

### Document chrome

A document's own controls - a save, a filter, an import - sit at the trailing edge of the
tab row that holds its tab, and show while that document is active. A leaf draws one row
and not two. A second bar under the tabs costs every leaf 36px to repeat the title its tab
already carries, and a split of three leaves pays that three times over.

The [explorer bar](#the-explorer-bar) is the one exception, and it is a document's own row
rather than a second title. It carries the location, which a tab cannot hold, and it takes
in the controls that the explorers keep in the tab row today.

A control that answers for the whole view stays out of the tab row, because a tab row per
leaf means one copy of it per leaf. The layout control sits in the project header and the
route to the game index sits in the primary panel's project row, so each has one copy
whatever the grid holds.

### Tab titles across layers

A change of the selected layer leaves every open tab alone. A user compares two layers, and
a strip that empties itself at each layer change makes that work impossible.

A file name is therefore not unique in the strip. Two layers hold the same relative path,
and two tabs then carry the same title.

- A title is the file name alone while it is unique in the strip
- A title becomes `<layer>/<file>` as soon as a second tab takes the same name
- The layer part returns to hidden when the other tab closes

The tab already carries a dim context field after the title, and the strings document
already fills it with a layer name. The rule above sets when that field shows.

### Document types today

| Document     | Content                                            |
| ------------ | -------------------------------------------------- |
| Mod details  | The project metadata form                          |
| Layer files  | The file tree of one layer                         |
| Strings      | The override table for one layer and locale        |
| Game index   | Every archive of the install, folded into one tree |
| Game WADs    | The list of the install's archives                 |
| Game archive | The file tree of one archive of the install        |
| Preview      | One asset, drawn by the viewer its file kind has   |

### Planned document types

| Document     | Content                                 |
| ------------ | --------------------------------------- |
| Mesh preview | A model in a small viewport             |
| Bin preview  | A `.bin` as blocks over its parsed tree |

The bin preview has a document of its own, and [Bin editor](BIN_EDITOR.md) specifies it. It
reads a bin rather than an image and edits one where the source allows a write, and neither
fits a variant on `Preview`.

The mesh preview joins the preview document rather than adding one of its own. A viewer is a
variant on the backend's `Preview` and an arm of the switch the preview document draws, so
the tab, the document and the reference behind them are unchanged.

### How a preview reaches the screen

The pixels do not cross IPC. The backend registers an `ltk-asset` URI scheme, renders the
asset into something the webview decodes, and the viewer draws an `<img>` at that URL. A
base64 result would arrive as a string for the frontend to reassemble into a canvas, where
this way the webview's own decoder does the work and the bytes never reach the JavaScript
heap.

An asset reference says where the bytes live, and it has three forms: a file of a layer, a
chunk of one of the install's archives, and any file on disk. A new store is a fourth form
and reaches every viewer at once.

What an `<img>` cannot report — the container, the block format, the mipmap count — comes
over IPC beside it, and the preview's status strip shows it. That payload is what the
inspector's **Texture facts** row reads when it arrives.

Reading a chunk mounts its archive, and a mount reads that archive's whole chunk table. A
bounded cache keeps the last four mounts, so one preview after another out of one archive
pays for the table once. A refresh of the game index drops them, because asking for a fresh
index is the one signal the app gets that the install changed underneath it.

The image preview decodes DDS and TEX through the `ltk_texture` crate. The `ltk-tex-utils`
repository holds an integration to work from.

### Panning and zooming a preview

A modder reads a texture at two distances. First they check the silhouette at the size the
game draws it. Then they read one edge at the texel. Every image and vector preview answers
both. `react-zoom-pan-pinch` supplies the wheel, the drag, the pinch and the double click.

| Gesture                 | Does                                                 |
| ----------------------- | ---------------------------------------------------- |
| The wheel               | Zooms about the pointer, a tenth to the notch        |
| A trackpad pinch        | The same, by as far as the fingers moved             |
| A drag                  | Pans, at every zoom and in every direction           |
| A double click          | Doubles the zoom, about the pointer                  |
| The strip's `−` and `+` | Steps the zoom by a quarter, about the pane's center |
| The strip's percentage  | Goes to the actual size, and centers                 |
| The strip's **Fit**     | Goes back to the whole image, and centers            |

**A drag always pans.** No bounds hold the image inside the pane and no edge pulls it back. A
modder moves a fitted icon aside as readily as a corner of a 4096 pixel texture.

Bounds lock a fitted image in the middle of the pane. Most textures a modder opens do fit, so
the drag would do nothing for most of them. A viewer that does not answer a drag reads as a
viewer that cannot pan. The pane carries the grab cursor for the same reason. The drag is
there whatever is on screen, so the cursor says so whatever is on screen.

An image can leave the pane that way. **Fit** and the percentage both center what they scale,
and either one returns it in a single click.

The zoom reaches from 5% to 3200%. Past 100% the image draws nearest neighbour, so a modder
reads the texels rather than the webview's guess at what is between them. Under 100% the
webview smooths as it would anywhere else.

The alpha checkerboard holds its 16 pixel square at every zoom, because a checkerboard that
scales with the image stops reading as a ground.

A fit is only ever a reduction. An icon smaller than the pane reads at its own size. To fill
the pane with it would show a modder texels of the webview's own invention before they asked
for any.

**The zoom and the pan belong to one preview.** A file opens on its whole image. The zoom of
the last file does not reach it.

An earlier version shared one zoom across every open preview, on the argument that four
textures compared beside each other want one scale. That argument does not survive the next
open. A 3200% read of one texture is then what the next texture opens at. The image is another
size, and the scale says nothing about that. Every preview still shares the alpha
checkerboard, because that is a display preference and not a viewport.

The strip's controls follow the same split. `−` and `+` are the library's own step, which
zooms about the middle of what is on screen and leaves the pan alone. The percentage and
**Fit** name one scale outright, so they move the transform and center what they scaled.

The library adds its wheel step to the scale and does not multiply by it. One fixed step is
then a nudge at 3200% and a leap at 5%. The step is a share of the current scale for that
reason, which turns the sum back into a ratio at every zoom.

### How a file opens

Opening is a deliberate gesture. A single click on a tree row selects it, a double click
opens it, and the row's context menu offers **Open** for the same thing. A single click used
to open, which turned every walk through a tree into a series of loads.

### Preview tabs

A scan of a large layer opens one tab for each file that a user looks at. The strip then
holds more tabs than a user can read, and the user closes them by hand.

There are two answers, and the settings hold the choice.

- **New tab**, the default - every open adds a tab, so four textures compared against each
  other are four tabs
- **Reuse tab** - one replaceable tab holds whatever opened last, so a walk through a
  directory stays one tab wide

A replaceable tab shows its name in italic, and a double click on the tab itself keeps it.
The strip holds one at a time.

### What a tab's context menu holds

- **Close**, **Close Others**, **Close to the Right**, **Close All** - scoped to the strip
  the tab sits in, so the other group of a split keeps its own tabs
- **Copy Path**, **Copy Name** - the path is whatever addresses the subject outside the app:
  a file's path on disk, and for a game chunk its archive and then the path inside it
- **Split Right**, **Split Down** - already there, now under the same menu

Closing several tabs at once asks the unsaved-edits question once for each editor that has
any. The clean ones close straight away and the rest queue behind one dialog, so a refusal
answers for the whole batch.

### Where a preview opens

Every preview opens as a tab, in one group of its own beside whatever asked for it. The
first preview splits that group off the requesting one, and every later preview joins it.
The browser keeps its own group either way, so a walk through a tree never pushes the tree
off screen. A group that is empty takes the preview instead of splitting, since one half of
that split would show nothing.

Nothing else moves. A document opened from the sidebar lands in the focused group, as
before, and a preview dragged out of the group settles wherever it is dropped - the group
is where a preview _opens_, not a place it is held to.

The layer tree keeps its own panel, so the tree and the preview are both on screen at all
times. A separate preview pane at the right edge adds nothing.

### Bin files and the extension

For a `.bin` file the manager has a second route. It can open the file in Visual Studio
Code and let the ritobin-lsp extension supply the syntax and the diagnostics.

The two routes answer different needs. The preview answers "what is in this file?" in one
click. The extension answers "I want to edit this file" with a full editor.

## Game browser

A mod replaces a file that the game already holds. To replace one, a modder must find the
file, read its path and copy it into a layer. The editor gives no route to that work
today, so the modder opens a separate WAD unpacker and returns with a file and a path.

The game browser removes that trip. It reads the WAD archives of the installed game and
shows every file of the game in one tree.

### Requirements

- A modder finds a game file without a second application
- A copy into a layer lands at the path that the game reads
- The first open is quick, and every open after it is quicker
- A game patch costs a rebuild of the changed archives alone
- A modder extracts a file, a directory or an archive to disk, under the rules wadtools set

### Where it opens

The game browser opens as a tab in the editor surface. It is also a
[panel type](#panel-types), so a user can put it in a side panel instead. A user opens more
than one browser at a time. Read [Scope to one archive](#scope-to-one-archive).

The primary panel's project row carries the route to the root browser, beside the mod
details, so it stays on screen whatever the grid holds and whichever sections are
collapsed. The empty editor offers the same route as a button, and a row of the WADs
section opens a scoped browser for the archive it names.

A tab is the right default, and the layer file tree keeps its side panel. The two views
differ in four ways.

| Question                     | Layer file tree   | Game browser          |
| ---------------------------- | ----------------- | --------------------- |
| How long does it stay open?  | The whole session | One search            |
| How much width does it need? | A side panel      | The editor surface    |
| How many files does it hold? | Hundreds          | More than one million |
| What does a row open?        | A document        | A preview             |

The layer file tree is navigation for the current work, so it holds a panel for the whole
session. The game browser is a reference. A user opens it for one question, copies the
answer into a layer and closes it again.

### The list of archives

The **Game WADs** document names every archive the install holds, and a row opens a
[scoped browser](#scope-to-one-archive) for that archive.

It answers the question the folded tree cannot. The root browser merges the archives away
on purpose, so a modder who wants `Aatrox.wad.client` itself needs a list of archives, and
this is that list. The route to it is a control in the root browser's own chrome, because
the fold is what creates the need for it.

- A filter box narrows the list from the tab row, and matches the whole relative name, so
  `champions/aa` narrows as well as `aatrox`
- A row leads with the archive's file name, which is what a modder searches by, and the
  directory under `DATA/FINAL` follows it in dim text
- The rows virtualize, because an install carries hundreds of archives
- A row whose tab is the active document carries the accent, the rule the side panel's
  lists obey

A tab and not a side panel section: the list is a reference a user opens for one search
and closes again, which is the same reason the game browser is a tab. The side panel
answers to the selected layer, and an install's archives answer to nothing in the project.

### Scope to one archive

A modder works on one champion, and one champion is one archive. The whole game is the
wrong view for that work. A filter is the wrong control for it too, because a filter holds
one value and a modder compares two archives.

The view therefore has two forms. The **root browser** shows the whole game as one tree,
with no archive in it. A **scoped browser** shows one archive and nothing else.

- A user opens as many scoped browsers as the work needs
- A scoped browser carries the archive name as its tab title
- One archive opens one tab. A second request activates the tab that is already open

Two routes open a scoped browser, and both are lists of archives.

| Route                               | Result                                               |
| ----------------------------------- | ---------------------------------------------------- |
| An archive row of the WADs section  | A tab for an archive that the selected layer changes |
| An archive row of the Game WADs tab | A tab for any archive the install holds              |

The first route is the one that pays. The WADs section already names the archives that the
layer changes, so one click moves the modder from "this layer changes `Aatrox.wad.client`"
to "here is the rest of `Aatrox.wad.client`". The second covers the archive that no layer
touches yet.

The root browser carries neither route, because it folds its archives away.

A scope is a view over the index, and not a second index. A scoped browser reads the
entries that the index already holds for its archive, so a scope costs a filter and
nothing more.

The open browsers share the rest of the surface.

- Each browser holds its own scroll position and its own expansion, under the rule in
  [Editor surface](#editor-surface)
- The strip still holds one preview tab, so a preview from one browser replaces a preview
  from another
- A copy still writes into the selected layer, whichever browser starts it

A side panel hosts one browser. A user who wants two archives side by side drags one tab
onto a boundary, and the layout then holds two editor surfaces with one browser in each.
Read [A tab drag creates a panel](#a-tab-drag-creates-a-panel).

### The tree

The tree has two levels.

1. The directory path, such as `assets/characters/aatrox`
2. The file

Neither level is an archive. The root browser folds every archive into one tree, and a
scoped browser holds the one its tab title already names.

A row shows the file name, an icon for the file type and the size in the archive. A run of
directories that each hold one directory folds into a single row, the rule the layer file
tree obeys. The tree uses the same row height, the same virtualizer and the same keyboard
rules as that tree, so a user who knows one view knows the other.

An archive holds no directory of its own. Each chunk carries one path hash, and a hash
table supplies the path. Read [Hash names](#hash-names). A chunk with no known path groups
under an `unknown` node, and its row shows the hash in hex.

### Search across the game

A search box at the top of the view filters the tree. The box matches the full path, the
same rule that the layer file tree obeys. A scoped browser searches its own archive, and
the root browser searches every archive.

The game holds more than one million paths, so the box searches the index and not the
rendered tree. A result keeps its parent directories, so the result is still a tree.

An archive filter and a file type filter narrow the search further. Both reuse the
controls of the layer file tree.

### Preview

A click on a file opens it in a preview tab, under the rules in
[Preview tabs](#preview-tabs). The preview reads the chunk from the archive and shows it
with the viewer for its file type. The viewers are the ones that
[Planned document types](#planned-document-types) lists.

One set of viewers serves both trees. A texture of a layer and a texture of the game open
in the same viewer, so a modder compares the two with a switch between two tabs.

### Copy into a layer

The copy is the purpose of the whole view. The browser writes the selection into the
selected layer at the path that the game reads, so the path is correct by construction.
This removes the most common fault of a new mod.

- A copy of a file writes one file
- A copy of a directory writes every file below it, under the rule in
  [Selection](#selection)
- A copy writes each file once, whatever selected items cover it, and writes a shared chunk
  under one archive
- A target file that exists with other bytes asks first, unless a setting answers
- A file with an unknown path lands under its hash, in hex

**What is built.** The menu route, on one row or one directory, through the extractor
rather than a copy command of its own - the same write and the same target path, with
**Skip** for a file already there rather than the ask. The selection, the selection bar,
the clipboard and the drag wait on [the selection model](#selection).

The Content section of the primary side panel sets the target layer. This is the same
selection that the secondary side panel reads. A project with no layer disables the copy,
and the control says so.

The copy reads the targets of the [selection](#selection) and knows nothing of the view
that built it. A file target names its archive and its hash, a directory target names its
path, and the tree, the grid and the details list hand over the same list. A view that does
not exist yet hands over the same list too, which is the test the design has to pass.

#### The routes

One command, reached four ways. The menu is what a mouse finds, the bar is what a selection
shows, the keys are what a keyboard knows, and the drag is what a file manager taught. Each
route ends in the same write and the same report, and each one reads the model and not the
view, so a route that works on a row works on a tile.

**The context menu.** **Copy into base** acts on the selection, and names the target layer
in its label, so a user reads where the files go before the click. **Copy into…** lists the
other layers, for a file that belongs in a chroma and not in the base. A project with one
layer shows no submenu. The menu is one component, mounted by every view. A right click on
an item outside the selection selects that item alone first, the rule every file manager
obeys, so a user who right-clicks one file copies one file and a user who built a selection
keeps it.

**The selection bar.** The count and the size at the right of the toolbar row, then one
button that names the layer, **Copy into base**, with the other layers on its caret. This is
the shape the workshop's selection button draws already, and it is the route a user finds
once a selection exists and no menu is open. The scoped browser draws the toolbar row as
soon as a selection exists, and [the explorer bar](#the-explorer-bar) gives it one for good.

**The keys.** `Ctrl+C` in a game browser copies the selection, or the focused row when
nothing is selected, so the key never does nothing. `Ctrl+V` in the editor writes the copied
files into the layer that is selected at the paste. The editor's clipboard holds the files,
and a paste in a second project writes there, because the game is one and the clipboard is
the application's. `Ctrl+V` inside a text field pastes text, as it always did.

The same `Ctrl+C` writes the chunk paths to the system clipboard, one on each line. A modder
who copies a texture often pastes its path into a `.bin` next, and one gesture serves both
readers. **Copy Chunk Path** stays in the menu for the single row.

**The drag.** An [item is a drag source](#an-item-is-a-drag-source), and a layer is one of
its targets. A drag that starts on a selected item carries the selection, and a drag on any
other item carries that item alone, so a drag from a tile and a drag from a row drop the
same thing. It drops on a layer row of the Content section, or on the layer explorer
wherever that explorer is hosted and whatever view it draws. The explorer lights as one
target and not a row or a tile of it, on the overlay the WAD drop draws already, and the
overlay reads `Copy 12 files into base`.

A paste and a drop land at the game path whatever item of the layer explorer holds the focus
or the pointer. The path is not the user's to choose, which is the whole point of the copy.

#### The target path

A layer holds one directory for each archive it changes, named as the archive's file is
named, and the chunk path under it.

```
content/<layer>/<Archive>.wad.client/<chunk path>
```

| The chunk                         | Lands at                                               |
| --------------------------------- | ------------------------------------------------------ |
| A named chunk of one archive      | `<archive>/<path>`                                     |
| A named chunk of several archives | The same, under the one archive the copy chooses       |
| An unnamed chunk                  | `<archive>/<hash>.<ext>`, the extension from the bytes |

The archive directory takes the archive's file name and not its directory under
`DATA/FINAL`, which is how the layer names its WADs already and what the WADs section reads.

The hex name loses nothing. The overlay builder reads a file stem of sixteen hex digits as
the chunk hash itself, and it reads the stem alone, so an extension beside it costs nothing
and gives the file a viewer. `LeagueFileKind::identify_from_bytes` in `ltk_file` names the
kind and `extension` names the suffix, which is how wadtools names a chunk it extracts and
how the preview names an unnamed chunk's kind already. A chunk that no sniff names keeps
`.bin`, which is the name `ltk_overlay` gives such a chunk itself.

#### A chunk in several archives

The index folds every archive into one tree, and a chunk that several archives carry is one
file in it. 939,329 chunks fold to 819,136 files, so about one chunk in eight has a second
copy somewhere in the install. A shared particle texture sits in a champion's archive and in
a map's.

**One file, one archive.** A copy writes a shared chunk once, under the archive the user
means, and never a duplicate. The mod does not need the second copy, and a layer that held
one would carry the game's own redundancy as its own weight.

The copy chooses the archive in this order, and stops at the first rule that answers.

| Rule | The archive                                 | Because                                                 |
| ---- | ------------------------------------------- | ------------------------------------------------------- |
| 1    | The scoped browser's own                    | The tab names it, and the scope is the user's statement |
| 2    | The only one, when one carries the chunk    | Seven chunks in eight                                   |
| 3    | One that the selected layer changes already | A modder at work on Aatrox keeps landing in Aatrox      |
| 4    | The one a segment of the path names         | `assets/characters/aatrox/…` names `Aatrox.wad.client`  |
| 5    | The user's pick, in the dialog              | Nothing else can answer                                 |

Rule 4 compares each segment of the path with each archive's file stem, without case. Rule 5
opens [the dialog](#the-dialog), and the select there starts on the archive that carries the
most files of the copy, so a batch from one champion lands in one place.

The index keeps the first archive of a chunk today and drops the rest. Rules 2 to 5 need
every one. A file that one archive carries costs what it costs now, and the 120,193 extra
copies cost a small integer each. `GameFileEntry` gains the list, and the row's tooltip and
the inspector read it.

#### The dialog

A copy runs without a dialog when nothing about it needs a decision, and one dialog carries
every decision it does need. Three things open it.

| Trigger                                     | The dialog shows                     |
| ------------------------------------------- | ------------------------------------ |
| A file exists in the layer with other bytes | The list, and Skip or Replace        |
| A shared chunk that no rule places          | The archives, as a select            |
| More than 200 files or 256 MB               | The count, the size and the archives |

A file that exists in the layer with the same bytes is no decision. The game's copy and the
layer's copy are one file, so the copy leaves it and the report counts it as skipped. The
question is asked about a file the modder changed, which is the one file a replace can cost
them.

**The answer is a setting.** The Project editor section of the settings gains **When a
copied file exists**: Ask, Skip or Replace. Ask is the default. A checkbox in the dialog,
**Do this every time**, writes the other two, so a user meets the setting in the flow and
not in a settings page. The setting is the application's, beside the tab open mode.

Ask is the default because two flows pull the other way, and nothing in a copy says which
one is at work. A modder who edits in the layer wants Skip, because a replace loses the
edit. A modder who pulls the game's files again after a patch wants Replace, because the
edit is the thing to redo. Either sets the answer once and never sees the question again.

The dialog's buttons are **Copy** and **Cancel**. Cancel writes nothing. The frontend has the
count and the size from the rows before the plan returns, which is what the size on a
directory entry is for, so the summary draws at once and the rest fills in.

#### The commands

Two commands, because the dialog needs three answers before anything is written, and the
backend is the side that holds them.

`plan_game_copy` takes the project, the layer and the targets. It walks each directory
target, applies the archive rules, and compares each file that exists in the layer with the
chunk's bytes. It returns the count and the size, the archive of each file, the files that
need a pick with their candidates, and the files that exist with other bytes. It writes
nothing, and it reads only the files that exist in the layer, which are few.

`copy_game_files_to_layer` takes the same, with the picks and the conflict answer, `skip` or
`replace`. Each file writes to a temporary name and renames into place, the rule
`add_files_to_layer` obeys. A copy that fails part way keeps the files it wrote, because
each is whole on its own, and the report names the one that failed. The report holds what
was written, what was skipped, what was replaced, and the archives.

| Target      | Holds                                | Expands to                         |
| ----------- | ------------------------------------ | ---------------------------------- |
| A file      | the archive and the path hash        | itself                             |
| A directory | an index path, and an archive or all | every file below it, in that scope |

The backend walks a directory, because the root browser never loaded its children. A copy
above the dialog's size line reports its progress, on the event shape the Fantome import
uses, and the toast holds the bar.

A target names its source the way an `AssetRef` does, so a later source copies through the
same two commands with one more variant: a mod package, a Fantome archive, a second install.
The views never learn which source they draw, and the copy never learns which view asked.

#### The report

- A toast: `Copied 12 files into base`, the archives in its description, and a **Show**
  action that reveals the first file in the layer tree
- The content tree refetches, so the layer tree and the WADs section show the new files
- The rows stay selected. A second layer takes the same files in two clicks, which is how a
  base and a chroma start

#### What ships in what order

| Step | Holds                                                                        |
| ---- | ---------------------------------------------------------------------------- |
| 1    | The model, its keys and its bar, in the tree. A size on a directory entry    |
| 2    | The commands, the menu, the bar's button, the dialog, its setting and report |
| 3    | `Ctrl+C` and `Ctrl+V`, with the paths on the system clipboard                |
| 4    | The held mark, and its switch                                                |
| 5    | The item drag, onto a surface to open and onto a layer to copy               |

Step 1 adds one field to one struct. Step 2 is the backend work, and it is where the index
starts to keep every archive of a chunk. Steps 3 to 5 change no backend. The tree is the
first view to mount the model because it is the view that exists. The grid and the details
list mount the same hook when they land, and none of the five steps waits on them. The layer
explorer takes the same model in a later pass, when a delete and a reveal give it an action
to act on.

### The held mark

An item of a game browser whose path the selected layer holds already draws a mark, and
`In base` on its tooltip. A directory draws it when any file below it does. Held is an item
state beside the three that [Selection](#selection) names, so each view draws it in its own
idiom: a dot in the accent before the size in the tree and the list, and a badge on the tile
in the grid.

This is the inverse of the inspector's **In the game archive** field, and it answers the
question that field cannot: which of the game's files does this mod change already? A
modder reads it across the whole game at one look, and a copy that would conflict is
visible before it starts.

No backend work. The content tree payload holds every path of the layer, and a set of those
paths, with the archive directory cut off, answers a row in constant time. The ancestors of
each path join the set once per layer, so a directory row answers the same way.

The mark follows the selected layer, so a switch in the Content section redraws it.
**In the layer**, a second switch in the kind menu of the two game explorers, narrows to the
marked rows. Read [Filtering](#filtering).

### Extract to disk

A modder does not always want a file in a mod. A texture goes to an image editor, a `.bin`
goes to ritobin, a mesh goes to a viewer, and a whole archive goes to a folder that other
tools read. The browser's second output is an extract to disk. It reads the same
selection, the same targets and the same directory walk as the copy, so a gesture that
copies is a gesture that extracts.

#### What extracts

| Gesture                                  | Extracts                                                       |
| ---------------------------------------- | -------------------------------------------------------------- |
| **Extract…** on the selection            | every selected file, and every file below a selected directory |
| **Extract…** on a directory              | every file below it                                            |
| **Extract…** on an archive row           | the whole archive                                              |
| **Extract archive…** in a scoped browser | the same, from inside the archive                              |
| `Ctrl+E`                                 | the selection, or the focused item when nothing is selected    |

The item reads **Extract…** with the ellipsis, because a dialog follows. It sits under
**Copy into base** in the same menu, on a row, a tile or an archive row alike, in every
view. An archive row is a row of the Game WADs tab or of the WADs section, and both gain
the menu and a hover action for it.

The Game WADs list takes [the selection model](#selection) too, so a user selects three
archives and extracts them in one go. Each archive lands in a directory of its own name.

#### The dialog

One dialog, remembered field by field, so the second extract is two clicks.

| Field                     | Holds                                                  | Default              |
| ------------------------- | ------------------------------------------------------ | -------------------- |
| Destination               | A folder, with a Browse button                         | the last folder used |
| Layout                    | **Keep paths** or **Flat**                             | Keep paths           |
| One folder per archive    | A switch. Adds `<Archive>.wad.client/` above each path | off                  |
| Existing files            | **Skip** or **Replace**                                | Skip                 |
| Open the folder when done | A switch                                               | on                   |

A summary line above the fields states the count, the size and the archives, from the same
plan the copy runs, so a user reads what a directory holds before the write starts.

**Keep paths** writes each file at its game path under the destination, which is what
wadtools does and what a repack needs. Two extracts into one folder merge into one mirror
of the game, and a modder builds that mirror over a month without a thought.

**Flat** writes every file into the destination by its name alone. A second file of the
same name takes its path hash before the extension, `aatrox_base_tx_cm.0123456789abcdef.tex`,
so nothing is lost and nothing is asked.

**One folder per archive** writes the layout a layer holds. A folder extracted with it
drops straight onto a layer through **Add WAD folder**, so an extract is also a way to
stage a layer outside the project.

The destination refuses a folder inside the League install. The manager never writes into
the game directory, and an extract is not the exception.

**The filter chips.** An extract writes what the explorer shows. A user who filtered the
tree to textures and extracts a directory gets its textures, and the dialog names the chips
in its summary, `Textures only`, with a control to lift them for this one extract. wadtools
has the same switch as `--filter-type`.

#### Without the dialog

A dialog per file is the price of the first extract, not of every one. Once a folder has
been picked, every menu that carries **Extract…** carries two items above it, and the
dialog moves to `Ctrl+Shift+E`. The three read the same on a file row, a directory row, an
archive row, a right click on the tab itself, and the row under an archive or a preview
tab, because each of those differs only in what the aim expands to.

- **Copy into `<layer>`**, `Ctrl+I`, writes the aim into the selected layer exactly as
  [Copy into a layer](#copy-into-a-layer) has it - at the game path under
  `<Archive>.wad.client/`, and never over a file already sitting there
- **Extract to `<folder>`**, `Ctrl+E`, writes the aim into the last folder used, on the
  answers the dialog last took

Neither is drawn where it has nowhere to go. Until a folder has been picked there is
nothing to repeat, so the quick item is absent and `Ctrl+E` opens the dialog instead, and
a project with no layer shows no copy.

`Ctrl+I` is an interim key. The design gives the direct copy none of its own, because
`Ctrl+C` and `Ctrl+V` are its keyboard route, and the game clipboard is unbuilt - so
`Ctrl+C` stays free for it.

A preview tab offers the two, and not the dialog: **Save a copy…** is already the whole of
the dialog one file needs, since its save dialog names the file and picks the folder.

An extract runs alongside whatever comes next. The dialog shuts on **Extract**, and the
bar and its **Cancel** ride the toast, so a modder browses on while an archive is read.
One runs at a time, and a second request is answered rather than queued.

#### The rules

wadtools is the reference, and its rules are the crate's rules. Read
`crates/wadtools/src/extractor.rs` in `LeagueToolkit/wadtools` and
`crates/ltk_wad/src/extractor.rs` in `LeagueToolkit/league-toolkit`.

| Case                                  | The file is named                                          |
| ------------------------------------- | ---------------------------------------------------------- |
| A resolved path                       | the path, as the hash table names it                       |
| An unresolved hash                    | `<hash>.<ext>`, the extension from the sniff               |
| A path with no extension              | `<stem>.ltk.<ext>`, or `<stem>.ltk` when no sniff names it |
| A path that collides with a directory | the same `.ltk` form                                       |
| A name too long for the file system   | `<hash>.<ext>`, in the destination root                    |

- A write is whole or absent. **Skip** opens the file with `create_new`, so an existing file
  is skipped without a race, and **Replace** writes over it. This is wadtools' `--overwrite`
  switch, and Skip is its default too
- A chunk is read once, raw, and decompressed on a worker, so the archive is read in order
  while the disk writes in parallel. A bounded channel between the two caps the memory, and
  this is the pipeline wadtools runs
- The report counts what was written, what was skipped, the bytes, and the files by kind,
  which is wadtools' `--stats`

#### The extractor lives in `ltk_wad`

Two copies of the rules exist today, one in `ltk_wad::WadExtractor` and one in wadtools'
own `Extractor`, and they agree line for line on the naming. The library copy extracts a
whole archive alone, in sequence, and always over an existing file. The tool's copy has
everything else, and nobody else can call it.

The manager needs the tool's copy as a library, so the default extractor in `ltk_wad` takes
what wadtools holds, and wadtools drops its own.

| The crate gains                           | Comes from                  |
| ----------------------------------------- | --------------------------- |
| A chunk subset, and not the whole archive | new, for a selection        |
| The flat layout, with the hash suffix     | new                         |
| Skip or replace, through `create_new`     | wadtools                    |
| Bytes and by-kind counts in the result    | wadtools                    |
| The parallel reader and writer pipeline   | wadtools                    |
| A cancel flag the reader tests            | new, for the toast's Cancel |
| Names recovered from `.bin` files         | wadtools, on a byte scan    |

`PathResolver` stays the seam, and any `HashMap<WadHash, String>` is one. A resolver answers
`None` for a hash it has no name for, and the crate writes that chunk under its hash. The
manager's resolver is the game index itself, which resolved every path through the mimir
tables at the build, so the extractor asks nothing the index has not answered already.

**What the name recovery costs, measured.** The crate reads a bin's strings as the
length-prefixed runs the format writes, with no parse of the object tree, and it tells a
bin from any other chunk by its first block alone, through one zstd context kept for the
whole pass. Against wadtools' full parse on the same install, the names come out
identical: 2,600 for `Aatrox.wad.client` and 60,326 for `Global.wad.client`, with no hash
table at all. `Global` takes 1.5 seconds that way, where the full parse takes 3.7. With the
mimir tables synced, 18 chunks of 560,894 across 205 archives have no name, and no bin
names them, so the pass finds nothing and costs half a second on `Global`. The pass is for
the machine whose cache is not synced yet.

This is a change in `LeagueToolkit/league-toolkit`, and the manager's extract waits on it.
It sits on the `feat/wad-extractor` branch there, as PR #183 of four commits, and a release
remains. The third commit reshapes the API, since the release breaks it anyway. The
extractor holds one `&dyn PathResolver`, and closures for the path filter and the progress.
`extract_chunks` takes path hashes, and lists the ones the archive lacks. Progress reports
each chunk once it is done, and a failure names its chunk through `WadError::Chunk`. The
fourth commit keys every chunk by `ltk_hash::WadHash`, the type a `WadChunkLink` in a bin
already holds, so a link read out of a bin looks its chunk up with no conversion. The
manager drives `WadExtractor` for a WAD import today, with the resolver that names
nothing, so the crate is a dependency already and the upgrade is a version bump and two
call sites.

#### The command and the report

`extract_game_files` takes the targets, the destination, the layout, the per-archive
switch, the existing-files answer and the kind filter. It expands the targets as
`plan_game_copy` does, groups the chunks by archive, mounts each through the WAD cache,
and drives the extractor once per archive.

- A progress event carries the count done, the total, the bytes, and the current path, on
  the shape the Fantome import uses. The toast holds the bar and a **Cancel**
- A cancel stops the reader, and the files written so far stay, because each is whole
- The report: `Extracted 1,204 files (312 MB)`, the destination as its description, the
  kinds under it, and an **Open folder** action. The folder opens itself when the switch
  says so

A preview tab's context menu gains **Save a copy…**, which is this extract for one file
through a save dialog, so a modder who has the texture open does not go back to the tree
for it.

#### What ships in what order

| Step | Holds                                                                      |
| ---- | -------------------------------------------------------------------------- |
| 1    | The crate: the subset, skip or replace, the stats, flat, the name recovery |
| 2    | The dialog and the command, on the selection and on a directory            |
| 3    | The archive rows, the Game WADs selection, and the scoped browser's action |
| 4    | The progress event, the cancel and the pipeline                            |
| 5    | `Ctrl+E`, **Save a copy…**, and the filter chips                           |

Step 1 is upstream. Steps 2 and 3 change the frontend and one command. Step 4 lands the
parallel pipeline in the crate and the cancel on both sides. The drag out of the window in
[Ideas for review](#ideas-for-review) is this extract with the desktop as the destination
and Flat as the layout.

### Hash names

A WAD archive stores a path hash and not a path, so the manager needs a hash table to show
a name.

The manager integrates the mimir shared cache for this. Read `LeagueToolkit/ltk-manager`
issue **#326**.

| Concern | What the mimir cache gives                                       |
| ------- | ---------------------------------------------------------------- |
| Size    | The game table is about 38 MiB, against 198 MiB of text          |
| Load    | The reader maps the file and parses nothing                      |
| Memory  | Every tool on the machine shares one copy through the page cache |
| Miss    | A miss costs one binary search and reads no string data          |

The `ltk_mimir_cache` crate finds the shared cache directory, reads its manifest and opens
the active table. `HashStore::open_layered` opens the `Game` table and the `Lcu` table as
one reader, and `get_batch` resolves the chunk hashes of a whole archive in one call. The
crate ships no HTTP client, so the manager supplies the download with the client that it
already holds.

A Cache tab in the settings owns the table state. It shows each table's entry count and
size, syncs the cache from the mimir releases, and re-downloads every table when a user
forces it. An empty cache never blocks the browser - every row still shows its hash.

The manager downloads the CommunityDragon `hashes.rst.xxh3.txt` list today, for the string
override editor. The mimir cache publishes that list as its `RstXxh3` table, so a later
pass removes the second download.

### The game index

The index holds the chunk table of every archive under `DATA/FINAL`, recursed. The game
holds no archive outside that directory. The browser reads the index and never mounts an
archive to draw a row. The overlay builder reads the same index, because the game gets one
index and not two.

The manager builds it in memory at the first read of a session. A live install measures
456 archives and 939,329 chunks, and the build takes 1.3 seconds. A directory read from
the built index takes 30 microseconds.

- The build starts at the first read, and not at application start
- Nothing writes it to disk yet, so it costs those seconds once per session. The
  memory-mapped cache below is what makes it survive a restart
- A build reports no progress yet, and the browser holds a spinner while it runs
- A rebuild is a control in the browser, because the index is a snapshot of an install
  that a patch can change under it

#### One tree

A chunk that several archives carry is the same file in each, so the index keeps the first
copy it reads and drops the rest. The 939,329 chunks of a live install fold to 819,136
files under 60,151 directories, and no pair of duplicates disagrees about its size.

The browser therefore draws one tree over the whole game. A modder looks for
`assets/characters/aatrox`, and which archive carries it is the install's business.

That tree is too large to hold at once. Its paths alone are about 62MB of text, which is
more than an IPC message should carry and more than a rendered tree should hold, so the
index answers one directory at a time and the browser reads a directory the first time a
user opens it.

#### Invalidation

Only a change of the game invalidates the index. The overlay keeps its own state file for
the mod set and the mod content, and the index holds neither.

A WAD header carries an xxh3 checksum of the data of the archive. The checksum sits in a
fixed prefix of the file, so a validation pass reads a few hundred bytes for each archive
and never touches a chunk table.

1. Read the header of every archive under `DATA/FINAL`.
2. Compare each header checksum against the checksum in the cache.
3. Keep the entries of an archive whose checksum matches.
4. Read the chunk table of an archive whose checksum differs, and replace its entries.
5. Remove the entries of an archive that the game no longer holds.
6. Write the new cache.

A game patch changes a few archives, so step 4 rebuilds a few archives. An archive that
the cache does not name is a new archive, and step 4 covers it too.

A format version in the cache header forces a full rebuild. The overlay artifacts obey the
same rule for the same reason. An index that a new release builds differently is stale,
and no checksum reports that.

**A change in `ltk_wad`.** The crate skips the header checksum today. `Wad::mount` seeks
over the field, so the crate must expose it before the index can obey this design. A
version 1 archive carries no checksum at all. The game ships version 3 archives, so the
index treats a missing checksum as a rebuild.

#### One cache, not two

`ltk_overlay::GameIndex` reads the same chunk tables today and writes its own
`game_index.bin`. Two caches over one set of bytes is one too many, so the memory-mapped
cache replaces it. The overlay builder and the game browser then read one file.

| Axis         | `game_index.bin` today         | The one cache                  |
| ------------ | ------------------------------ | ------------------------------ |
| Load         | MessagePack, and a full parse  | A map, and no parse            |
| Invalidation | One fingerprint for the game   | One checksum for each archive  |
| A game patch | Rebuilds every archive         | Rebuilds the changed archives  |
| A reinstall  | Rebuilds, because a time moved | Keeps, because the bytes match |
| Sizes        | Absent                         | Present, for the tree rows     |

The overlay reads the index by path hash, and the browser reads it by archive. One file
holds both directions, so neither reader builds a map at load.

**The whole-game fingerprint stays.** `OverlayState`, the incremental build and the per-mod
WAD reports each key on one `u64` for the game. The cache derives that value from the
archive checksums, in archive order, so every one of those readers keeps its current shape.
The value also improves. A checksum comes from the bytes and a file time does not, so a
reinstall of the same patch no longer forces a rebuild.

**Where the code lives.** `ltk_overlay` owns the game index, and the manager depends on
`ltk_overlay`. The cache therefore ships in the `LeagueToolkit/league-mod` workspace, and
the manager reads it through that crate. The manager builds no second index of its own.

## The panel layout

The editor grid holds its surfaces in a tree of splits. A user drags a tab onto the edge
of a surface and gets a second surface there, side by side with the first.

### What the layout governs

Two systems share regions 2 to 4, and a fixed boundary separates them. This is the shape
that Visual Studio Code uses.

| System          | Holds                                                    | Owns            |
| --------------- | -------------------------------------------------------- | --------------- |
| The shell       | The two side panels, and the editor grid between them    | The application |
| The editor grid | A split tree of editor surfaces, each with its own strip | The project     |

The title bar and the project header stay fixed above both. A fixed shell keeps one route
to every project action. A user who breaks a layout still finds Test, Pack and the way
back to the project list.

The side panels never enter the split tree. A side panel is not an editor surface: it
holds one view rather than documents, the shell names it, it hides rather than closes,
and it takes no tab drop. A tab dragged over one does nothing.

### The split tree

A node is a split or a leaf. A split holds two or more children, in a row or in a column.
A leaf is one editor surface: a tab strip over a stack of documents.

```ts
type LayoutNode =
  | {
      kind: "split";
      id: string;
      dir: "row" | "col";
      children: LayoutNode[];
      layout?: Record<string, number>;
    }
  | { kind: "leaf"; id: string; tabs: DocumentId[]; activeTab: DocumentId | null };
```

`layout` holds the sizes the seam library last reported, keyed by child id, and the editor
never authors a number into it. A split with no `layout` takes even shares. There is no
panel field, because every leaf is an editor surface. The side panels live in the shell,
and the game browser opens as a tab like any other document.

The shape of the tree gives each rule below, so no repair pass runs after an edit.

| Rule                                | What the tree does                                         |
| ----------------------------------- | ---------------------------------------------------------- |
| A closed panel gives its space back | Drop the leaf, and its share goes to the sibling beside it |
| A split with one child disappears   | Replace the split with that child, and its share survives  |
| A seam resize keeps the total       | The library reports the sizes, and the tree stores them    |
| The layout fills the window         | A share is a flex value, so no pixel math runs             |
| A hole or an overlap cannot appear  | Neither one has a form in the tree                         |

The tree is JSON already, so `.ltk/editor.json` holds it without a translation.

### What resizes a seam

`react-resizable-panels` gives the seam. The library is headless, it carries no dependency
of its own, and it names React 19 as a peer. The editor keeps its own markup and its own
tokens.

| Tree               | Library                                                |
| ------------------ | ------------------------------------------------------ |
| A split node       | `Group`, and `orientation` comes from `dir`            |
| A child of a split | `Panel`, with an `id` and a `minSize`                  |
| A seam             | `Separator`, which carries `role="separator"` and keys |
| `layout`           | `defaultLayout` in, and `onLayoutChanged` out          |

`onLayoutChanged` reports a layout after the pointer stops, and its second argument says
whether a user caused the change. The editor stores a layout on a user change alone, so a
first mount and a window resize write nothing.

A `Panel` must be a direct child of its `Group`. A nested split therefore renders as a
`Group` inside a `Panel`, and no wrapper comes between the two.

### Panel types

Each view below is one a side panel can host. A future view joins the same list, and needs
no new layout code. The editor surface is not on the list, because it is the grid between
the panels and not a view: it appears once for each leaf of the split tree. Read
[A tab drag creates a panel](#a-tab-drag-creates-a-panel).

- The project map, which holds Content, WADs and Strings
- The file tree of the selected layer
- The asset inspector
- The game browser
- The [problems list](PROJECT_PROBLEMS.md#the-problems-panel), when it arrives
- The merged layer view, when it arrives

### A tab drag creates a panel

A user drags a tab by its handle and drops it on the boundary of a panel. The tree wraps
that leaf in a split, and the tab moves into the new leaf. The new seam resizes like every
other seam.

- A drop on the top, the bottom, the left or the right boundary creates a panel there
- A drop inside a panel moves the tab into the tab strip of that panel
- A panel that loses its last tab closes, and the layout gives its space back
- Each panel holds its own tab strip and its own active tab

The tab strip drags with `@dnd-kit` today. The four boundaries of a leaf become drop
targets of the same kind, so one drag reaches both a reorder and a split.

An explorer item drags onto the same zones and opens rather than moves. Read
[An item is a drag source](#an-item-is-a-drag-source).

This gesture answers the question of how many times a panel type appears. The editor
surface appears as many times as the user drags, because a split is the purpose of the
gesture. Every other panel type appears once, because none of them holds a tab.

A user reaches a side by side read without a preset and without a layout dialog. Two layers
compare this way, and so do two [scoped game browsers](#scope-to-one-archive).

### Two libraries that do not fit

**`react-grid-layout`.** An earlier draft of this section named it. Its compaction moves a
panel and never grows one, so a closed panel leaves a hole where the rule above asks for
the space back. A resize changes one panel and pushes its neighbor, which is not a seam.
Its drop path reads native drag events, and the tab strip sends pointer events.

**`dockview`.** It gives the docking model that this section describes. It is not headless,
and it locks part of its feature set, so the editor cannot carry its own theme through it.

### Presets

A custom layout works against the second goal of this document, because it removes the one
clear place for each action. Named presets answer that cost.

| Preset   | Arrangement                                                      |
| -------- | ---------------------------------------------------------------- |
| Default  | The three regions of the Layout section, in that order           |
| Textures | A wide preview, a small tree, and the inspector below it         |
| Strings  | The string table at full width, and the project map only         |
| Compare  | Two editor surfaces beside each other, for a layer to layer read |

A preset is a grid tree plus the shell's own settings, so each row of this table is one
value in the application. A new user gets the Default preset and never opens the layout
controls. A reset control returns any layout to Default.

### What it replaces

Nothing. The layout control in the project header sets which side each side panel takes and
whether one shows, and those are the shell's questions. The split tree governs the editor
grid alone, so the two answer different regions. The control gains one action, which is
the reset of the grid.

### Where a layout belongs

A layout belongs to the project, and not to the whole application. Each project opens with
the arrangement that its own work needs.

A project has a shape. A skin project is texture work and wants a wide preview. A
localization project is table work and wants the string table at full width. The same
modder wants a different arrangement in each of the two, so one application-wide layout
serves the second project badly.

The tab strip is already per project, and the layout joins it. Together the two answer one
question, which is "where did I leave this project?"

#### The project directory holds it

The manager writes the layout into a `.ltk` directory of the project.

```
Charizard Smolder X/
├─ .ltk/
│  └─ editor.json
├─ content/
└─ mod.config.json
```

`editor.json` is JSON, because `mod.config.json` is JSON and one project does not need two
formats. `.ltk` is a directory and not a dotfile, so the per-project state that comes later
joins it without a second name at the project root.

A layout in the project directory travels. A project on a shared drive, in a Git repository
or out of a backup opens with the arrangement that it had.

**The tab strip moves with it.** The strip lived in browser storage, under the project path
as its key. A rename needed code to follow that key, and a second machine got nothing at
all. The `.ltk` directory removes both faults, so `editor.json` holds the open documents
and the active tab as well as the layout. A project that predates the file seeds it from
its browser storage entry on the first open, and the entry itself is left in place.

#### The cost, and the answer to it

A modder who prefers one arrangement everywhere must build it again in each new project.
This cost is the reason that the earlier decision put the layout in the application.

A default answers the cost. The application keeps one default layout, a new project starts
from a copy of it, and a control writes the current layout back as the new default. The
modder arranges the panels one time, and every later project opens that way.

## Ideas for review

These are proposals. None is a decision.

**A merged view.** A read-only tree that shows the result of every layer together, and
names the layer that wins for each path. A modder cannot answer "which file does the game
get?" today without a manual comparison. The **Also in layer** field of the inspector
answers this question for one file, and this view answers it for the whole project.

**A diff between layers.** Two layers hold the same path. A diff shows what one changes
against the other.

**A Git section in the primary side panel.** The changed files, a stage control and a
commit box, in the shape that Visual Studio Code uses.

**An empty state that teaches.** Each empty section names the first action in plain words,
and not only a button. This is the cheapest help for a new modder.

**A copy from the palette.** `Alt+Enter` on a game row of the project bar copies that file
into the selected layer, for the modder who holds the path as a string and wants the file
and not a preview. The bar already reads `Ctrl+Enter` for a split, so the modifier has a
home.

**A drag out of the window.** A game file dropped on the desktop extracts it. The item is a
drag source already, and the operating system is one more target, through a drag-out plugin
for Tauri. The payload is the same list, and the target runs
[the extract](#extract-to-disk) with the drop as the destination and Flat as the layout.

## Open questions

1. Does the `.ltk` directory belong in version control? A layout is a work habit, and the
   source control section covers the declarative data alone.
2. Does a back onto a document that was closed reopen it, or does the entry drop? The
   proposal drops it, so a back never lands on a tab that is gone. A reopen is the other
   reading, and it is what a user who closed a preview by mistake would want.
3. Which key opens the bar on a keyboard that is not `Ctrl`-based? The Linux and macOS
   builds are not in scope yet, and `Ctrl+P` is a Windows answer.
4. Does the sort belong to the application or to each explorer? One sort for every explorer
   is one thing to learn, and a modder reading the game index by size may still want their
   own layer by name.
5. Does a thumbnail survive a scroll? Nothing is stored today. A bounded cache of encoded
   thumbnails is the escalation, and a measurement should buy it.
6. Does an extract obey the filter chips? The proposal says yes, because the explorer shows
   what the extract writes and the dialog names the chips. The other reading extracts the
   whole directory and leaves the chips to the view.
7. Where does the first extract go? The proposal remembers the last folder and starts with
   none, so the first extract asks. A default under the user's documents is the other
   reading, and it saves one click once.

### Answered

| Question                                         | Answer                                              |
| ------------------------------------------------ | --------------------------------------------------- |
| Does the bar reach a second project?             | Yes. Projects answers from either surface           |
| Where does the route back to Workshop live?      | A crumb inside the project bar                      |
| Does the project name title stay in the header?  | No. The bar carries the name and the version tag    |
| Does the palette search the installed game?      | Yes, in a section that streams in after the project |
| Can a user turn a search source off?             | Yes, in the Project editor settings                 |
| What do the `←` `→` arrows walk?                 | The shell's navigation history, with the position   |
| Does the navigation history survive a restart?   | No. The stack is the session's                      |
| Which library builds the palette?                | None. It is `@/components` over base-ui             |
| Which side matches the game's 819,136 paths?     | The backend, which is the only side that holds them |
| Which group does a preview open into?            | One of its own, beside whoever asked for it         |
| Does a single click in a tree open a file?       | No. A double click does, or the row's Open item     |
| Does opening a file add a tab or reuse one?      | Adds one, and a setting switches it to reuse        |
| How many archives stay mounted behind a preview? | Four, and the least recently used one gives way     |
| How do a preview's pixels reach the webview?     | An `ltk-asset` URI scheme, and not an IPC result    |
| What does a preview read an asset's bytes from?  | A reference: a layer file, a game chunk, or a file  |
| Does the secondary side panel hold another view? | No view today, and the panel stays generic          |
| Does the search box read one layer or every one? | Every layer                                         |
| Does a layer change close the preview tabs?      | No, and a title takes a `<layer>/` prefix instead   |
| Where does a saved layout belong?                | The project, in `.ltk/editor.json`                  |
| Which declarative data type comes first?         | Property bin links                                  |
| Where does the game browser open?                | A tab, and a panel type for either side panel       |
| Which hash table resolves a WAD path?            | The mimir shared cache                              |
| How many game index caches does the app keep?    | One, and it is the memory-mapped one                |
| Does the root browser show a row for an archive? | No. The Game WADs tab is where one opens            |
| Which archives does the game index cover?        | Every archive under `DATA/FINAL`, recursed          |
| How many game browsers open at one time?         | One for the game, and one for each archive          |
| Can one panel type appear more than one time?    | The editor surface can, by a tab drag               |
| Which model arranges the panels?                 | A split tree, and not a free-form grid              |
| Which library resizes a seam?                    | `react-resizable-panels`, which is headless         |
| Does a project with one filled panel show two?   | It cannot, because the layout is per project        |
| Do the side panels enter the split tree?         | No. They stay the shell's, as in Visual Studio Code |
| Where do a second surface's tabs go on a reset?  | Into the surviving strip, in reading order          |
| Does an explorer have a current directory?       | Yes. The location, and the breadcrumb names it      |
| How many views does an explorer draw?            | Three. The tree, the grid and the details list      |
| Where does a tile's thumbnail come from?         | The `ltk-asset` scheme, at the tile's own width     |
| Which rows does a filter box read?               | The location, and everything below it               |
| Does a leaf ever draw a second row of chrome?    | The explorers do. A location is not a title         |
| Can the palette find a bin object by its path?   | Yes, once the object index lands                    |
| Which side holds the object names?               | The mimir cache. The manager stores no second copy  |
| Why does `ltk_meta` block the object index?      | Its read is eager, and 242x the header scan         |
| Does the object cache hold resolved names?       | No. 359,095 hashes resolve at load in 200ms         |
| Does the object index read the project's bins?   | Yes, and that half ships first                      |
| Which side matches the project's objects?        | The frontend, on the content scan's payload         |
| Does a bin's dependency list earn a stored edge? | Yes, and never a stored closure                     |
| Which reader wants the dependency graph?         | Not search. The link picker and the problems list   |
| Does the tree gain the grid's multi-select?      | Yes. A selected directory is every file below it    |
| Does a shared chunk land under every archive?    | No. One file, under the archive the copy chooses    |
| Does `Ctrl+C` reach the system clipboard?        | Yes, with the chunk paths, one on each line         |
| Is the conflict answer a setting?                | Yes. Ask, Skip or Replace, and Ask is the default   |
| Does the layer file tree take the selection now? | No. The copy runs from the game into the mod        |
| How does an unnamed chunk get an extension?      | `LeagueFileKind::identify_from_bytes`, as wadtools  |
| Does the selection belong to a view?             | No. To the explorer, and a view switch keeps it     |
| What does an item dropped on a surface do?       | Opens there. A tab moves, and an item opens         |
| Which crate holds the extractor?                 | `ltk_wad`. wadtools and the manager both drive it   |
| Does an extract keep the game paths?             | Yes by default, and a switch flattens it            |
| How does the crate recover a chunk's name?       | A byte scan of the bins, found by their first block |
| Where do the manager's checks collect?           | One Problems panel, on a rule for each check        |
| What repairs a mod that a game patch broke?      | Problems, on a migration table shipped in the build |

A row moves here when the body of this document carries the answer.
