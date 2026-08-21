# Project Editor

## Changes

| Date       | Change                                                                     |
| ---------- | -------------------------------------------------------------------------- |
| 2026-08-21 | Draw a bin as blocks, and move the preview into its own document           |
| 2026-08-20 | Match a run of characters and every term, not a subsequence                |
| 2026-08-20 | Search the whole install from the bar, on a scorer in Rust                 |
| 2026-08-20 | Build the project bar, its palette and the history arrows                  |
| 2026-08-20 | Keep the bin dependency graph, and compute a closure rather than store one |
| 2026-08-20 | Index the project's own bin objects, and search them first                 |
| 2026-08-20 | Search every bin object path, on an index the palette reads                |
| 2026-08-20 | Give the explorers a location, a breadcrumb, a grid and a sort             |
| 2026-08-19 | Propose the project bar, its palette and the history arrows                |
| 2026-08-19 | Open on a double click, into a preview group beside the browser            |

Each edit of this document adds a row at the top. The table keeps the last ten rows.

The project editor is the LTK Manager screen for work on one mod project. The core design
idea is an IDE for League mods. A user opens a project, reads its content, changes what the
mod declares, and packs the result.

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

| Feature                | Status      | Note                                                        |
| ---------------------- | ----------- | ----------------------------------------------------------- |
| Layer file tree        | Available   | Moves to the secondary side panel                           |
| Mod details document   | Available   | -                                                           |
| String overrides       | Available   | -                                                           |
| Tab strip, per project | Available   | -                                                           |
| Tab context menu       | Available   | The four closes, copy path and copy name, and the splits    |
| Secondary side panel   | In progress | Holds the file tree and the asset inspector                 |
| Preview tabs           | Available   | A tab of its own, or one replaceable tab. A setting picks   |
| Tree search            | Planned     | Reads every layer, and groups a result by layer             |
| Tab title prefix       | Planned     | `<layer>/<file>` when two tabs take the same name           |
| Panel host choice      | Planned     | Either side panel accepts any panel type                    |
| Tree expansion rules   | Planned     | Stops the full expand of every directory                    |
| Layer conflict mark    | Planned     | No backend work, because the payload holds every layer      |
| Asset inspector        | Planned     | Takes the fields that a tree row cannot hold                |
| Directory size and bar | Planned     | Needs a size total for each directory                       |
| File type filter       | Planned     | One of the three explorer filters. Uses the reported kind   |
| Explorer bar           | Proposed    | The location, the breadcrumb and the view controls, one row |
| Breadcrumb navigator   | Proposed    | Crumbs with sibling menus, and `Ctrl+L` for a typed path    |
| Grid view              | Proposed    | One directory as tiles, in any of the three explorers       |
| Asset thumbnails       | Proposed    | A small mipmap over `ltk-asset`, at the tile's own width    |
| Details list           | Proposed    | The third view. Name, size, kind, and modified where it is  |
| Explorer sorting       | Proposed    | Name, size and kind, and the directories first              |
| Multi-select and copy  | Proposed    | What makes a copy of many game files worth the trip         |
| Image preview          | Available   | DDS and TEX through the `ltk_texture` crate                 |
| Bin preview            | Planned     | Blocks over the parsed tree. [Bin editor](BIN_EDITOR.md)    |
| Mesh preview           | Planned     | A model in a small viewport                                 |
| Modified time          | Planned     | Needs a time field in the content scan                      |
| Game archive check     | Planned     | Finds a path that the game never reads. Uses the index      |
| Game browser           | In progress | One folded read-only tree. Search remains                   |
| Game index             | In progress | Folded, in memory and searchable. The mmap cache remains    |
| Scoped game browser    | Available   | One tab for each archive, from either list of archives      |
| Hash names from mimir  | Available   | The shared cache, synced from a Cache tab in the settings   |
| Copy into a layer      | Planned     | Writes a game file into the selected layer                  |
| Property bin links     | Planned     | First declarative type. `league-mod` issue **#190**         |
| PTCH targeting         | Planned     | Second declarative type. `league-mod` issue **#191**        |
| Source control section | Planned     | Git history for the declarative data                        |
| Panel split layout     | Available   | A split tree, on `react-resizable-panels` seams             |
| Per-project layout     | In progress | `.ltk/editor.json` is in, versioned. An in-app pass remains |
| Project bar            | Available   | Takes the header's middle, from the project name title      |
| Command palette        | In progress | The project and the game are in. The bin objects remain     |
| Bin object search      | Planned     | The project's objects, and the install's behind the blocker |
| Project object index   | Planned     | The layers' own bins, rebuilt with the content scan         |
| Bin object index       | Blocked     | The install's half. A lazy `ltk_meta` read comes first      |
| Bin dependency graph   | Proposed    | Kept by the object scan. `#190` is its first reader         |
| Navigation history     | Available   | The `←` `→` arrows, one stack for each project              |
| Quick open             | Available   | Absorbed by the project bar, which is the box it asked for  |
| Merged layer view      | Proposed    | Names the layer that wins for each path                     |
| Layer diff             | Proposed    | Compares one path across two layers                         |
| Problems list          | Proposed    | Collects the validation results in one panel                |
| Texture facts          | Available   | In the preview's status strip. The inspector row remains    |

## Scope

The editor separates two kinds of content, and treats them in opposite ways.

**Declarative data.** The project declares this data in its own configuration. The overlay
builder applies it when the manager patches the mod into the game. A user edits declarative
data in the editor.

