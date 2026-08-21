# League diagnostics

## Changes

| Date       | Change                                                                  |
| ---------- | ----------------------------------------------------------------------- |
| 2026-08-21 | Carry the patcher binaries' checksums and build dates on the incident   |
| 2026-08-21 | Reshape the token around what a verdict rests on, and drop deflate      |
| 2026-08-21 | Land the backend, the Games tab and the surfaces, and update the status |
| 2026-08-21 | Answer the open questions, and add the incident token                   |
| 2026-08-21 | Read the host and DLL lines from `ltk-patcher`, and trim the code table |
| 2026-08-21 | Propose the incident, its verdict, and the game log reader              |

Each edit of this document adds a row at the top. The table keeps the last ten rows.

League diagnostics is the LTK Manager feature for the minute after a game goes wrong while
the patcher runs. The core design idea is a verdict rather than a log. The manager reads
what the patcher, the Riot Client and League itself wrote about the game, names the failure
in one line, names the mod where the evidence allows it, and says what it cost.

The name is deliberate. The Diagnostics page that ships today checks the machine. This
document is about the game.

## Goals

- A player whose game crashed learns what happened without opening a log file
- A crash that a mod caused names the mod, and a crash that no mod caused says so
- Every verdict states what the game lost, as a fact, never as a hedge
- A support thread gets one text to read, with nothing private in it
- Nothing leaves the machine, and nothing is written into the League directory

## Feature status

This table holds every major feature of League diagnostics. A status word has one meaning.

- **Available** - the feature is in the application today
- **In progress** - work started, and the feature is not complete
- **Planned** - the team agreed on the feature, and work did not start
- **Proposed** - an idea for review, and not a decision
- **Blocked** - the team agreed on the feature, and a change outside this repository has
  to land first

| Feature                      | Status      | Note                                                         |
| ---------------------------- | ----------- | ------------------------------------------------------------ |
| System checks                | Available   | Sixteen checks in six categories, on the Diagnostics page    |
| Rejected archive dialog      | Available   | Classifies the scan status and names the mods                |
| Missing dependency warning   | Available   | The badge, the toast with its Review action, and the dialog  |
| Start failure toast          | Available   | One toast for every `patcher-error`. Library page only       |
| Session ending               | In progress | The client's reason and exit code, on `ritoclient-launcher`  |
| Stop the patcher on game end | In progress | The same branch. Off by default                              |
| Global error listener        | Available   | The `patcher-error` listener lives at the root               |
| Stage-aware start failures   | Available   | `HOST` points at the System tab, `INJECTION` at the incident |
| Game boundaries              | Available   | The host's `injected` and `exited` as events, not log lines  |
| Overlay outcome              | Available   | Whether the DLL's overlay went live, from its own init lines |
| Out-of-date patcher          | Available   | The DLL's end-of-life refusal, as a verdict                  |
| Skipped archive              | Available   | A lazy verification failure, as a verdict                    |
| Incident record              | Available   | One record for each game that went wrong                     |
| Verdict                      | Available   | The classifier over the evidence                             |
| Game log reader              | Available   | Reads the `r3dlog` of the game that ended                    |
| Code table                   | Available   | The codes the manager can name, each with an evidence mark   |
| Suspects                     | Available   | From an archive or a hash to the mods that write it          |
| Verdict line                 | Available   | In the session bar, until the next game                      |
| Games tab                    | Available   | The incident list and its detail, beside the System tab      |
| Report text                  | Available   | One text to paste, redacted                                  |
| Incident token               | Available   | The incident as one short string, for a URL or a chat        |
| Token decoder                | Available   | Paste a token into the Games tab, and read it as an incident |
| Crash marker                 | Available   | `GameCrashes/last_crash` as the crash-or-kill tiebreak       |
| Suspect badge                | Available   | On the mod card, the way the missing-dependency badge is     |
| Workshop verdict             | In progress | The card badge and the Test tooltip. No problems list yet    |
| Startup reconcile            | Proposed    | Games that ended while the manager was closed                |
| Hash search in mod bins      | Blocked     | Needs the lazy bin read the project editor waits on          |
| Bisect                       | Proposed    | Halve the enabled set until the crash goes                   |

## Scope

Two kinds of failure reach a player who runs the patcher, and the manager learns about them
in opposite ways.

**Failures the manager can see.** The overlay build fails, the injection host does not come
up, the DLL never attaches, or the integrity scan rejects an archive. Each of these arrives
as an event on the patcher thread, and each has a surface today. This document folds them
into one record, and changes little about how they are detected.

**Failures inside League.** The game crashes, hangs on the loading screen, closes itself, or
shows a bugsplat. The patcher thread sees none of this. The host reports `exited` and waits
for the next game. What the manager can learn, it learns from what League and the Riot
Client leave behind: the session record, the game's own log, and the crash directory. This
is the new work.

Out of scope:

- Fixing a mod. The verdict names a file or an archive, and the
  [project editor](PROJECT_EDITOR.md) is where a modder changes it
- A mod that loads and looks wrong. No log line says that a texture is ugly
- Vanguard. The manager reads nothing of it and infers nothing about it
- A network. No crash data leaves the machine, and the manager asks no service for help

## Vocabulary

| Word     | Meaning                                                                      |
| -------- | ---------------------------------------------------------------------------- |
| Game     | One run of `League of Legends.exe`, as the host or the session reports it    |
| Session  | One patcher run, from Building to Idle. A session spans any number of games  |
| Incident | The record the manager keeps for one game that went wrong                    |
| Verdict  | What the manager concluded: a title, a cause, what it cost, and the suspects |
| Evidence | The lines the verdict rests on, each with its source and its time            |
| Suspect  | A mod, or a workshop project, that the evidence implicates                   |

An incident is per game and not per session. The host outlives the game and scans for the
next one, so a session that covers three games can hold one clean game, one crash, and one
clean game again. The crash is the incident.

## What exists today

Every surface below is in the application, and the design keeps each of them. This section
names them so the rest of the document can say what changes.

| Surface                   | Where                                    | Says                                                     |
| ------------------------- | ---------------------------------------- | -------------------------------------------------------- |
| The Diagnostics page      | `/diagnostics`, an icon in the title bar | Sixteen system checks, a Copy report, a Re-run           |
| `WadScanFailedDialog`     | Global, on `patcher-wad-scan-failed`     | Which archive the scan rejected, and which mods write it |
| `LinkedBinWarningDialog`  | Global, behind the toast's Review action | Which mods reference a file the game no longer ships     |
| `MissingDepsBadge`        | The mod card                             | A count of missing dependencies                          |
| The `Patcher Error` toast | The Library page, on `patcher-error`     | The backend's message, for seven seconds                 |
| The session bar           | Global, at the bottom of the window      | The build, the start, the launch, and `In game`          |
| The ending toast          | The `ritoclient-launcher` branch         | `League closed unexpectedly`, with the client's reason   |
| Settings, Patching        | The Patching tab                         | Verbose logging, the scan mode, crash reporting, Rebuild |
| Settings, About           | The About tab                            | `Open Log File`, which reveals `ltk-manager.log`         |

Four gaps in that list shape the design.

1. A start failure is one toast, and the toast is mounted on the Library page alone. A
   failure during a workshop test, or while the user reads the settings, is dropped
2. The session bar has no failure state. A failed start returns it to `Patcher idle`, and
   a launch error reads `Could not start League.` for four seconds
3. Nothing a player sees links a failure to the Diagnostics page, and the page itself is an
   unlabelled icon between Discord and Settings
4. The game's own log is not read at all. `Verbose patcher logging` is the one setting that
   names the app log, and it does not link to it

