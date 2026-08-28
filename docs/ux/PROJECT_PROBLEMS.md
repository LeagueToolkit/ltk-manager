# Project problems

## Changes

| Date       | Change                                                            |
| ---------- | ----------------------------------------------------------------- |
| 2026-08-28 | Preserve the names a fix hashes, and drop the restore point       |
| 2026-08-28 | The library surface ships, and moves to MOD_HEALTH.md             |
| 2026-08-24 | Draw the forward-looking lints by default, dimmed                 |
| 2026-08-24 | Give the forward-looking switch a row, and drop the notice        |
| 2026-08-23 | Put the forward-looking lints behind one editor setting           |
| 2026-08-23 | Mute what waits for a build, rather than withholding it           |
| 2026-08-22 | Wait for the build a table names, and let a modder ask anyway     |
| 2026-08-22 | Group by object, open as a tab, and let a run carry its own words |
| 2026-08-22 | Run on open, fix every layer, and keep three restore points       |

Each edit of this document adds a row at the top. The table keeps the last ten rows.

Problems is the LTK Manager feature that checks a mod project and says what is wrong with it.
The core design idea is one list, one shape, and a repair where a machine can make one. A
modder opens a project, reads what the manager found, and clicks Fix.

The feature has two halves that this document keeps apart on purpose. The **model** is generic:
a rule finds problems, a problem names a place, and some problems carry a fix. The **rules** are
specific, and the first one is the reason the feature exists now. Riot is about to change the
declared type of several hundred `.bin` properties, and every mod that ships the old type stops
working on the day that build lands.

## Goals

- A modder learns what is wrong with their mod before the game refuses it
- One panel collects every check the manager runs, and each check reads the same
- A problem a machine can repair is repaired by one click
- A repair that was wrong is reversed by one click
- A new check is a rule and a row, and never a new panel

## Feature status

This table holds every major feature of Problems. A status word has one meaning.

- **Available** - the feature is in the application today
- **In progress** - work started, and the feature is not complete
- **Planned** - the team agreed on the feature, and work did not start
- **Proposed** - an idea for review, and not a decision
- **Blocked** - the team agreed on the feature, and a change outside this repository has
  to land first

| Feature              | Status    | Note                                                                   |
| -------------------- | --------- | ---------------------------------------------------------------------- |
| The problem model    | Available | `Rule`, `Problem`, `Fix`, `Run`, in the core crate                     |
| The run engine       | Available | Reads every layer, groups by file, holds the last run                  |
| Bin retype rule      | Available | `bin/property-type`. The first rule, and the urgent one                |
| The migration table  | Available | 395 rows, `include_str!` into the core crate                           |
| The fix preview      | Available | The before value and the after value, for each problem                 |
| Preserved names      | Available | A fix writes what it hashes into the mod's own `hashes/`               |
| The problems tab     | Available | A document of the editor surface, and not a side panel                 |
| The run's own words  | Available | A rule's title and an object's path, sent once for a run               |
| Grouping by object   | Available | A file's findings sit under the bin object that holds them             |
| The count in the bar | Available | An error count beside Test, which opens the tab                        |
| Forward-looking lint | Available | On by default, muted, and a switch in a row under the filter           |
| Open at the property | Blocked   | Needs the [bin editor](BIN_EDITOR.md). Reveals the file now            |
| Hash-name repair     | Proposed  | The 8 rows that need `binhashes` to name a hash                        |
| Move the old checks  | Proposed  | The three checks below become rules and lose their shapes              |
| Linked bin rule      | Proposed  | `bin/missing-link`, from the overlay build's offenders                 |
| Archive path rule    | Proposed  | `wad/unknown-path`. The game archive check, as a rule                  |
| Library mod problems | Available | The mod-user surface. Its own document, [MOD_HEALTH.md](MOD_HEALTH.md) |

## Scope

In scope is one open project. The manager reads the `.bin` files of every layer, reports what
is wrong, and writes a repaired file back where a rule can derive one.

Out of scope:

- The installed library's mods. The same rules reach them now through their own surface,
  [MOD_HEALTH.md](MOD_HEALTH.md) - a verdict and one button rather than a panel. Read
  [The library waited](#the-library-waited) for why that half came second
- The installed game. The [game browser](PROJECT_EDITOR.md#game-browser) never writes, and
  this feature adds no exception
- Editing a value by hand. That is the [bin editor](BIN_EDITOR.md), and this panel is one of
  the things that opens it
- A second bin parser. The format belongs to `ltk_meta`
- Deciding what Riot changed. The table is an input, and the manager does not derive one

## Vocabulary

| Word          | Meaning                                                                  |
| ------------- | ------------------------------------------------------------------------ |
| Rule          | One check. It has a stable id, it finds problems, and it may repair them |
| Problem       | One finding, at one site, from one rule                                  |
| Site          | Where a problem is: a layer, a file, and a place inside the file         |
| Fix           | The repair a rule can make for one problem                               |
| Run           | One pass of every rule over one project                                  |
| Fix run       | One application of the fixes a user chose, and the writes it made        |
| Restore point | The copies a fix run wrote before it changed anything                    |
| Object        | One entry of a `.bin`, addressed by the hash of its path                 |
| Migration     | One row of the table: a class, a field, the old type, and the new one    |
| Dormant       | A rule whose change the installed game has not taken. It looks ahead     |

## Why not "diagnostics"

The word is taken. [League diagnostics](LEAGUE_DIAGNOSTICS.md) is the feature that reads a
failed launch, and it owns `core/src/diagnostics/` and `src/modules/diagnostics/`. A second
feature under the same word would make every import a question.

Problems is also the word a modder already knows from Visual Studio Code, and the project
editor has used it since the panel was first proposed. The code follows the document:
`core/src/problems/` and `src/modules/workshop/problems/`.

## What exists today

The manager runs three checks. Each has its own type, its own surface and its own life, and
none of them can say where a problem is in a way a user can click.

| Check              | Produces                | Surface                | Location |
| ------------------ | ----------------------- | ---------------------- | -------- |
| `validate_project` | Two `Vec<String>`       | A dialog before a pack | None     |
| Linked bin check   | `LinkedBinOffenderInfo` | A warning in Library   | A mod id |
| WAD report         | `ModWadReport`, on disk | The mod's own page     | A mod    |

A string is not a finding. `"Invalid version format: 1.0 (expected semver like 1.0.0)"` says
what is wrong and nothing about what to do or where to go. This feature is the shape those
three should have had, and moving them onto it is what proves the shape is generic.

## The model

```
the project's .bin files
        │
        ▼
   ┌────────┐      the table, in the build
   │  rule  │ ◀────  395 rows, keyed by (class, field)
   └───┬────┘
       │ problems
       ▼
   ┌────────┐
   │  run   │      what the panel draws
   └───┬────┘
       │ the ones a user applies
       ▼
   ┌────────┐      hashes/game.hashes.txt
   │  fix   │ ────▶  every path it is about to hash
   └───┬────┘
       ▼
  one write for each file
```

### A rule

```rust
/// One check the manager runs over a project.
pub trait Rule {
    /// The stable id a user reads, such as `bin/property-type`.
    fn id(&self) -> RuleId;

    /// A few words naming the state the rule objects to.
    fn title(&self) -> &'static str;

    /// One sentence saying what that state is.
    fn description(&self) -> &'static str;

    /// Why this rule waits for something the project does not have yet.
    ///
    /// `None` for a rule that speaks about every project, which is most of
    /// them. It changes nothing about what `check` reports - it is how the
    /// panel knows which rows to mute. Read
    /// [A rule that waits](#a-rule-that-waits).
    fn dormant(&self, project: &ProjectFiles) -> Option<String>;

    /// Find every problem this rule sees, and add it to `report`.
    fn check(&self, project: &ProjectFiles, report: &mut Report);

    /// Repair `problems`, and record every write in `run`.
    ///
    /// # Errors
    ///
    /// Reports the first file it could not read or write. What the run had
    /// already written stays written, and a second run picks up the rest.
    fn fix(&self, problems: &[&Problem], run: &mut FixRun<'_>) -> Result<Applied, FixError>;
}
```

An id has two parts. The first names what the rule reads, and the second names the state it
objects to. `bin/property-type`, `bin/missing-link`, `wad/unknown-path`. A user reads the id in
a row's tooltip, because an id is what they paste into a search when they want to know more.

**A rule says what it is, and a problem says only what it found.** The title is what the row
draws first, and the description is the sentence under it in the tooltip. Both are the same
words on every row a rule produced, so they ride on the run rather than on the problem. Read
[What rides on the run](#what-rides-on-the-run).

### A problem

```rust
/// One finding, at one site, from one rule.
pub struct Problem {
    /// Stable within a run, so the panel keys a row by it.
    pub id: ProblemId,
    pub rule: RuleId,
    pub severity: Severity,
    pub site: Site,
    /// The types this problem is about, where the rule is about types.
    pub mismatch: Option<TypeMismatch>,
    /// What this one problem needs said that the rule's description does not.
    pub message: Option<String>,
    /// What a repair would change, drawn before it is applied.
    pub fix: Option<FixPreview>,
}
```

**A problem is a description and never a plan.** It says what is wrong and what a repair would
look like. It does not carry the steps of that repair. The rule derives those again, from the
file on disk, at the moment a user applies them. Read
[A fix re-checks first](#a-fix-re-checks-first) for what that buys.

**A row says nothing twice.** The rule's title and description carry what every row of a run
has in common, and the two types carry the finding, so the ordinary retype needs no sentence of
its own and `message` is absent on it. What earns a message is the row that is unusual - a
conversion nothing can repair, an override bin, an install that has not taken the change yet. A
sentence repeated on seven thousand rows is not information. It is the shape of the list.

```rust
/// A property whose declared type is not the one the game reads.
pub struct TypeMismatch {
    /// The type the game reads, such as `File`.
    pub expected: String,
    /// The type the file declares, such as `String`.
    pub found: String,
}
```

The two arrive apart rather than as one sentence, because the panel sets each of them in code
type inside prose it writes itself.

```
Expected `File`, found `String`
```

### Where a problem is

```rust
/// Where a problem is.
pub struct Site {
    /// The layer, such as `base`.
    pub layer: String,
    /// The file, POSIX-style and relative to the layer root.
    pub path: String,
    /// Where inside the file. `None` for a rule that reads a file as a whole.
    pub node: Option<NodeAddress>,
}
```

`NodeAddress` is the bin editor's own address - an entry hash and a property path - and this
feature takes it rather than inventing a second one. Read
[Addressing a node](BIN_EDITOR.md#addressing-a-node). A row therefore knows the exact property,
and Enter opens it once the bin editor lands.

Written for a person the three join in reading order.

```
base · data/characters/smolder/skins/skin0.bin · Characters/…/Skin0:iconPath
```

### The severities

| Severity | Means                                               | Drawn as    |
| -------- | --------------------------------------------------- | ----------- |
| Fatal    | The game crashes on this                            | `⊗`, filled |
| Error    | The game rejects this. The mod does not work        | `⊗`         |
| Warning  | The game accepts this, and something is still wrong | `⚠`         |
| Info     | Worth knowing, and nothing is wrong                 | `ⓘ`         |

A fill is reserved for the one severity that crashes the game, so the glyphs rank the four the
same way the severities do.

A rule picks the severity for each problem rather than for itself, because the same rule can
find more than one. The retype rule is the case that proves it. Read
[The build the table names](#the-build-the-table-names).

### A fix

A fix belongs to the rule that found the problem. There is no generic apply step, because
"replace a value" means nothing without the format that holds it.

What the model does own is the preview, because that is the part a user reads.

```rust
/// What a repair would change, in the words a row draws.
pub struct FixPreview {
    /// What the values alone do not say, such as `3 items`.
    pub note: Option<String>,
    /// The value now, rendered.
    pub before: Option<String>,
    /// The value after, rendered.
    pub after: Option<String>,
}
```

Every field is optional because the three cases differ. A leaf has a value before and after, a
container has a count where a leaf has a value, and a conversion that rewrites the type without
touching the value has neither.

## The engine

### What a run does

A run walks each layer's content directory, hands the files to each rule, and collects what the
rules report. It produces one `Run`.

```rust
/// One pass of every rule over one project.
pub struct Run {
    /// When the run read the files.
    pub at: DateTime<Utc>,
    /// Every check that ran, whether or not it found anything.
    pub rules: Vec<RuleInfo>,
    /// The name of every object a problem sits in, where a table holds one.
    pub objects: Vec<ObjectInfo>,
    pub problems: Vec<Problem>,
    /// A rule that could not finish, and why. A run never fails as a whole.
    pub failed: Vec<RuleFailure>,
}
```

A rule that throws does not take the run with it. A project with one unreadable `.bin` still
gets every problem in the other forty, and the panel names the file it could not read.

### What rides on the run

```rust
/// What one check is, apart from anything it found.
pub struct RuleInfo {
    pub id: RuleId,
    pub title: String,
    pub description: String,
    /// Whether this project is one the rule speaks about yet.
    pub state: RuleState,
}

/// Whether a rule speaks about a project, and what it waits for if not.
pub enum RuleState {
    Active,
    Dormant {
        /// One sentence naming what it waits for, in the rule's own words.
        reason: String,
    },
}

/// The path of one bin object, for the hashes a run's problems sit under.
pub struct ObjectInfo {
    pub entry: BinHash,
    pub name: String,
}
```

**A string that is the same on a thousand rows is sent once.** A project can hold seven
thousand problems, and the words describing the check that found them are identical on every
one. So is the path of the object a file's findings sit in, which a handful of objects supply
for a whole file. Both are catalogues on the run, and a row looks itself up.

The engine builds `objects` from the finished problems rather than each rule building its own,
because naming an entry is the same `binentries` lookup whatever found it, and the panel groups
on the object whatever rule the row came from.

`objects` holds only what a table could name. `binentries` names Riot's own object paths, so a
mod built on a copy of Riot's bins resolves nearly all of them and a mod shipping objects of
its own resolves fewer - measured at 9 of 9 on one mod and 3 of 8 on another. A hash no table
holds is left out rather than listed under its own hex, and the row draws the hex the file
itself carries.

### When a run happens

**A run starts when a project opens, and a user asks for nothing.** The
[budget](#the-budget) is what makes that affordable, and the reason to spend it is that a
modder who has to press a button to learn their mod is broken is a modder who learns it from
the game instead.

The panel draws the result when it arrives. Nothing waits for it, because the editor's first
paint has no reason to hold for 31ms of file reads, and a panel that is empty for one frame
reads as a panel with nothing to report - which is the common case and the true one.

The `⟳` in the panel is how a user runs it again.

### One read and one write for each file

312 problems in 14 files is 14 reads and 14 writes, and never 312 of either. The engine groups
by file before it calls a rule, so a rule sees a file once with every problem it raised in that
file.

**Each rule reads and writes its own parse.** Two rules over one `.bin` therefore parse it
twice. That is the cost of keeping a rule self-contained, and at 256MB/s over a project's
handful of files it is a cost worth paying until a second bin rule exists to measure it
against. A parsed document the engine owns and rules borrow is the optimisation, and it is
worth making when there is a second reader to shape it.

### The budget

A run parses every `.bin` of the project eagerly, with `ltk_meta::Bin::from_reader`. The
project editor measured that read at 194.8MB in 760ms over the install's bins, which is
256MB/s.

| Project        | Bins | Bytes | The run |
| -------------- | ---- | ----- | ------- |
| A skin mod     | 6    | 400KB | 2ms     |
| A large mod    | 40   | 8MB   | 31ms    |
| A map overhaul | 200  | 60MB  | 234ms   |

A run therefore needs no progress events and no cancel. It is one command that answers, on a
blocking thread rather than on the thread that draws the window - 234ms there is fourteen
dropped frames, and the first run of a session also pays for the hashtable cache. The
[lazy read](PROJECT_EDITOR.md#what-has-to-land-first) that the object index waits on is not a
blocker here, because this rule reads properties and the eager parse is the read it wants.

### The state

```rust
/// The last run of each open project. In memory, and never on disk.
pub struct ProblemsState(Mutex<HashMap<PathBuf, Run>>);
```

A problem is a fact about files as they were at a moment. Writing a run to disk would let the
panel draw a finding for a file a user has since changed in another tool. A run costs 31ms, so
re-running is cheaper than the bookkeeping that would keep a stored one honest.

## The bin retype rule

### What Riot is changing

A property bin holds typed values. A `String` is a length and its bytes. A `File` is a `u64`,
the XXH64 of the lowercased path, and it is how the game addresses a WAD chunk without carrying
the path.

Riot is changing several hundred properties from the first to the second. A mod that ships
`"ASSETS/Characters/Smolder/HUD/Smolder_Circle.dds"` where the game now reads a `File` is a mod
the game rejects. The value is not wrong. Its type is.

`ltk_meta` calls the new type `WadChunkLink`, and the table calls it `File`. They are the same
tag, 18, and the table's names are the meta dumper's.

### The table

One JSONL file for each game build, in the core crate's `tables/`.

```
{"class": "AnimationResourceData", "field": "mAnimationFilePath", "from": {"type": "String"}, "to": {"type": "File"}, "conversion": "hash_value"}
{"class": "0x13f50786", "field": "imagePath", "from": {"type": "String"}, "to": {"type": "File"}, "conversion": "hash_value"}
{"class": "VfxAssetRemap", "field": "oldAsset", "from": {"type": "Hash"}, "to": {"type": "File"}, "conversion": "rehash"}
{"class": "UiElementParticleSystemData", "field": "TextureOverrides", "from": {"type": "Map", "key": "Hash", "value": "String"}, "to": {"type": "Map", "key": "File", "value": "String"}, "conversion": "hash_key"}
{"class": "0x3b09052f", "field": "value", "from": {"type": "Embed", "class": "0x73b4a2eb"}, "to": {"type": "Pointer", "class": "0x73b4a2eb"}, "conversion": "none"}
```

| Field        | The rule reads it as                                              |
| ------------ | ----------------------------------------------------------------- |
| `class`      | Which class the object declares. A name, or `0x` and eight digits |
| `field`      | Which property of it. A name, or `0x` and eight digits            |
| `from`       | The type the property had. What the rule matches against          |
| `to`         | The type it has now. What the fix writes                          |
| `conversion` | How a value crosses. One of the four below                        |

The first table is `binfile_migration_16.17.8087655.jsonl`, at 395 rows and 55KB.

| Measurement                         | Value      |
| ----------------------------------- | ---------- |
| Rows                                | 395        |
| Distinct classes                    | 154        |
| Classes a hash table names          | 103 of 154 |
| Fields a hash table names           | 232 of 395 |
| Rows where the property is a leaf   | 350        |
| Rows where it is inside a container | 37         |

### The types, in two vocabularies

| The table | `ltk_meta::Kind`     | Tag    |
| --------- | -------------------- | ------ |
| `String`  | `String`             | `16`   |
| `Hash`    | `Hash`               | `17`   |
| `File`    | `WadChunkLink`       | `18`   |
| `List`    | `Container`          | `0x80` |
| `List2`   | `UnorderedContainer` | `0x81` |
| `Pointer` | `Struct`             | `0x82` |
| `Embed`   | `Embedded`           | `0x83` |
| `Option`  | `Optional`           | `0x85` |
| `Map`     | `Map`                | `0x86` |

The mapping is a table and not a guess, and it lives beside the reader that needs it. A type
name the table uses and this mapping does not hold is a row the rule skips and logs, because a
row it cannot read is a row it must not act on.

### How a row is keyed

Both `class` and `field` are a name or a hash. A name hashes to the other form with
`FNV1a32(lowercase)`, which is what the format itself does, so the loader hashes every name
once and the table becomes one lookup.

```
AnimationResourceData  →  0x9a4b299d
mAnimationFilePath     →  0x0329f1d7
```

```rust
/// The migrations of one game build, keyed the way a bin addresses them.
pub struct MigrationTable {
    build: GameBuild,
    rows: HashMap<(BinHash, BinHash), Migration>,
}
```

395 entries built at first use. A bin object is then a lookup of its class hash and a lookup of
each named field, and nothing walks the table.

### The four conversions

| Conversion   | Rows | What changes                                           | Automatic       |
| ------------ | ---- | ------------------------------------------------------ | --------------- |
| `hash_value` | 385  | Each `String` becomes `XXH64(lowercase)` under `File`  | Always          |
| `rehash`     | 7    | A `Hash` becomes the `File` of the same path           | Where a name is |
| `hash_key`   | 1    | A `Map` key goes the same way                          | Where a name is |
| `none`       | 2    | A type tag or an embedded class hash changes, no value | Always          |

**`hash_value` is the whole of the problem.** The string is in the file, so the fix is one hash
and one tag.

```
"ASSETS/Characters/Smolder/HUD/Smolder_Circle.dds"  →  0xabe03fa5cfa7e5c0
```

Where `from` is a container of `String`, every item converts and the container is rebuilt under
the new item type. `ltk_meta` models a container as an enum over its item type, so this is a
construction and not a mutation. The 37 container rows cover `List`, `List2`, `Option` and
`Map`, and three of them name a `List` the schema fixes at three items.

**`none` moves no bytes.** `Embedded` is a newtype over `Struct` in `ltk_meta` with the same
encoding, so `Embed → Pointer` is a tag. The other row changes the class hash of each element
of an `UnorderedContainer`, which is a rename Riot made to a class the schema still shapes the
same way.

**`rehash` and `hash_key` need a name that the file does not hold.** A `Hash` is already
`FNV1a32` of a path, and there is no arithmetic from that to `XXH64` of the same path. The
manager has to name the hash first.

### What it cannot fix by itself

The mimir cache's `binhashes` table holds `FNV1a32` of the strings that bins carry, and the
manager already opens that cache for WAD path resolution. So the repair for those 8 rows is a
lookup and then a hash.

| The hash | The fix                                                   |
| -------- | --------------------------------------------------------- |
| Named    | Resolve to the path, hash it with XXH64, write the `File` |
| Unnamed  | No fix. The problem stays, and the row prints the hash    |

An unnamed hash is a problem the panel still shows, at the same severity, with no Fix button
and a message that names the hash. Problems offers no box for a modder to supply the name
themselves - the row reports what it found, and the repair is the bin editor's, in the same
place every other hand edit happens.

Eight rows of 395 is the size of that hole, and it is worth stating rather than hiding behind a
fix that would write a wrong `u64`.

### What the rule matches, and what it leaves

For each object, the rule looks up the class hash. For each migration of that class, it looks
up the property by field hash. Then it compares the property's actual kind.

| The property's kind | The rule                                         |
| ------------------- | ------------------------------------------------ |
| Matches `from`      | Raises a problem                                 |
| Matches `to`        | Raises nothing. The file is fixed already        |
| Matches neither     | Raises nothing, and the file keeps what it holds |
| Absent              | Raises nothing. A bin declares what it declares  |

Those four rows are the whole safety argument. A run is idempotent, a fix run can be offered
twice without doubling anything, and a file that disagrees with both schemas is a file the rule
refuses to guess about.

### Why the table ships in the build

The table is `include_str!` into the core crate, the way the
[log code table](LEAGUE_DIAGNOSTICS.md#why-a-table-in-the-build-and-not-a-download) is. A table
update is a manager release.

The argument is not the same one, so it is worth making again.

- A table is a claim about one game build. It is right or wrong forever for that build, and it
  never drifts the way a live feed does
- A wrong hash is not recoverable from the file it was written into, so a table is a thing to
  review before it ships and not a thing to fetch
- A download would add a network path to a feature that otherwise reads only the machine

The cost is honest and it is real. A build Riot ships before the manager does gets no rule at
all, and every mod stays broken until a user updates. A release that adds a table says so in
its notes, the way a hash table update does. If the cadence turns out to hurt, the mimir cache
is the pattern to copy.

### More than one table

The manager holds every table it has shipped, in build order, and a run applies each of them.
Detection reads the current type rather than a version, so a table whose `from` no longer
matches contributes nothing and costs one lookup. A mod authored two builds ago therefore comes
out at the newest schema without anybody tracking what it was authored against.

Which findings are **muted** is per finding rather than per table, and the severity already
carries it. A table the game has reached raises Fatal, one ahead of it raises Warning, and the
panel mutes the second. A user one build behind therefore reads the older table's findings in
full and the newer table's dimmed, in one list, under one notice. Read
[A rule that waits](#a-rule-that-waits).

### A build the tables do not cover

**The manager says nothing.** A game newer than every table it holds draws no row, no note and
no warning.

This is what the retype rule is for, and this retype is one event. The manager cannot know
whether a build it has no table for changed a schema at all, so a note about it would be a
guess dressed as a finding - a row that says "something may be wrong" and gives a modder
nothing to do about it. Silence is the honest reading of an absent table.

The other reading becomes true the day a table stops being a one-time thing. A per-patch meta
fixup, where each game build brings its own table as a matter of course, is a feature that
knows which builds it covers and can therefore say when it does not. That is the shape this
rule grows into, and the note belongs to it rather than to this one.

### The build the table names

The installed build is one small file read.

```
Game/content-metadata.json
{ "version": "16.16.8049184+branch.releases-16-16.content.release" }
```

The `<major>.<minor>.<build>` prefix is the same shape the table's filename carries, so the two
compare directly. An install at 16.16.8049184 against a table for 16.17.8087655 has not taken
the change yet.

This matters because **a fix applied early breaks the mod on the client the user has**. A
`File` where the running game reads a `String` fails the same way round.

| Installed build        | Severity | Drawn as             | In the bar | The fix |
| ---------------------- | -------- | -------------------- | ---------- | ------- |
| Older than the table's | Warning  | Muted, or not at all | No         | Offered |
| The table's, or newer  | Fatal    | Full                 | Yes        | Offered |
| No install configured  | Warning  | Full                 | Yes        | Offered |

**A table the installed game has not reached describes a change that has not happened.** Riot
has not deployed it, no mod is wrong about it yet, and a repair derived from it breaks a mod
that works today. So the panel is about the game the user has, and those findings are behind one
setting. Read [A rule that waits](#a-rule-that-waits).

**An install nothing could read is not a claim either way.** A user with no League path
configured, or a `content-metadata.json` this cannot parse, gets the check they came for rather
than a setting they have to find, at the warning severity an unproven build earns. The
alternative reading - that an unknown build means the change has not landed - would take a check
away from the person least able to notice it went quiet.

### A rule that waits

**A dormant rule finds everything and claims nothing.** Every finding is in the run, because the
day the build lands is the day each of them stops the mod working, and a modder who cannot see
them until that morning is a modder who ships broken. So the panel draws them, and what it will
not do is claim they are wrong today: they are dimmed, they are out of every count of what the
mod owes, and one switch takes them off the list altogether.

**The switch is in the panel it changes,** in a row of its own under the filter box and above
the list. It is labelled with the patch the rule waits for and the count it holds, and it starts
pressed.

```
🔍 Filter problems                                 ⚠ 12    🔧  ⟳
───────────────────────────────────────────────────────────
 [⏳ Patch 16.17  12]
▾ ⚠ 14  base · …/skins/skin0.bin                       dim
  ▾ Characters/Smolder/Skins/Skin0                        dim
    ⚠ Meta property type mismatch                        dim
```

It has a row rather than a place in the toolbar because the toolbar is what a document
contributes to the surface it is in, and the things already on that row - the filter, the
tallies, Fix, re-run - are about the whole run. This one is about half of it, and it belongs
with the half it governs.

**On is the default, because a change that has not landed is the one a modder can still ship
ahead of.** Every mod that carries the old shape breaks on the morning the patch does, and a
check nobody is shown until that morning has bought nobody anything. Dimming is what keeps it
honest: the rows are there, they are visibly not the ones that are wrong today, and no count of
what the mod owes includes them. A muted row comes back to full under the pointer, because a row
a reader has reached for is a row they are reading.

Pressed off, the Problems tab is about the game the user has and nothing else: the forward-
looking findings draw nowhere, and every tally in the panel counts the list in front of the
reader. That is the setting for a modder patching something for tonight.

**The row is a switch and never a notice.** This spot held four lines of prose once, and the
prose was the mistake. A modder presses this switch once and then reads the panel for a month,
so an explanation pinned there answers on every one of those days a question that was asked on
the first. The same words are on the switch instead, where a reader who has forgotten what is
dimming their list reaches for them and nobody else pays.

```
⏳ Patch 16.17  12
└─ Not broken yet
   Riot changes how these values are stored in patch 16.17. Your game is on
   16.16, so nothing here is broken yet, and repairing it now breaks the mod
   on the patch you play.
   Your game is on 16.16.8049184, and the change lands in 16.17.8087655
   ───────────────────────────────────────────────────────
   Click to take them off the list
```

**A rule says what it waits for at three lengths.** `waiting` is the few words the switch
holds, `reason` is the sentence under it, and `detail` is the fine print under that. All three
are the rule's own, sent once on the run beside its title, for the reason
[everything else about a rule rides there](#what-rides-on-the-run).

Splitting them is what keeps the build numbers out of the sentence a modder reads first. A
patch is `16.17`, which is the number Riot's own notes carry, and `16.17.8087655` is a content
build that means nothing to anybody who has not opened `content-metadata.json`. The sentence
takes the patch. The two builds the rule actually compared go underneath, for the modder
checking one install against another.

**The switch draws only where it would change something.** A run whose rules all speak about
the installed game has no switch, and neither has a run where the waiting rule found nothing.
A control that is always on screen and always says nothing is a control a reader stops seeing.

**Settings still holds the same switch**, under Project editor, because that is where a modder
who wants to know what the manager can do goes looking. It is the same preference and it
persists the same way. What changed is that finding it is no longer the only way to use it.

**The mute is a dimming and never a restyling.** A finding keeps its severity glyph, its types
and its wrench, so the row says the same thing it would say a week from now. Reaching for a
neutral glyph instead would teach a reader that the severity colours are decorative, which is
`DS-KIND-HUE` in the other direction.

**The setting is a way of reading a run and never a second one.** Every finding is in the run
already, so turning it on redraws the list and asks the backend nothing. That is also why it is
a preference of the editor rather than of a project: it changes what a modder is looking at, and
a modder preparing for the coming build is preparing for it in every project they open.

**A crash is drawn whatever the setting says.** A rule can hold tables for several builds, and a
finding from one the game has already taken raises Fatal. That is a crash today, so it draws in
full and counts in the project bar even while the rest of the rule looks ahead. Muting is per
finding rather than per rule, and the severity is what separates them.

**The panel counts its list, and the bar counts what the mod owes.** A file header saying `14`
above fourteen dim rows is answering "what is in this file", which is the question a caret asks.
The count beside Test is answering "what is wrong with my mod today", and a change Riot has not
deployed is not part of that answer at either setting.

**Dormancy is the rule's own reckoning, and never the engine's.** The engine asks, records the
answer on the run, and calls `check` either way. What a check waits for is the check's own
business, and a rule holding several claims can have taken some of them and still be waiting on
the rest.

## Applying a fix

### What a scope reaches

**Fix on the panel reaches every layer.** A mod is every layer it ships, and a modder who fixes
their project means their project. A scope that quietly stopped at the layer the file tree
happened to have selected would leave a layer broken and say it was done, and a layer a user
never tests is exactly the layer that would stay that way.

| Fix on    | Applies                                      |
| --------- | -------------------------------------------- |
| A row     | That one problem                             |
| An object | Every problem in that object of that file    |
| A group   | Every problem in that file                   |
| The panel | Every problem in the project, in every layer |

Every scope is one call. Read [The commands](#the-commands).

### The preview

A user reads what a repair would change before they ask for it. The row carries the finding and
the wrench, and the values a repair would swap read in the row's tooltip - a rendered path and a
64-bit hash are two long strings, and a row that fits them fits nothing else.

The row is the check, the two types, and where in the file it is.

```
⚠ Meta property type mismatch            Expected `File`, found `String`
  mClipDataMap{Spell1_Torun_-180}.mAnimationResourceData.mAnimationFilePath
```

The tooltip is everything the row could not hold, in three parts: what kind of problem this is,
where it is, and what is unusual about this one.

```
⚠ Meta property type mismatch
  The type of a meta property in a bin file does not match what the game expects
  ─────────────────────────────────────────────────────────────────
  Layer   base
  File    Mordekaiser.wad.client/980dec1753a183d5.bin
  Object  Characters/Mordekaiser/Animations/Skin0
  Value   "ASSETS/…/Spell_1_torun_-180.anm"
          and 36 more
  ─────────────────────────────────────────────────────────────────
  The installed game still wants the old type.
  bin/property-type
```

**The tooltip draws the value, and not what a repair would make of it.** The repaired value is
a 64-bit hash of the value above it, so a reader cannot check it against anything - what they
came to see is the string the file holds.

**A container draws one of its paths and how many more it holds.** A count on its own says
`1 item` and nothing about what that item is, which hides the one thing the row exists to show.
Two hundred paths is still not a thing a tooltip reads, so the rest becomes the note beside the
example. A property whose values are not paths at all, such as a container of structs, has
nothing to sample and keeps the count.

**Every fact is labelled, and only the title sits at the row tier.** A hash and a path stacked
without labels say nothing about which is which, and a sentence about one property set larger
than the check that found it reads as the headline it is not. Each value is a code chip rather
than bare mono, which is the `DS-CODE-CHIP` rule of the design system: a literal the surface is
talking about is marked as one, wherever it appears.

### A fix re-checks first

The rule re-derives every change from the file on disk when a user applies it, and never from
what the run recorded. A problem whose property no longer matches `from` is skipped and counted
as skipped.

That falls out of [A problem is a description](#a-problem), and it buys three things.

- A file a user changed in another tool between the run and the fix cannot be written wrong
- A fix run offered twice applies once, because the second pass matches `to` and skips
- The panel does not have to invalidate itself against a file watcher to stay correct

### Preserving the names

**A `File` does not name its path.** Once a fix has written the hash, the string is gone from
the file, and no reader can derive it back. That is the reason this step is not optional.

Before it converts a property, a fix run writes every path under it into the mod's own
`game` hashtable - `hashes/game.hashes.txt`, declared in `hashtables` in the project config.

```
mod.config.json                                   gains a `hashtables` entry
hashes/
  game.hashes.txt                                 the paths this repair hashed away
content/base/data/characters/smolder/skins/skin0.bin
```

The merge is additive. A table gains names and never loses one, a second repair declares no
second table, and a repair offered twice writes nothing the second time.

Two names are left out. One the community tables already resolve is not embedded, because the
reader that would consult the mod's table can already answer from its own. One whose key another
name already claims is refused, and the rule then leaves that property alone rather than hashing
it - the check still reports it and the mod stays repairable. The `game` category keys at the
full 64 bits, so that second case is a guard rather than something a real mod reaches.

There is no restore point and no Undo. See
[ADR-0006](../adr/0006-a-repair-preserves-names-instead-of-keeping-a-restore-point.md) for why
losslessness replaced reversibility.

### The write

Each file lands through a temp file in its own directory and then a rename, which is the
pattern `.ltk/editor.json` already uses. A run that dies mid-way leaves whole files on both
sides of it, and the ones it finished read the same as if it had finished.

### What a fix never does

- It never touches a file it raised no problem in
- It never writes outside the project's own `content/` directories
- It never changes a property the table does not name
- It never applies a change the file no longer matches
- It never hashes a path it could not first write into the mod's own table

## The commands

```rust
/// Run every rule over one project.
fn analyze_project(project_path: String) -> Run;

/// Apply the fixes of the named problems.
fn fix_problems(project_path: String, problems: Vec<ProblemId>) -> FixReport;
```

`fix_problems` takes the ids a user chose rather than a scope word, so Fix on a row, Fix on a
group and Fix on the panel are the same call with a different list. A `FixReport` names what
applied, what skipped and why, and how many names it kept.

## The surfaces

### The problems panel

**Problems opens as a tab, and not as a side panel.** It began as a section of the content
sidebar and a sidebar cannot hold it: a finding needs two lines, a header level of its own sits
above it, and the width available is the file tree's width. It is a document of the editor
surface like Mod details and the game index, so it splits, it moves between groups, and it
comes back where a user left it - the tab is written into `.ltk/editor.json` with the rest of
the layout.

```
┌──────────────────────────────────────────────────┐
│ PROBLEMS            ⊗ 312  ⚠ 4    ⌕    ⟳   Fix   │
├──────────────────────────────────────────────────┤
│ ▾ ⊗ 14  base · …/skins/skin0.bin                 │
│   ▾ Characters/Smolder/Skins/Skin0               │
│     ⊗ Meta property type mismatch                │
│       Expected `File`, found `String`            │
│       iconPath                              Fix  │
│     ⊗ Meta property type mismatch                │
│       Expected `List2<File>`, …                  │
│       particlePaths                         Fix  │
│   ▸ Characters/…/Particles/Smolder_Base_R        │
│ ▸ ⊗  9  base · …/smolder_skins_skin0.bin         │
│ ▸ ⚠  5  high-res · …/skins/skin0.bin             │
│ ▸ ⚠  1  base · mod.config.json                   │
└──────────────────────────────────────────────────┘
```

| Part         | Reads                                                               |
| ------------ | ------------------------------------------------------------------- |
| The group    | A layer and a file, behind the count of what the file holds         |
| The object   | The bin object the findings under it sit in                         |
| The severity | One glyph, and the sort's first key                                 |
| The title    | What the rule calls itself, which is the same on every row it found |
| The address  | The property, or the file alone for a rule that reads no content    |
| The preview  | The before value and the after value, for a problem with a fix      |
| Fix          | On a row, an object, a group, and the panel. Each applies one scope |

The list sorts by severity and then by path, at both header levels. The search box filters on
the note, the two types, the address, the object and the rule id.

A check the installed game has not reached draws a notice above the list rather than a row in
it, in the place the unreadable-file warning already sits. It is a fact about the run and not a
finding, so the filter never touches it, and the rows it speaks for stay in the list where the
sort put them. Read [A rule that waits](#a-rule-that-waits).

**A file's count reads before its name.** The caret holds it at one x down the whole list, so
the counts read as a column. On the right they sat at the ragged edge a truncating path leaves,
which is the one place in a row a reader cannot scan.

**Only a file carries a count.** A file is what a modder decides to deal with, and a tally on
every object of it repeats that decision at a level nobody acts on - the objects under an open
file are already on screen to be counted by eye.

**A file's problems group by object under it.** A bin holds a handful of objects and a run's
findings scatter over them, so the object is the level at which "what is broken" reads as one
answer - this particle system, that material. The object's path comes from `binentries`
through the run's catalogue, and an object no table names draws the hash the file itself
holds. Objects start open at every size: the level is there to say which object a finding is
in, not to hide it behind a second click.

### From a problem to the file

**A click on a row opens the file.** A row is a place a reader is going, and one click is what
it costs. The panel does not move the file tree to match: a reader opened Problems to read
problems, and a list that scrolls a tree behind them on every click is a list that fights
whatever they had that tree pointing at.

The open goes through the same hook a tree row uses, so the tab mode a user chose applies here
too, and a tab is keyed by the asset it names rather than by the problem - the second finding
in one file activates the tab the first one opened rather than adding another.

Enter opens the file at the property, and until the [bin editor](BIN_EDITOR.md) lands that is
the same tab. That is the same fallback the object index takes, and the same upgrade path.

### The count in the project bar

The project header holds the actions that apply to the whole project. An error count sits
beside Test, and it opens the panel.

```
│ ←  →   ⌕ Workshop / Charizard Smolder X  v1.0.0    ⊗ 312   ⬓  Test  Pack  ⋮ │
```

It draws nothing when a project has no errors, because a control that is always there and
always says zero is a control a user stops reading.

### Test and Pack

Neither is blocked. A modder testing a mod they know is broken is a modder finding out how it
is broken, and a build a lint refuses is the thing every user of every linter hates.

| Action | With errors                                                        |
| ------ | ------------------------------------------------------------------ |
| Test   | Builds and patches. The result names the count, and opens Problems |
| Pack   | Asks once, names the count, and offers Fix beside Pack anyway      |

## The library waited

The same rules find the same problems in an installed mod, and far more users are hurt by a
published mod that broke than by a project of their own. The reason that half waited was the
write: a project repair is a file write, and a packed mod's looked like unpack, fix, repack,
reindex, re-enable.

The answer that shipped kept this document's model untouched. The library storage rework made
an installed fantome a mod project on disk, so most mods repair exactly as a project does. A
mod still stored as its archive is unpacked into staging, repaired there as a project, and
repacked over the archive (ADR-0005). `Site` never needed a mod id or a chunk - by the time a
rule reads anything, it is reading a project. The surface that shows all of this to a mod user
is [MOD_HEALTH.md](MOD_HEALTH.md).

## What ships in what order

1. The model, the engine, the table and the rule, in `ltk-manager-core`, with tests over
   crafted bins for each of the four conversions and for each of the four match cases
2. The panel, read-only. A run, a list, and a reveal
3. The preview, the fix, and the names the fix preserves
4. The count in the project bar
5. The three checks that exist today, moved onto rules and stripped of their own shapes
6. A second rule, which is what proves the model was generic

Steps 1 to 3 are the ones the deadline names. `ltk_meta` is not a dependency of this workspace
yet. It is `MIT OR Apache-2.0`, which is the workspace's own license, so adding it costs a
`pnpm generate:licenses` and nothing else.

## Open questions

1. Does the automatic run repeat while a project stays open? Files change under an editor -
   a save in another tool, a copy into a layer, a fix run of its own - and a run is a fact
   about a moment. The `⟳` is the manual answer, and a watcher is the other one.
2. Where does a per-patch table come from, when a table stops being a one-time thing? The
   [build a table does not cover](#a-build-the-tables-do-not-cover) is silent today because
   the manager cannot know what it is missing. A feature that ships a table for each patch
   knows, and it needs a source that keeps up.

### Answered

| Question                                       | Answer                                               |
| ---------------------------------------------- | ---------------------------------------------------- |
| Where does the migration table live?           | In the build, as an `include_str!` in the core crate |
| What does a run read?                          | The project's own `.bin` files, in every layer       |
| Which parser reads them?                       | `ltk_meta`, eagerly. A project holds tens of files   |
| What protects a file that a fix wrote?         | Nothing. The path it hashed is kept, not the file    |
| Can a fix be derived back out of the file?     | Yes, out of the mod's own `hashes/game.hashes.txt`   |
| What is the feature called?                    | Problems, because `diagnostics` names the launch one |
| How does the manager know the game's build?    | `Game/content-metadata.json`, in one read            |
| Does a stale problem apply?                    | No. A rule re-checks the file before it writes       |
| Which conversions need a hash table?           | `rehash` and `hash_key`, 8 rows of 395               |
| What happens when a hash has no name?          | The problem stays, with no fix, and prints the hash  |
| Does a fix run before the build lands?         | Only where a user asks, and then at Warning          |
| Does an error block Test or Pack?              | Neither. Both name the count, and Pack asks once     |
| Where does the panel live?                     | Its own tab, beside Mod details and the game index   |
| Does a run persist across a restart?           | No. It is a fact about files as they were            |
| Do the library's installed mods get the rules? | Yes, as verdicts - [MOD_HEALTH.md](MOD_HEALTH.md)    |
| When does a run happen?                        | When a project opens, and a user asks for nothing    |
| Do two rules share one parse of a `.bin`?      | No. Each rule reads its own, and sharing waits       |
| How far does Fix on the panel reach?           | Every layer, because a mod is every layer it ships   |
| Is a repair reversible?                        | No. It is lossless instead - ADR-0006                |
| Does an uncovered game build draw a note?      | No. An absent table knows nothing to report          |
| Does the table stay in the build?              | Yes. The mimir cache is the escalation, unmeasured   |
| Can a modder name a hash the tables lack?      | Not here. The row prints the hash, and that is all   |
| Does a fix leave the list stale?               | No. A fix drops the run, and the next read re-runs   |
| How does a row say which object it is in?      | The list groups by object, named out of `binentries` |
| What does a row repeat from the rule?          | Nothing. A rule's words ride on the run              |
| Which severity does a landed build get?        | Fatal. The game crashes rather than refusing the mod |
| Does a run block the window while it reads?    | No. Every problems command answers off the UI thread |
| Does a check run before Riot deploys it?       | Yes, and it is drawn until a modder says otherwise   |
| Where is that switch?                          | Under the panel's filter, and in Settings as well    |
| What does it say when nothing is waiting?      | Nothing. It draws only where it would reveal a row   |
| Why run a check nobody can act on yet?         | The day it lands, every mod that shipped it breaks   |
| Is the forward-looking linter on by default?   | Yes, dimmed. Off is one click, above the list        |
| Why a patch number and not a build?            | 16.17 is what Riot's notes say. The build is detail  |
| Is that setting per project?                   | No. It is how a modder reads, so it is the editor's  |
| What if no install could be read?              | The check draws in full. Unknown is not a claim      |
| Does the setting re-run the project?           | No. The findings were always there. It is a reading  |
| Do the panel and the bar count the same rows?  | No. The panel counts the list, the bar what is owed  |
| Is a crash ever hidden by that setting?        | No. Fatal is a crash today, whatever a rule waits on |
| Who decides what a rule is waiting on?         | The rule. The engine records it and calls `check`    |

A row moves here when the body of this document carries the answer.