**Assets.** These are the game files that the mod ships, such as a texture, a mesh or a
`.bin` file. The editor reads an asset and can show a preview. It does not change the bytes
of an asset. A user manages which files a layer holds, and edits a file itself elsewhere.

The [game browser](#game-browser) reads the assets of the installed game under the same
rule. It never writes into the game directory, and a copy into a layer is its one output.

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

## The project bar

The header's middle holds one control. It names the project while nothing is happening, and it
is the route to every file, every command and every path of the game as soon as a user types
in it. To its left are the two arrows that walk the project's navigation history.

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

The two arrows to the left of the bar walk one stack for each project. This is the Go Back of
Visual Studio Code and not the Back of a browser, so it answers where a user was in the editor
rather than which page the application showed.

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
view that draws tiles, and the sorting and filtering that a list of files asks for.

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

A tree holds a focused row today and no selection. The grid holds a selection, because the copy
that the game browser exists for is worth doing to more than one file at a time.

| Gesture             | Does                                        |
| ------------------- | ------------------------------------------- |
| A click             | Selects one                                 |
| `Ctrl` and a click  | Adds one, or removes one                    |
| `Shift` and a click | Extends from the anchor                     |
| `Ctrl+A`            | Selects the directory                       |
| A double click      | Opens a file, and descends into a directory |

The context menu acts on the selection, so **Copy into the layer** writes every selected file.
That is the gesture that turns a screen of thumbnails into a layer.

The tree keeps its single focus for now. Multi-select in a tree spans depths and has to answer
what a selected directory means, and neither question blocks the grid.

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

`workshopLayout` holds the application's four, beside the preview zoom and the tab open mode
that it holds now. `.ltk/editor.json` holds the document's, with the tabs and the split tree.
The layer file tree of the side panel is not a document, so its location joins the collapse
state that the workshop store already keys by layer.

### Accessibility

- The grid is `role="grid"` over `role="row"` and `role="gridcell"`, and the tree keeps
  `role="tree"`
- The breadcrumb is a `nav` labelled `Location` over an ordered list, and the last crumb carries
  `aria-current="page"`
- A thumbnail is `alt=""`. The tile's name is the label, and a second reading of it is noise
- The grid holds one tab stop and moves a roving focus, the rule that the trees obey

### What ships in what order

| Step | Holds                                                                       |
| ---- | --------------------------------------------------------------------------- |
| 1    | The bar, the location, the breadcrumb and the path input, in tree mode      |
| 2    | The grid, the tile size, the thumbnail switch, and the `w` parameter        |
| 3    | The sort, the kind filter and the chips, over every view                    |
| 4    | The details list, the selection, and the recursive filter of the game index |

Step 1 changes no backend. Step 2 changes one URL. Step 3 changes none. Step 4 waits on the
scorer that [the project bar](#the-project-bar) builds.

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

The copy is the purpose of the whole view. The browser writes the selected file into the
selected layer at the path that the game reads, so the path is correct by construction.
This removes the most common fault of a new mod.

- A copy of a file writes one file
- A copy of a directory writes every file below it
- A target file that exists asks first
- A file with an unknown path lands under its hash, in hex

The Content section of the primary side panel sets the target layer. This is the same
selection that the secondary side panel reads.

The hex name loses nothing. The overlay builder reads a file stem of sixteen hex digits as
the chunk hash itself, so a copy under a hex name targets the same chunk as a copy under a
path.

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
- The problems list, when it arrives
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

**A problems list.** A panel that collects validation results, such as a missing hash or a
`.bin` reference that points at nothing. This turns a failed patch into a list of items to
fix.

**A Git section in the primary side panel.** The changed files, a stage control and a
commit box, in the shape that Visual Studio Code uses.

**An empty state that teaches.** Each empty section names the first action in plain words,
and not only a button. This is the cheapest help for a new modder.

## Open questions

1. Does the `.ltk` directory belong in version control? A layout is a work habit, and the
   source control section covers the declarative data alone.
2. Does a back onto a document that was closed reopen it, or does the entry drop? The
   proposal drops it, so a back never lands on a tab that is gone. A reopen is the other
   reading, and it is what a user who closed a preview by mistake would want.
3. Does the bar reach a second project, or the application outside a project? The crumb is
   the route out today. A `Workshop /` scope over every project is the next step, and the
   workshop list has its own filter bar already.
4. Which key opens the bar on a keyboard that is not `Ctrl`-based? The Linux and macOS
   builds are not in scope yet, and `Ctrl+P` is a Windows answer.
5. Does the sort belong to the application or to each explorer? One sort for every explorer
   is one thing to learn, and a modder reading the game index by size may still want their
   own layer by name.
6. Does the tree gain the grid's multi-select? A selection that spans depths has to answer
   what a selected directory holds, and a copy is the only action that wants it.
7. Does a thumbnail survive a scroll? Nothing is stored today. A bounded cache of encoded
   thumbnails is the escalation, and a measurement should buy it.

### Answered

| Question                                         | Answer                                              |
| ------------------------------------------------ | --------------------------------------------------- |
| Where does the route back to Workshop live?      | A crumb inside the project bar                      |
| Does the project name title stay in the header?  | No. The bar carries the name and the version tag    |
| Does the palette search the installed game?      | Yes, in a section that streams in after the project |
| Can a user turn a search source off?             | Yes, in the Project editor settings                 |
| What do the `←` `→` arrows walk?                 | The editor's navigation history, with the position  |
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

A row moves here when the body of this document carries the answer.