The first three are fixed by the [surfaces](#the-surfaces) below. The fourth is the
[game log reader](#the-game-log-reader).

## The evidence

The manager has six sources for one game, and five of them exist already.

| Source         | Arrives as                                 | Holds                                                                        |
| -------------- | ------------------------------------------ | ---------------------------------------------------------------------------- |
| Patcher events | `patcher-error`, `-wad-scan-failed`        | A build that failed, a host that died, an archive rejected                   |
| Host status    | `status injected` .. `status exited`       | When the DLL attached, and when the game went away                           |
| DLL log        | `dll <ts> <pid> <tid> <level> <text>`      | Whether the overlay went live, which archives it served, what the scan found |
| The session    | `session-ended`                            | The Riot Client's `exitReason` and `exitCode`                                |
| The game log   | `Logs/GameLogs/<stamp>/<stamp>_r3dlog.txt` | The build, the load steps, the coded errors, the last line                   |
| The crash dir  | `Logs/GameCrashes/last_crash`              | Whether crashpad ran, and when                                               |

The first three already cross the patcher thread. The session arrives with the
`ritoclient-launcher` branch. The last two are files under the League install, and the
manager reads them after the game ends and never while it runs.

### The host and the DLL

The host speaks a line protocol, and the injector parses every line today. It turns one of
them into an event, `WadScanFailed`, and logs the rest. The emitters live in `ltk-patcher`,
and every line below is read from that source rather than from this repository's parser.

The host's status messages are fixed strings.

| Line                                 | Means                                                    |
| ------------------------------------ | -------------------------------------------------------- |
| `status injecting scanning for game` | The session started, or the last game's window went away |
| `status injecting game found`        | The host hooked the game's thread                        |
| `status injected dll attached`       | The DLL read the host's config, and acked with its pid   |
| `status waiting game exit`           | The hook is removed, and the host waits                  |
| `status exited dll detached`         | The pipe closed, which is the process ending             |
| `status failed <message>`            | The session is over, and the message is the reason       |

`injected` and `exited` are the boundaries of a game. Without them the manager cannot say
which game log belongs to which game. After `exited` the host's scan poller stays armed and
reports `scanning for game` when the window goes, which is how one session spans games.

**`injected` is not "modded".** The DLL acks the host the moment it reads a ready config,
before it checks anything, so `injected` says the DLL is in the process and no more. What
happens next the DLL says itself, on the `dll` lines, and exactly one of these follows.

| Line                                                                | The overlay is                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------------ |
| `init done`                                                         | Live                                                         |
| `joined too late, not overlaying`                                   | Off. League started before the scan, and the DLL stays inert |
| `end of life reached, please update: 0x..`                          | Off. The DLL refuses a game build newer than it knows        |
| `overlay verification failed, disabling overlay: wad <name>: <why>` | Off. The eager scan fails closed on the first bad archive    |
| `failed to install overlay hook`, or `.. integrity hook`            | Off. A hook did not take                                     |

The record keeps this as the game's overlay outcome, and three verdicts read it. Today every
one of these is a line in the app log that nothing reads, and a player whose mods "did not
load" is told to rebuild the overlay.

**The pid is on the `dll` lines.** `dll <ts> <pid> <tid> <level> <text>` carries it on every
record, so the first record after `injected` names the game. The status line carries none.
The text is `<target>: <message>`, so every match below runs on the part after the target.

**The archives the DLL served.** `redirected wad: DATA/FINAL/Champions/Aatrox.wad.client` is
written once for each archive the overlay hook redirected, as the game's own request path.
The record keeps the last segment of each. A mod whose archives were never redirected was
not in the game, which is the cheapest attribution the manager will ever get.

**The scan's word on one archive.** `WAD scan failed status with <status> for <champion>.wad.client`
is the line the injector parses today. The status is the scan's hex code, or `base_skin`
when the base-skin fast track found a skin with a mesh missing. The DLL's source names this
phrase as a contract with the manager's parser, and the lines on this page join that
contract.

**An archive skipped on the lazy path.** `lazy verification failed, not overlaying: wad <name>: <why>`
fails open for one file, so the game ran with every other mod and without that one. Nothing
reports it today. It is the exact shape of "the mod looks applied here but not in-game",
which the Rebuild overlay setting's hint already describes, and it becomes a verdict.

**What kind of game it was.** `spectator launch`, `replay (.rofl) launch` and `PBE launch`,
each followed by `; anti-hack scan will not block`, mark a game where the scan does not
block. The record keeps that as a fact, because a crash in a replay is not a crash in a
match.

`PatcherEvents` gains `game_attached`, `game_overlay` and `game_exited`, and the Tauri
adapter emits them as `patcher-game-attached`, `patcher-game-overlay` and
`patcher-game-exited`. The loop keeps its current shape, and an `exited` does not end the
session.

The phrases live in one module of the manager, `patcher/dll_lines.rs`, each with a comment
naming the DLL source file that writes it, the way `parse_wad_scan_failure` already names
its counterpart. A phrase is a contract between two repositories, and one place to read them
is what keeps a rename upstream from turning into a silent verdict of Unmodded.

### The session

The `ritoclient-launcher` branch follows the Riot Client's session record and emits
`session-ended` with two fields, `exitReason` and `exitCode`. The reasons the client sends
are `Exit`, `Interrupt`, `Timeout` and `Unknown`, and a spelling the crate does not know is
passed through.

The branch answers an ending with a toast. This document keeps the branch's rule for what is
worth reporting and moves the answer into an incident. Read [The verdict line](#the-verdict-line).

The session is not required. A user on the Classic launch flow starts League from the Riot
Client, and the manager never holds a session id. The host's `exited` is the boundary in
that case, and the ending has no reason and no code. Until the branch lands, every game on
`main` is that case, and `GameRecorder::session_ended` is the seam the branch plugs into.

### The game log

League writes one directory for each game under `Logs/GameLogs`, beside the `Game`
directory the manager already resolves. The directory is named for the moment the game
started, in local time, and holds three files.

```
C:\Riot Games\League of Legends\Logs\GameLogs\2026-08-17T07-26-15\
├─ 2026-08-17T07-26-15_r3dlog.txt     the game's log
├─ 2026-08-17T07-26-15_netlog.txt     the network log
└─ 2026-08-17T07-26-15_netstats.csv
```

A live install holds 44 of these at 1.6MB together. A short game writes 15KB. Nothing about
this file is expensive.

The `r3dlog` is a text file of one record per line, and every line opens the same way.

```
000000.558| ALWAYS|   CFG| Build Version: Version 16.16.804.9184 (Aug 10 2026/16:10:32) [PUBLIC]
000001.539| ALWAYS|  FLOW| Requesting State Transition: Pushing Patching State Stack Empty
000003.691| ALWAYS|  LOAD| SEJ-1A4F7C20
000004.111| ALWAYS|  FLOW| Loading Ended
000004.409|  ERROR| >>> BuffHashMap::HashToName - Match not found for hash 074fd631
000008.323| ALWAYS|  FLOW| ALE-8SDFH23F
000008.352| ALWAYS|  FLOW| Destroying the renderer
000008.543| ALWAYS| r3dRenderLayer::Close() exit
```

| Column  | Reads                                                                     |
| ------- | ------------------------------------------------------------------------- |
| Time    | Seconds since the log opened, to the millisecond                          |
| Level   | `ALWAYS`, `WARN`, `ERROR`. Right-aligned in a seven-wide column           |
| Channel | `CFG`, `FLOW`, `LOAD`, `CLK` and the rest. Present on a channel line only |
| Message | The rest of the line                                                      |

**The level is not severity.** Every channel line is emitted at one level whatever it says,
so `Initializing Renderer` and a failed load both read `ALWAYS`. The code table is what
says whether a line is bad, and the reader never infers anything from `ALWAYS`. An `ERROR`
level line is real, because the standalone reporter sets it on purpose.

The first lines of the file carry the facts a verdict reports.

| Line                 | Gives                                                                      |
| -------------------- | -------------------------------------------------------------------------- |
| `Logging started at` | The wall clock, which ties the file to a game                              |
| `Command Line:`      | `-GameBaseDir`, and whether `-EnableCrashpad` was on. Nothing else is kept |
| `Build Version:`     | The game's version, which is the first thing support asks                  |
| `Content Version:`   | The content release, which is what a game patch changes                    |

The command line also carries the player id, the game id and the server address. The
reader keeps `-GameBaseDir` and the crashpad switches, and drops the rest before the line is
stored anywhere. The crashpad switches are kept because the DLL reads the same ones to decide
between the eager scan and the lazy one, so the record knows which scan ran in this game
rather than guessing from the settings. Read [Privacy](#privacy).

### The codes

A retail build of League carries no message text for most of its errors. It carries a
short stable id, `ALE-` or `SEJ-` and seven to ten characters, where the message would be.
`SEJ-3E9A0C57` is the whole line. The manager ships a [table](#the-code-table) that names
what it can, and three facts about the codes decide how that table is used.

1. **The body is alphanumeric and not hex.** `SEJ-9Z6Y34B0`, `ALE-8SDFH23F` and `ALE-89b0dee7`
   are all real. A reader that matches `[0-9A-F]` drops a third of the `SEJ` codes, and one
   that matches upper case alone drops `ALE` ones too
2. **Codes are stable, and a table goes stale slowly.** A code never changes its meaning,
   and a few arrive or leave in a year. A static table is right, and an unknown code is a
   code the table does not know rather than a corrupt log
3. **Not every reading is equally firm.** Some are confirmed and some are inferred. The
   table carries that mark, and the manager shows it

Codes reach the log two ways, and the reader handles both.

| Form       | Looks like                                               | Level    |
| ---------- | -------------------------------------------------------- | -------- |
| Channel    | `  LOAD\| SEJ-3E9A0C57`, or `  FLOW\| SEJ-8711AB1A 0.02` | `ALWAYS` |
| Standalone | `  ERROR\| ALE-9B39AA45 FATAL ERROR. Missing data: 0x..` | `ERROR`  |

The standalone form reads `<code> <message>`, so the code is the first token and the message
follows it. The texture report writes the code in quotes,
`Error: "ALE-D0D00022" - Result: E_INVALIDARG.`, so the reader matches a code anywhere in
the message and not at its start alone.

Most of what a bad asset does never reaches the log at all, which is why the verdict leans
on the few codes that do rather than on a full read of it.

### The crash directory

`Logs/GameCrashes` holds crashpad's state. `last_crash` is one line, the wall clock of the
last crash. A `<uuid>.run` directory beside it holds the Sentry event for that crash, and
that event carries the account name and the PUUID.

The manager reads `last_crash` and nothing else in the directory. One timestamp answers the
one question the log cannot: whether the game ended in a crash handler, or was ended by
something outside it. A timestamp inside the game's window is a crash. An older one means
the process was killed, or exited on its own. The event file would say more, and it says it
beside an account identifier, so it stays unread.

## The code table

The table ships inside the application, as a TSV that `include_str!` compiles into the
core crate. The team maintains it by hand, and it holds four columns and nothing else: no
note on a row, no header beyond the column names, and no comment in the code that reads it.

```
code          kind          evidence   meaning
ALE-9B39AA45  missing_data  confirmed  A file the game needed is in no mounted archive
ALE-18967993  wad_mount     inferred   An archive could not be mounted, because it is corrupt
ALE-D0D00022  texture       confirmed  A cube-map texture could not be created
ALE-71BBD00F  memory        confirmed  The graphics device ran out of memory
ALE-3112373   device        inferred   The graphics device was removed
SEJ-9F31B5D0  load_step:52  confirmed  Loading step 52, mounting the champions' archives
SEJ-5C2A6F38  load_step:44  confirmed  Loading step 44
ALE-8SDFH23F  teardown      confirmed  The game session ended the way it should
```

| Column   | The manager reads it as                                                 |
| -------- | ----------------------------------------------------------------------- |
| code     | The key. Matched case-sensitively, because the bodies mix the two cases |
| kind     | What the classifier switches on. A load step carries its number         |
| evidence | `confirmed` or `inferred`. Hedges the meaning sentence, nothing else    |
| meaning  | One sentence a user reads, under its evidence mark                      |

### The kind column

A kind is what makes the table a classifier's input rather than a glossary. Each verdict
below names the kind it reads, so adding a code to a verdict is a row in the table and not
a line in Rust.

| Kind           | Codes                                                 | Feeds                       |
| -------------- | ----------------------------------------------------- | --------------------------- |
| `missing_data` | `ALE-9B39AA45`                                        | Missing data                |
| `wad_mount`    | `ALE-18967991..94`, `ALE-89b0dee7`, `ALE-9D171D1D`    | A corrupt archive           |
| `texture`      | `ALE-D0D00020`, `21`, `22`, `23`                      | A texture failed            |
| `memory`       | `ALE-71BBD00F`, `ALE-546D9FE7`                        | Out of memory               |
| `device`       | `ALE-311237x`, `ALE-D0D0002[4-9]`, `ALE-D0D0003[0-3]` | A graphics fault            |
| `load_step:N`  | The thirteen `LOAD` markers                           | Stuck loading               |
| `teardown`     | `ALE-8SDFH23F`                                        | Clean                       |
| `info`         | Anything else worth a sentence                        | Nothing. The sentence alone |

### What a row is for

A row exists when it can say something a user can act on or stop worrying about. A code
whose reading is not such a sentence has no row, or a row that says only what kind it is,
as `SEJ-5C2A6F38` does with "Loading step 44", because the step number is what the Stuck
loading verdict wants and nothing else about the step is a player's business.

A code with no row shows as the code. That is the same fallback a code newer than the table
gets, so leaving a row out costs nothing.

### Why a table in the build and not a download

A hundred-odd rows change a few times a year, and an unknown code costs nothing. A stale
table degrades to "a code the manager does not know", and never to a wrong verdict, because
every verdict below rests on a kind the table has assigned. A download would add a network
path to a feature whose promise is that nothing leaves the machine, to save a release or two
of staleness.

A release that updates the table says so in its notes, the way a hash table update does.
Retired codes keep their rows, so a log from an old build still reads.

### What the evidence mark does

The mark hedges **one sentence** - the meaning, in the verdict's cause - and reaches nothing
else. It is a claim about how well this table is known, not about what happened to the game.

| Mark      | The cause sentence says        | Drawn as       |
| --------- | ------------------------------ | -------------- |
| confirmed | What the code means, as a fact | The meaning    |
| inferred  | What the code probably means   | "Probably X."  |
| no row    | That the code appeared         | The code alone |

The evidence table draws no mark at all. Repeating it on every line read as a severity the
line does not carry, and most rows are inferred, so it stamped nearly every row the same.

**It used to be a ceiling**, capping a verdict at _Lead_ whenever it rested on an inferred
row. That was wrong twice over. It let the reliability of the manager's own table decide how
a player's game was described, and because 23 of 24 `device` rows and 5 of 6 `wad_mount`
rows are inferred, whole verdict classes could never read as anything else. What the game
lost is knowable without knowing what a code means, so that is what a verdict now states.

## The game log reader

The reader turns one `r3dlog` into a small record. It keeps facts and a bounded excerpt,
and it never keeps the file.

### Which file

The game has a first sign and a last one, and the log directory is named for its start in
local time. The first sign is the host's `game found` or the session's report that League
is up, and the last is the host's `exited`, its return to scanning, or `session-ended`.
League opens the log a few seconds before the host sees the window, so the reader takes the
newest directory whose stamp falls in the minute before the first sign and before the last,
and confirms it with the `Logging started at` line inside.

| Situation                                     | The reader does                                         |
| --------------------------------------------- | ------------------------------------------------------- |
| One directory in the window                   | Reads it                                                |
| None                                          | Records no log. The verdict says so                     |
| The file is still held open                   | Retries for five seconds, then records no log           |
| The stamp is in the window, the header is not | Records no log, because a wrong file is worse than none |
| No `league_path` is configured                | Does not look                                           |

A game the patcher never touched still has a first sign when the session saw it, or when
the host saw its window come and go, and the reader runs on that. The log then serves the
facts rather than a suspect, because there is no mod to attribute anything to. A game nobody
saw has no sign and no incident.

### What it keeps

```rust
pub struct GameLogFacts {
    pub started_at: Option<String>,
    pub build_version: Option<String>,
    pub content_version: Option<String>,
    pub game_base_dir: Option<String>,
    pub crash_reporting: Option<bool>,
    pub codes: Vec<CodeSighting>,
    pub last_load_step: Option<CodeSighting>,
    pub loading_ended: bool,
    pub reached_game_loop: bool,
    pub torn_down: bool,
    pub error_lines: u32,
    pub total_lines: u32,
    pub last_time: f64,
    pub excerpt: Vec<String>,
}
```

The reader is a pure function over `BufRead` in `ltk-manager-core/src/diagnostics/game_log.rs`,
and its tests run over a real log checked in as a fixture with its command line redacted.
Nothing in it knows about Tauri, the patcher, or a mod.

### The budget

These are targets and not measurements. The install they are sized against is the one above,
at 44 games and 1.6MB.

| Stage                      | Budget                                            |
| -------------------------- | ------------------------------------------------- |
| Finding the directory      | One `read_dir` of `GameLogs`, under a millisecond |
| Reading a short game       | Under 5ms for 15KB                                |
| Reading a long one         | Under 50ms for a 5MB log, line by line            |
| What is kept for each game | Under 16KB, which is the excerpt                  |
| When it runs               | After `exited`, on the patcher thread, once       |

## The verdict

A verdict is what the classifier concluded from the evidence of one game. It is a pure
function in `ltk-manager-core/src/diagnostics/incident.rs`, over the patcher's events, the
host's boundaries, the session's ending, the log facts and the crash marker. It has no side
effect and reads no file, so every row below is a unit test.

### The kinds

The rows are in precedence order. The first row whose evidence is present wins.

| Verdict                    | Rests on                                                      | Cost            | Names a mod |
| -------------------------- | ------------------------------------------------------------- | --------------- | ----------- |
| DLL injection failure      | A build error, or `InjectionFailed` at either stage           | overlay-off     | Sometimes   |
| Unsupported game build     | `end of life reached` on the `dll` lines                      | overlay-off     | No          |
| Skinhack detection         | `patcher-wad-scan-failed`, status `c0000229`                  | overlay-off     | Yes         |
| Archive scan rejection     | `patcher-wad-scan-failed`, any other status                   | overlay-off     | Yes         |
| Overlay verification fail. | `overlay verification failed`, with its archive               | overlay-off     | Yes         |
| No mods applied            | A game the session or the host saw, and no live overlay in it | overlay-off     | No          |
| Missing game data          | A `missing_data` code, with its hash                          | game-stopped    | Yes         |
| Archive mount failure      | A `wad_mount` code                                            | game-stopped    | Sometimes   |
| Texture creation failure   | A `texture` code, and `E_INVALIDARG`                          | game-stopped    | Sometimes   |
| Memory allocation failure  | A `memory` code                                               | game-stopped    | No          |
| Graphics device failure    | A `device` code                                               | game-stopped    | No          |
| Loading screen stall       | A last `load_step`, no `Loading Ended`, and an ending         | game-hung       | Sometimes   |
| Archive verification skip  | `lazy verification failed`, with its archive                  | archive-dropped | Yes         |
| Unexplained game exit      | Any ending worth reporting, and nothing above                 | game-stopped    | No          |
| Clean                      | `Exit` with code 0, or `teardown` with no reason              | -               | No incident |

**Clean** is the common case, and it writes nothing. A game that ends the way the client
meant it to is not an incident, and a list of incidents that held every game would be a list
nobody reads. The branch's `worthReporting` rule is the one used: an ending is worth
reporting when the reason is not `Exit`, or the code is not zero, and never when the reason
is absent because the client went away.

**Two verdicts record on a clean ending.** The overlay was disabled and An archive was
skipped write an incident whatever the exit code, because the game ran well and without the
mod, and "my mod did not show up" is the question those players ask.

**Unmodded game** is a verdict and not a silence. A player whose game crashed with the
patcher idle, with the host still scanning, or with a DLL that joined too late, will blame
the mods, and the one fact that answers them is that no mod was in the game. The verdict
says that, names the cause - the patcher was not running, the host never found the game,
the DLL joined too late, or a hook did not install - and stops. A game the patcher never
touched is still known through the session or through the host's `game found`, and either
is enough for a record, because "was it the mods?" is asked about those games most of all.

### Each verdict, in the words a user reads

**The patcher did not run.** The title names the stage. A build that failed names the mod
whose file the builder stopped on, because the error already carries it. A `HOST` failure
says `The injection host did not start`, and its one action is the System tab of the
Diagnostics page, because antivirus, a declined UAC prompt and a missing binary are what the
checks there look for. An `INJECTION` failure says `The DLL did not attach to League`, and
carries the host's message, which is one of two. `SetWindowsHookEx failed` with its code is
a hook that would not install, and `DLL never attached after 60s` is a DLL that never came
up, with a hint that names elevation when the host is not elevated and the signature or
antivirus when it is.

**The patcher is out of date.** `The patcher does not know this version of League.` The DLL
compares the game's build timestamp against the one it was built for, and refuses a newer
one rather than patching it blind. The game ran unmodded, no mod is named, and the hint is
to update LTK Manager. A patch day produces this one, and it is the verdict that turns a
wave of "mods stopped working" into one sentence.

**An archive was rejected.** This is `WadScanFailedDialog`, kept as it is. The incident
records what the dialog showed, so the Games tab can show it again after the dialog is gone.
The status classification the dialog already holds is the one the verdict uses:
`c0000229` a skinhack, `c0000225` a missing bin, `c000003e` a corrupt archive, `c0000017`
and `c000009a` out of memory. `base_skin` joins them, and the dialog does not know it yet:
the base-skin fast track found a skin with a mesh missing, and it reads as an incomplete mod
rather than a skinhack.

**The overlay was disabled.** `The patcher turned the overlay off before the game loaded.`
The eager scan fails closed, so the first archive that does not verify disables every mod
for the game, and the line names the archive and the reason - a file that would not open, an
archive that would not mount, a signature that did not check, or the anti-hack scan. The
suspect is the mod that writes the archive. The hint is Rebuild overlay, and the archive is
the one to look at when the rebuild does not help.

**Missing data.** `League stopped a read it could not finish.` The code is confirmed and the
path hash is in the line, so this is the single most useful verdict the manager has. The
[hash](#from-a-hash-to-a-path) resolves to a path when a table names it, and the path reads
under the title. The suspects are the mods that write the archive the path lives in. The
action is to disable the suspect, or to open the path in the project editor when the game
was a workshop test.

**A corrupt archive.** `League could not mount an archive.` Five of the six codes are
inferred rows, so this is a Lead, and it says `Probably`. `ALE-89b0dee7`, the invalid
sub-chunk, is the confirmed one and reads as a fact. The code names no archive, so the
suspects are the mods whose archives the DLL redirected this game, which is a list and not
a name. The hint is the one the Patching settings already give: `Rebuild overlay`, and a
repair of the install in the Riot Client when the rebuild does not help.

**A texture failed.** `A texture could not be created, and the crash came after it.` The
texture code is not itself fatal. The game carries on without the texture, and the crash
that follows is downstream, so the verdict says that rather than claiming the texture
crashed the game. `SEJ-3E9A0C57` immediately before `ALE-D0D00022`
is the environment's cube-map array, and the verdict then says `a cubemap of the map`,
which points at a map mod and away from a champion skin.

**Out of memory.** `League ran out of memory.` `ALE-71BBD00F` is confirmed and fatal, so the
title is a fact. `ALE-546D9FE7` on its own is an inferred row, and the same title then
reads as a Lead. No mod is named, because memory has no owner, and the hint says that a mod
with very large textures raises the odds, beside a count of the mods that were in the game.

**A graphics fault.** `The graphics driver stopped responding.` Every one of these rows is
inferred, so it is a Lead. The verdict names no mod and says so plainly: a device removal
is the driver's, and the fix is a driver update or a display setting.

**Stuck loading.** `League stopped at loading step N of 64.` Each `LOAD` marker is written
before its step runs, and a step that never finishes holds the screen where it is. The last
marker in the log is therefore the step that did not finish, and the percentage the player
saw was `N / 64`. The verdict names the step's work from the table.
Step 52 mounts the champions' archives, so its suspects are the mods that write a champion
archive the DLL redirected. Step 62 builds the environment's cube array, so its suspects are
the map mods. The other eleven name their work and no mod.

**An archive was skipped.** `One archive was left unmodded.` The lazy scan fails open for
one file, so the game ran with every other mod and without this one, and the line names the
archive and the reason. The suspect is the mod that writes it. The player saw a game with
one skin missing and nothing else wrong, which is why this verdict records on a clean
ending.

**Ended without a reason.** `League closed, and left no reason the manager can read.` This
is the branch's toast, with the facts under it: the client's reason and code, whether
crashpad ran, the game's version, the last five lines of the log, how many `ERROR` lines it
held, and every code it saw with whatever the table says. Nothing is guessed. The one action
that always helps is `Copy report`, and this is the verdict that needs it most.

### Consequence

What the game lost. `VerdictKind::consequence` decides it and nothing else does, so a kind
cannot ship without saying what it costs, and every verdict carries one.

| Consequence     | Means                                           | Drawn as        |
| --------------- | ----------------------------------------------- | --------------- |
| overlay-off     | No mod reached the game                         | No mod ran      |
| game-stopped    | The game did not survive                        | Game stopped    |
| game-hung       | The game never reached play                     | Game hung       |
| archive-dropped | The overlay served the game without one archive | Archive dropped |

The first two cost the player everything they asked for and take `danger`. The last two cost
part of it and take `warning`.

A skinhack rejection is the case the axis exists for. The DLL's own scan rejected the archive
and turned the overlay off, so `overlay-off` is a fact about what the manager did, and no
reading of a log code enters into it.

**Suspects carry no grade.** The `because` sentence is the whole claim, and how direct the
link is reads out of what it says - _writes Aatrox.wad.client, which holds the path_ is not
the same sentence as _writes Aatrox.wad.client, redirected this game_. A word on top of that
added nothing the sentence did not already say.

**The token carries no consequence.** It carries the verdict kind, which decides the
consequence, so a decoder derives it. The wire key `c` that held a confidence is retired and
never reused.

### Hints

A hint is a line under the verdict that names a setting or an action the evidence points
at, without being the verdict. Each is one sentence, and a verdict carries at most two.

| Hint                              | When                                                                     |
| --------------------------------- | ------------------------------------------------------------------------ |
| Turn on `Scan every WAD up front` | The game crashed inside the first minute, and the DLL ran the lazy scan  |
| Rebuild the overlay               | A corrupt archive, or a texture failure, in an archive the overlay wrote |
| Run the System checks             | The host did not start, or the DLL did not attach                        |
| Update LTK Manager                | The patcher is out of date                                               |
| Update the graphics driver        | A graphics fault                                                         |
| Open the project                  | A workshop test, whenever a path or an archive is named                  |

The first row exists because the DLL scans archives on demand while the setting is off and
League's crash reporting is off, and the Patching settings already warn that on-demand
scanning can cause sporadic crashes. The game's command line says whether crash reporting
was on, so the record knows which scan ran rather than guessing from the settings, and an
early crash under the lazy one is worth one sentence.

## Suspects

A suspect is a mod, or a workshop project, and the line under its name says why.

```
SUSPECTS
  Aatrox Justicar          writes Aatrox.wad.client, which holds the path       Likely
  Classic Rift             writes Map11.wad.client, redirected this game        Lead
```

### From an archive to a mod

The library already answers this. Every enabled mod has a `ModWadReport` from the overlay
build with its `affected_wads`, and `useWadScanOffenders` already matches an archive name
against those lists to fill the rejected-archive dialog. The same match, in Rust rather than
in the frontend, gives the suspects for every verdict that names an archive.

A workshop test names projects rather than mods. The session's origin holds their paths,
and a project's layers say which archives it writes, so the match is the same with a
different source.

An archive that more than one mod writes lists every one of them, highest priority first,
because the overlay merged them and the log cannot tell them apart.

### From a hash to a path

`ALE-9B39AA45` prints the 64-bit path hash of the file League could not find. The
[hash names](PROJECT_EDITOR.md#hash-names) that the game browser uses answer the same
question here: the mimir `Game` table maps the hash to a path when CommunityDragon knows
one, in one binary search and no string data.

| The table says                           | The path is                            | Suspects                                          |
| ---------------------------------------- | -------------------------------------- | ------------------------------------------------- |
| A path, and the install ships it         | A game file a mod's archive lost       | The mods that write that archive                  |
| A path, and the install does not ship it | A file an old patch had                | The mods referencing it, per the dependency check |
| Nothing                                  | A path a mod invented and did not ship | The mods whose archives were redirected           |

The last row is the common one, and it is the one the manager answers worst today. A mod's
`.bin` references a texture the mod forgot to ship, and nothing names the texture. The DLL's
redirected list narrows it to the mods that were in the game. Narrowing it to one needs a
search of each candidate's bins for the hash, which is the
[bin scan](PROJECT_EDITOR.md#the-scan-and-the-reader-it-needs) that the project editor
waits on upstream. Until that lands the verdict lists the candidates and says Lead, and
when it lands the same verdict names one mod and says Confirmed.

### From a step to a mod

Step 52 mounts the champions' archives for the players in the match, and the DLL reports
which archives it redirected. The intersection of the two is the champion mods that were in
this game, and those are the suspects. The log does not name the champions, so the DLL's
list is the whole answer, and a game with one champion mod has one suspect.

## The incident

```ts
interface Incident {
  /** The game log's stamp, or the session's start when there is no log. */
  id: string;
  startedAt: string;
  endedAt: string;
  /** Library, or the workshop projects under test. */
  origin: SessionOrigin;
  /** Whether the DLL attached to this game. */
  injected: boolean;
  /** Whether the host ran elevated, which picks the hint for a DLL that never attached. */
  hostElevated: boolean;
  /** The patcher binaries this session ran, and whether they are this build's. */
  patcher: {
    /** `hash` is the 16-hex SHA-256 prefix, `built` the PE date in unix seconds. */
    dll?: { hash: string; built: number | null };
    host?: { hash: string; built: number | null };
    /** True when both are byte-identical to what this manager build shipped. */
    matchesBundle?: boolean;
  };
  /** What the DLL said after it attached. */
  overlay: "live" | "too-late" | "end-of-life" | "disabled" | "hook-failed" | "none";
  /** The DLL's word on the outcome, for the three outcomes that carry one. */
  overlayDetail: string | null;
  /** The archives the DLL served from the overlay. */
  redirected: string[];
  /** The archives the lazy scan skipped, each with the DLL's reason. */
  skipped: { wad: string; why: string }[];
  /** The enabled mods, and the projects under test, the overlay was built from. */
  enabledCount: number;
  launch: "match" | "replay" | "spectator" | "pbe";
  /** As the DLL decided it, from the flags and the game's command line. */
  scan: "eager" | "lazy" | null;
  /** How far the game got, as its log says. */
  phase: "unknown" | "loading" | "in-game" | "torn-down";
  game: { version: string; contentVersion: string; logPath: string } | null;
  ending: { exitReason: string | null; exitCode: number | null; crashed: boolean | null };
  /** Set when the session failed before any game, which is the whole story. */
  failure: SessionFailure | null;
  verdict: Verdict;
  evidence: Evidence[];
  suspects: Suspect[];
  /** The user has seen it and closed the line. */
  dismissed: boolean;
}

interface Verdict {
  kind: VerdictKind;
  title: string;
  /** From the kind, unless titleOverride says otherwise. */
  title: string;
  /** Set only for what the predefined titles do not cover. */
  titleOverride: string | null;
  cause: string;
  consequence: "archive-dropped" | "overlay-off" | "game-hung" | "game-stopped";
  hints: string[];
}

interface Evidence {
  /** Seconds into the game where the source has one, else the wall clock. */
  at: string;
  source: "patcher" | "host" | "dll" | "game" | "client";
  line: string;
  /** Absent when the table has no row for the code. */
  code?: {
    id: string;
    kind: string | null;
    meaning: string | null;
    evidence: "confirmed" | "inferred" | null;
  };
}

interface Suspect {
  modId: string | null;
  projectPath: string | null;
  displayName: string;
  /** "writes Aatrox.wad.client, which holds the path" */
  because: string;
}
```

### Where it lives

The manager's app data directory, under `incidents/<id>.json`, beside the log and the
library index.

An incident is small. The excerpt is bounded at 16KB and the record around it is a few, so
one is under 20KB. The store keeps the newest fifty and at most 1MB, whichever fills first,
and the oldest goes. A dismissed incident goes before an undismissed one of the same age,
because the user has read it.

Not the League directory, which the manager never writes into. Not the library index,
because an incident is about a game and not about a mod, and a mod that is uninstalled
keeps its place in an old incident under its display name.

### How one is assembled

```
 host: game found ─┬─▶ host: injected ──▶ dll: init done ──▶ the game ──▶ host: exited ──┐
 session-started ──┘                                                                      ├─▶ wait ──▶ read ──▶ classify ──▶ store ──▶ incident-recorded
                                                                  client: session-ended ──┘
```

1. A game record opens at the first sign of a game: the host's `game found`, or the
   session's report that League is up. `injected` marks the DLL in, the DLL's init lines
   set the overlay outcome, and the redirected and the skipped archives collect into it
2. The last sign closes it: the host's `exited`, or its return to `scanning for game` when
   the DLL never attached, or `session-ended`. The signs arrive within seconds of each
   other, and the record waits up to five seconds for the rest
3. The reader finds the log, and the crash marker is read
4. The classifier runs, and a Clean result drops the record
5. Anything else is written, and `incident-recorded` carries it to the frontend

A session that fails before any game runs, in the build or at the host, makes an incident
with no game in it, because the failure is the whole story.

A game that ends while the manager is closed is missed. The
[startup reconcile](#ideas-for-review) would catch it, and it is an idea and not a plan.

## The surfaces

Five places show an incident, and each answers a different question.

| Surface            | Answers                                    | Holds                             |
| ------------------ | ------------------------------------------ | --------------------------------- |
| The verdict line   | What just happened?                        | One line, until the next game     |
| The Games tab      | What happened, exactly, and before that?   | Every incident, with its evidence |
| The suspect badge  | Is this the mod?                           | One word on the mod card          |
| The report text    | What do I paste?                           | The incident, redacted            |
| The incident token | What do I paste where a page will not fit? | The incident, as one string       |

### The verdict line

The session bar is the one surface that is always on screen, and it is where the ending
arrives. The `ritoclient-launcher` branch announces an ending with a toast that lasts six
seconds. A crash is a question the player comes back to, so the toast stays as the
announcement and the bar keeps the answer.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ▲ League closed · Missing data in Aatrox.wad.client · Aatrox Justicar        │
│   LIKELY                                                    Details     ×    │
└──────────────────────────────────────────────────────────────────────────────┘
```

| Part    | Reads                                                              |
| ------- | ------------------------------------------------------------------ |
| Glyph   | A warning triangle in the danger token, in place of the idle dot   |
| Title   | The verdict's title                                                |
| Subject | The archive, the path's file name, or the step, where there is one |
| Suspect | The first suspect's name, and `+2` where there are more            |
| Cost    | A small chip saying what the game lost                             |
| Details | Opens the Games tab on this incident                               |
| `×`     | Dismisses the line, and marks the incident dismissed               |

The line replaces the idle resting line and nothing else. A build or a start that begins
takes the bar back, because the bar's job is the present, and the incident waits on the
Games tab. The next game's `injected` dismisses the line on its own.

The toast gains a `Details` action, which is the shape `useSurfaceLinkedBinWarning` already
uses for `Review`, and passes `notify: true` so the notification center keeps it. Today no
patcher or launch toast passes it, and a seven-second toast is the only record of a failure.

A failed start takes the same line. `The injection host did not start` sits in the bar with
a `Diagnostics` action that opens the System tab, in place of a toast that the Library page
alone would show.

### The Games tab

The Diagnostics page gains two tabs, and the sixteen checks move under the second.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ⚕ Diagnostics                                                                │
│   Games   System                                                             │
├────────────────────────┬─────────────────────────────────────────────────────┤
│ TODAY                  │ ▲ Missing data                              LIKELY  │
│ ▲ 21:14  Missing data  │ League stopped a read it could not finish. The path │
│          Aatrox Justi… │ is assets/characters/aatrox/skins/skin12/aatrox_tx…  │
│ ▲ 19:02  Stuck loading │                                                     │
│          step 52 of 64 │ SUSPECTS                                            │
│ YESTERDAY              │ Aatrox Justicar   writes Aatrox.wad.client   Disable│
│ ▲ 22:40  Ended without │                                                     │
│          a reason      │ HINTS                                               │
│                        │ A mod that references a file it does not ship       │
│                        │ crashes the read. Check the project's textures.     │
│                        │                                                     │
│                        │ EVIDENCE                                            │
│                        │ 00:12.3  game    ALE-9B39AA45 Missing data: 0x1a2b… │
│                        │          confirmed · a file the game needed is in…  │
│                        │ 00:12.4  client  Interrupt, exit code -1073741819   │
│                        │ 00:04.1  host    injected, pid 18232                │
│                        │ 00:00.0  dll     redirected Aatrox.wad.client, +3   │
│                        │                                                     │
│                        │ 16.16.804.9184 · 12 s · Library · log found         │
│                        │                                                     │
│                        │ Open game log   Copy report   Rebuild overlay       │
└────────────────────────┴─────────────────────────────────────────────────────┘
```

The list is on the left, newest first, grouped by day. A row carries the verdict's glyph,
the time, the title, and the subject or the first suspect under it. A dismissed incident
keeps its row, dimmed.

The detail is on the right, and reads top to bottom in the order a player asks.

1. **The verdict.** The title, what it cost, and the cause in one or two sentences
2. **The suspects.** Each with the reason it is named. `Disable` toggles a
   library mod off. `Open` reveals a workshop project's path in the editor
3. **The hints.** One sentence each
4. **The evidence.** A timeline, newest first, each row with its source and its time. A
   coded row shows the meaning under it with the evidence mark, and an unknown code shows
   the code alone
5. **The facts.** The game's version, its length, the origin, and whether a log was found
6. **The actions.** `Open game log` reveals the `r3dlog` in the file manager. `Copy report`
   writes the [report text](#the-report-text). `Rebuild overlay` is the Patching setting's
   action, and disables while the patcher runs for the same reason

An evidence line and a fact are selectable text, because a player will paste them, and
the chrome around them is not. `Copy report` is there so nobody has to select anything.

The empty tab says what it is for, and not only that it is empty: `No game has gone wrong
while the patcher ran. When one does, what the manager learned about it lands here.` That
line is a new player's first explanation of the feature.

The System tab is today's page, with its counts header, its six categories and its two
buttons, and it changes nothing.

### The suspect badge

A mod named as a suspect in the newest undismissed incident carries a badge on its card,
beside `MissingDepsBadge` and on its shape. It reads `Suspected` in the warning tone, and
its tooltip holds the verdict's title and `Click to review`. A click opens the Games tab on
the incident.

The badge lives while the incident is the newest and undismissed, and goes when the user
dismisses the incident, disables the mod, or a newer game runs clean with the mod enabled.
The last rule is the one that matters. A mod that was in a clean game after the crash has
answered the question, and a badge that stays would be an accusation.

A crash that comes one game in five outlives the badge, and that is by design. The badge is
a question about the last game, the Games tab is the history, and the crash counter in
[Ideas for review](#ideas-for-review) is where a mod that keeps coming back would surface.

### The workshop verdict

A test run is a session with a workshop origin, and its incident names projects. Two places
show it.

- The project card on the Workshop page carries the same badge as a mod card
- The project editor's [problems list](PROJECT_EDITOR.md#ideas-for-review), when it
  arrives, lists the verdict as its first item, with the path or the archive as the row's
  subject, so a modder whose test crashed reads the reason in the editor they are in

Until the problems list exists, the project bar's Test action shows the incident's title in
its tooltip after a failed test, with `Details` to the Games tab.

### The report text

`Copy report` writes one text, and it is the text a support thread or a bug report wants.

```
# LTK Manager - League diagnostics
Incident: 2026-08-21T21:14:02 · LTK Manager v1.14.0 · League 16.16.804.9184
Token: DIAG1-eNpVjsEKgzAQRH9lyVkwEY3trdBLT4XSexCzNQE1kqQeiv_ejVLow8Ay7DJvpYwJ1B

Verdict: Missing data (likely)
League stopped a read it could not finish.
Path: assets/characters/aatrox/skins/skin12/aatrox_skin12_tx_cm.dds
Archive: Aatrox.wad.client

Suspects:
  - Aatrox Justicar - writes Aatrox.wad.client, which holds the path (likely)

Ending: Interrupt, exit code -1073741819, crashpad ran
Origin: library, 4 mods enabled, 4 archives redirected
Game log: found, 173 lines, 1 error line

Evidence:
  00:12.3  game    ALE-9B39AA45 FATAL ERROR. Missing data: 0x1a2b3c4d5e6f7081
           confirmed: A file the game needed is in no mounted archive
  00:12.4  client  Interrupt, exit code -1073741819
  00:04.1  host    injected, pid 18232
  00:04.2  dll     init done, eager scan
  00:00.0  dll     redirected Aatrox.wad.client, Map11.wad.client, UI.wad.client, Global.wad.client

Last lines of the game log:
  000012.301| ALWAYS|  LOAD| SEJ-9F31B5D0
  000012.344|  ERROR| ALE-9B39AA45 FATAL ERROR. Missing data: 0x1a2b3c4d5e6f7081
```

The shape follows the System tab's `reportToText`, with a heading, the facts, and the rows.
The second line is the [token](#the-incident-token), so a pasted report carries the short
form of itself.

### The incident token

A report is a page of text, and a URL or a chat message is not a place for a page. The
token is the same incident folded into one short string. A player pastes it anywhere, and
the team unfolds it in their own manager.

```
DIAG1-3gAVoXTOAcaLuqFtkwEOAKFnlBAQzQMkzSPgoXYGoU8BoW8BoXMBoWwBoWnDoVABoXICoXjSwAAABaFrw6FkDKFDkaxBTEUtOUIzOUFBNDWhcDShaM8aKzxNXm9wgaF1pkFhdHJveKFTka9BYXRyb3ggSnVzdGljYXKhUgShRQQ
```

| Part     | Is                                                                                     |
| -------- | -------------------------------------------------------------------------------------- |
| `DIAG`   | The format's name, unrelated to the manager's on purpose                               |
| `1`      | The format's version. It moves when a key changes its meaning, and never for one added |
| `-`      | A separator, so a double click in a chat client selects the rest                       |
| The rest | `base64url` with no padding, over a MessagePack map with one-letter keys               |

The record is the incident with the text taken out, and every field is optional, so a
decoder reads a token from a newer manager and skips what it does not know. A token whose
version is newer than the decoder's is refused by name, with `update to read it`, and never
as `not a token`. The numbers the enums travel as are pinned in a test one by one, so a
renumbering fails a build and not a reader.

```rust
struct IncidentToken {
    ended_at: u32,
    manager: [u16; 3],
    game: Option<[u16; 4]>,
    verdict: u8,
    origin: u8,
    overlay: u8,
    scan: Option<u8>,
    launch: u8,
    injected: bool,
    host_elevated: bool,
    phase: u8,
    exit_reason: Option<String>,
    exit_code: Option<i64>,
    crashed: Option<bool>,
    duration_secs: Option<u32>,
    codes: Vec<String>,
    last_load_step: Option<u8>,
    missing_hash: Option<u64>,
    subject: Option<String>,
    suspects: Vec<String>,
    skipped: Vec<(String, String)>,
    redirected_count: u16,
    enabled_count: u16,
    dll: Option<BinaryId>,
    host: Option<BinaryId>,
    patcher_ok: Option<bool>,
    scan_status: Option<String>,
    failure: Option<String>,
    overlay_detail: Option<String>,
}
```

| Budget                                 |                                                                                     |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| A typical incident                     | Under 300 characters                                                                |
| A bad one, ten codes and four suspects | Under 600                                                                           |
| A session failure                      | Under 400                                                                           |
| The cap                                | 1,000. Codes past the tenth and suspects past the fourth go first, then the details |
| Encoding, and decoding                 | Under a millisecond                                                                 |

There is no compressor. A typical record is 130 bytes of MessagePack, which deflate stores
rather than shrinks, at five bytes' cost, and only a token with ten near-identical codes
gained from one. A record that is small because it carries only what the verdict rests on
does not need one, and a script reads it with a `base64url` decode and a MessagePack parse.

What it leaves out, on purpose: the excerpt, every path on disk, the log's path, and
anything from the game's command line. A message the patcher quotes can name a file on
disk, and the token keeps the file's name and drops the directories above it. The token
carries nothing the report does not, and less.

**Which patcher ran.** Neither the host nor the DLL reports its own version, so the manager
reads it off the file at session start: a 16-hex SHA-256 prefix names the exact bytes, and
the PE header's `TimeDateStamp` is the build date. The manager bakes the checksums of the
binaries it bundles into its own build, so it can say whether the ones on disk are stock or
a stale or swapped copy, which is the case the current build's verdicts do not explain. No
git is involved: the checksum plus the manager's version identify a stock build outright,
and the checksum and date are the clues for anything else. The System tab shows the DLL's
checksum and date on the `Patcher DLL present` check, for a support call.

**Where it goes.** The second line of the report text, so a pasted report carries its
token. The `Report a Bug` URL, as `&diagnostic=<token>`, with a matching field in the issue
template, so the body a browser would truncate is a line instead of a page. And
`Copy token` beside `Copy report` in the Games tab.

**Decoding it.** The decoder lives in the core crate beside the encoder, and reads the
token against this build's tables: the verdict's kind, title and cost, the DLL's outcome,
each code with the table's reading of it, and the scan status by name. A number this build
does not know arrives as `null` with the verdict's number beside it, so a token from a
newer manager reads as far as it can. The Games tab has a `Decode a token` action. Paste
one, and the tab shows it as an incident card marked `From a token`, with every field the
token carries and no actions, because the mods it names are on another machine. A pasted
report or bug-report link decodes the same way, because the core crate finds the token
inside the text. The test vector is pinned, and so is the set of keys on the wire, so a
script reads a token without the application and a change to the wire fails a test first.

### Where the entry points are

| From                    | Route                                                                      |
| ----------------------- | -------------------------------------------------------------------------- |
| The verdict line        | `Details`, to the incident                                                 |
| The toast               | `Details`, to the incident                                                 |
| The notification center | The kept toast, to the incident                                            |
| The mod card            | The badge, to the incident                                                 |
| The title bar           | The Diagnostics icon, which carries a dot while an incident is undismissed |
| The keyboard            | `Ctrl+D`, which opens the page on the Games tab                            |
| The command palette     | `Open diagnostics`, and `Games` and `System` as two commands               |

The Diagnostics icon stays in the title bar, and the dot is the one change to it. The nav
strip holds two labelled tabs and a third would cost width for a page most players open
once a month. `Ctrl+D` is free today, `D` is the letter the page answers to, and `Ctrl+1`
and `Ctrl+2` stay with the nav tabs the page is not one of.

## Settings

The Patching tab gains two rows, under `Safety & Integrity`.

| Row                                 | Default | Does                                                    |
| ----------------------------------- | ------- | ------------------------------------------------------- |
| Read League's game log after a game | On      | Turns the reader off. Incidents still record the ending |
| Keep incidents                      | 50      | How many the app data holds, under 1MB together         |

One switch for the reader and no switch for the rest, because the rest costs nothing. The
ending and the boundaries arrive as events whatever the setting says, and an incident with
no log is still the ending, the suspects the DLL named, and the report text. The switch is
for a player who does not want the manager opening files under the League install, which is
a reasonable thing to want, and the row says that is what it does.

`Stop the patcher when the game ends`, from the `ritoclient-launcher` branch, sits beside
them.

## What the backend needs

| Piece           | Where                                   | Is                                                                                                                    |
| --------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `game_log.rs`   | `ltk-manager-core/src/diagnostics/`     | The reader, pure over `BufRead`, tested on a fixture                                                                  |
| `log_codes.rs`  | `ltk-manager-core/src/diagnostics/`     | The table, `include_str!` over the TSV, `lookup(&str)`                                                                |
| `incident.rs`   | `ltk-manager-core/src/diagnostics/`     | `Incident`, `Verdict`, `classify`, pure                                                                               |
| `token.rs`      | `ltk-manager-core/src/diagnostics/`     | `encode`, `decode`, `find_in` and `resolve` for the incident token, with a pinned vector                              |
| `dll_lines.rs`  | `patcher/`                              | The DLL's phrases as constants, each with a pointer to the DLL source file                                            |
| `InjectorEvent` | `patcher/injector.rs`                   | `GameAttached`, `OverlayOutcome`, `WadRedirected`, `WadSkipped`, `GameExited`                                         |
| `PatcherEvents` | `patcher/events.rs`                     | `game_attached`, `game_overlay`, `game_exited`, `incident_recorded`                                                   |
| The game record | `patcher/thread.rs`                     | Opened at `injected`, closed at `exited`, then classified                                                             |
| `IncidentStore` | `ltk-manager-core/src/diagnostics/`     | The JSON files, the cap, and the dismiss flag                                                                         |
| Commands        | `src-tauri/src/commands/diagnostics.rs` | `list_incidents`, `dismiss_incident`, `reveal_game_log`, `incident_report`, `incident_token`, `decode_incident_token` |
| Events          | `src-tauri/src/patcher/thread.rs`       | `patcher-game-attached`, `patcher-game-overlay`, `patcher-game-exited`, `incident-recorded`                           |

The core crate holds all of the logic, the way the patcher and the diagnostics already do,
and the Tauri crate adapts. A CLI could run the reader over a log and print the verdict with
nothing else in this list.

The session's ending reaches the game record through the `ritoclient-launcher` branch's
watcher, which already emits it. The record subscribes to the same `EventSink` path rather
than a second one.

### What the frontend needs

| Piece                                           | Where                                        | Is                                                                                 |
| ----------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------- |
| `useIncidents`                                  | `modules/diagnostics/api/`                   | The list, keyed `["diagnostics", "incidents"]`, invalidated by `incident-recorded` |
| `IncidentList`, `IncidentDetail`, `VerdictCard` | `modules/diagnostics/components/`            | The Games tab                                                                      |
| The tabs                                        | `pages/Diagnostics.tsx`                      | `Tabs` from `@/components`, `Games` first                                          |
| The verdict line                                | `modules/launcher/components/SessionBar.tsx` | A fifth resting branch                                                             |
| `SuspectBadge`                                  | `modules/library/components/`                | `MissingDepsBadge`'s shape, in the warning tone                                    |
| `TokenDecoder`                                  | `modules/diagnostics/components/`            | The paste box, and the read-only card it renders                                   |
| `PatcherEventListeners`                         | `routes/__root.tsx`                          | Moves out of the Library page                                                      |
| `usePatcherError`                               | `modules/patcher/api/`                       | Switches on `PatcherError.kind` and `InjectionStage`                               |

The last two rows are the gaps from [What exists today](#what-exists-today), and they land
first because they cost an afternoon and fix a failure that is dropped on three of four
pages.

## Privacy

The feature reads files it did not write, and some of what they hold is not the manager's
to keep.

| Data                                   | Where it is                    | The manager                                    |
| -------------------------------------- | ------------------------------ | ---------------------------------------------- |
| The player id, the game id, the server | The log's `Command Line:`      | Drops them at the reader. Keeps `-GameBaseDir` |
| The account name, the PUUID            | `GameCrashes/*/__sentry-event` | Never opens the file                           |
| The hardware, the settings             | The same event                 | Never opens the file                           |
| The path of a mod on disk              | The patcher's own events       | Keeps it, and leaves it out of the token       |

The report text is built from the incident and not from the log, so nothing the reader
dropped can reach it. The last-lines excerpt passes through the same redaction as the
header, because a later line can repeat the command line. The token holds less than the
report: no excerpt, and a message that named a file on disk keeps the file's name alone.

Nothing is sent anywhere. The one outward route is `Report a Bug`, which opens a browser on
a prefilled issue that the player reads before submitting, and the token in its URL decodes
to the same facts the report shows.

## Why a verdict and not a log viewer

A log viewer asks the player to be the expert. The codes are opaque on purpose, a retail
build carries no text for them, and `SEJ-3E9A0C57` tells nobody anything until a table
says it is the step that builds the environment's cube-map array. A viewer with the table
beside it is still a viewer, and a player who hit a crash wants a sentence.

The viewer is still in the design, as the evidence timeline and the excerpt under the
verdict. A player who wants the lines has them, and a support volunteer who wants the raw
log has `Open game log`. The verdict is the first thing on the screen, and the log is the
last.

## Why the incident is per game

The host outlives the game. `exited` leaves the loop running and the host scanning, so a
player who plays three games in a row starts the patcher once. A record keyed on the
session would hold three games and one verdict, and the verdict would be wrong for two of
them. A record keyed on the game holds one, and the session is a field on it.

## Ideas for review

These are proposals. None is a decision.

**Startup reconcile.** A game that ends while the manager is closed leaves a log and no
incident. At startup the manager could list `GameLogs` for directories newer than its last
incident, read each, and record the ones that did not end clean. It would have no
boundaries and no redirected list for them, so every verdict would be a Lead, and the list
would need a line saying the manager was not running.

**Bisect.** A crash with four suspects and a Lead is a crash the player solves by hand,
disabling half the mods and playing again. A control that does the halving, remembers the
set, and asks after each game would turn four games into two. It would need the clean-game
signal that the suspect badge already wants.

**Hash search in mod bins.** The `ALE-9B39AA45` hash names one file, and the mod that
references it has the hash in a `.bin`. A scan of each suspect's bins for the hash would
name one mod. It waits on the lazy `ltk_meta` read that the
[bin object index](PROJECT_EDITOR.md#the-bin-object-index) waits on, and it is the same
scan.

**The last good overlay.** An overlay rebuilt after a game patch is a different overlay,
and a crash after a patch is often the patch. Keeping the previous build's fingerprint
would let the verdict say `The game updated since your last clean game`, which is the
sentence a support thread says first.

**A crash counter on the mod.** Two incidents naming the same mod in a week is a stronger
signal than either. A count on the card, and a sort by it, would surface the mod that keeps
coming up.

## Open questions

1. Does the token carry the suspects' display names? They are the names a player would
   paste anyway, and they are user content, so a name can be anything. The proposal carries
   them cut to 32 characters.
2. Does the startup reconcile belong in the first release? A game that ended while the
   manager was closed is the case the Classic flow produces most, and nothing else in the
   design depends on it.

### Answered

| Question                                                | Answer                                                                                          |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Is the record per session or per game?                  | Per game. The host outlives the game                                                            |
| Does the manager read the Sentry event?                 | No. `last_crash` is read, and nothing beside it                                                 |
| Does anything leave the machine?                        | No. The report is a text the player pastes                                                      |
| Where does the code table live?                         | In the core crate, compiled in as a TSV, and maintained by hand                                 |
| What is the kind column for?                            | The classifier switches on it, so a code joins a verdict as a row                               |
| What does an inferred row read as?                      | A Lead, and never a diagnosis                                                                   |
| What does an unknown code read as?                      | The code, shown as is. Never an error                                                           |
| Does `injected` mean the game was modded?               | No. The DLL's `init done` does, and four other lines say why not                                |
| Where do the DLL's phrases come from?                   | `ltk-patcher`, read at the source, and kept in one module here                                  |
| Is a crash a popup, a status-bar line, or both?         | Both. The popup announces it for six seconds, and the line keeps the answer until the next game |
| Does a clean game record an incident?                   | No, with two exceptions: a disabled overlay and a skipped archive                               |
| How many incidents are kept?                            | The newest fifty, under 1MB together, and the oldest goes                                       |
| Does a game the patcher never touched make an incident? | Yes, when the session or the host saw it. The verdict is Unmodded, and it says why              |
| Which key opens the Diagnostics page?                   | `Ctrl+D`, on the Games tab                                                                      |
| When does the suspect badge clear?                      | On a dismiss, a disable, or a clean game with the mod enabled                                   |
| What goes into the bug report URL?                      | The incident token, and not the report                                                          |
| Can the team read a token?                              | Yes. The Games tab decodes one, and so does the core crate without the app                      |
| Where do the system checks go?                          | The System tab, unchanged                                                                       |
| Does the manager write into the League directory?       | Never                                                                                           |
| Which side classifies?                                  | Rust, in the core crate, as a pure function                                                     |
| What names a suspect?                                   | The archive, through `affected_wads`, and the DLL's redirected list                             |

A row moves here when the body of this document carries the answer.
