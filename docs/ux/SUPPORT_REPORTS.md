# Support reports

## Changes

| Date       | Change                                                        |
| ---------- | ------------------------------------------------------------- |
| 2026-11-12 | Gaps closed: no-start path, known causes, mute, leak response |
| 2026-11-12 | Decisions from the team review, in the Decisions table        |
| 2026-11-11 | First proposal                                                |

Each edit of this document adds a row at the top. The table keeps the last ten rows.

Support reports is the LTK Manager feature for a user whose mods do not work and who does not know
why. It has three parts. The manager explains the failure in the app where the evidence allows it.
The manager writes a log that holds no private data. One press produces a redacted report that a
maintainer can read without asking the user for anything else.

[League diagnostics](LEAGUE_DIAGNOSTICS.md) covers a game that went wrong. This document covers
what that feature does not: a game that ran clean without the mod, a failure outside a game, and
the path from the user's machine to a maintainer.

No feature in this document is built. [Decisions](#decisions) holds what the team decided.

## The problem, measured

**Reports arrive without evidence.** Users filed 42 issues between 2026-09-12 and 2026-11-08. Four
contain log text. Six contain an incident token. Titles include `BUG`, `nao esta funcionando` and
`Skins not showing`.

**The log is hard to reach.** `Open log file` in Settings, About opens a folder of daily files.
The user has to pick the file, and has to know that a file must be attached. A failed open shows
nothing (`src/lib/tauri.ts:643`).

**The log is not redacted.** One day of the log on a developer machine holds the Windows username
on 20 of 922 lines. The same path is written two ways, `C:\Users\<name>` and the `{:?}` form
`C:\\Users\\<name>`. The telemetry scrubber replaces the first spelling only, and nothing runs it
on the log file. The log also holds deep link URLs, download URLs, mod ids, workshop project paths
and the League path.

**The log hides its own errors.**

- A DLL record is written at `INFO` whatever level the DLL gave it (`injector.rs:295`), so a search
  for `ERROR` finds no DLL error
- A host `INFO` line is written at `WARN` (`host/persistent.rs:182`)
- The filter names four targets and no default level (`logging.rs:52`), so a warning from any other
  crate is dropped. The `ltk_game_index` warning `Skipping archive` never reaches the file
- No line carries a run id, a patcher session id or a game id. A tool cannot cut one game out of
  the file

**The reasons for "the mod does not work" are logged and not shown.**

| Condition                                        | Where it is logged                   | The user sees |
| ------------------------------------------------ | ------------------------------------ | ------------- |
| The DLL refused the overlay after `init done`    | `verify/mod.rs:170`, `[VRF0000000N]` | Nothing       |
| The DLL could not open a verified archive        | `imp_windows_iat.rs:120`             | Nothing       |
| An override could not be routed to an archive    | `ltk_overlay` `resolve.rs:380`       | Nothing       |
| A mod in the profile is missing from the library | `overlay_content.rs:89`              | Nothing       |
| A mod's content is missing on disk               | `overlay_content.rs:94`              | Nothing       |
| A mod lost every file to a higher-priority mod   | Not logged                           | Nothing       |
| A multi-layer mod has no saved layers            | Not logged, `base` alone is applied  | Nothing       |
| A broken mod entry is hidden from the library    | `library.rs:63`                      | Nothing       |
| A delivered DLL failed attestation at startup    | `src-tauri/patcher/delivery.rs:75`   | A later error |

The DLL has 40 warn and error sites. The manager matches 6 of them in `dll_lines.rs`. The first row
is the most important one. The DLL writes `init done`, the manager records the overlay as live, the
DLL then refuses the overlay, the game ends clean, and the manager drops the game record
(`pipeline.rs:133`). Issue #923 is this case.

**A clean game leaves no record.** The list of archives the DLL served exists in memory only
(`recorder.rs:85`). After a clean game nothing on disk answers "was my mod in the game", except
`redirected wad:` lines in the daily log.

**An error toast is a dead end.** A failed command shows a generic title, such as `File system
error`, and the backend's raw text. The toast has no `Details`, no `Copy` and no report action. The
notification center keeps a title and a description in memory until the app closes.

## Goals

- A user whose mod did not load learns the reason in the app, in one sentence, without a log
- A user who needs help sends everything a maintainer needs in one press
- The log file on disk holds no username, no account identifier and no secret
- Nothing leaves the machine without a press, and the user reads what leaves before it does
- A failure signal that the manager does not know yet is still recorded and still reaches a report
- A maintainer reads a report on one page, and asks the user for nothing else

## Feature status

A status word has the meaning that [League diagnostics](LEAGUE_DIAGNOSTICS.md#feature-status)
gives it.

| Feature                 | Status  | Note                                                           |
| ----------------------- | ------- | -------------------------------------------------------------- |
| Log levels and filter   | Planned | The DLL's level, the host's level, a default level of `warn`   |
| Run, session, game ids  | Planned | Three spans, written on every line                             |
| The redactor            | Planned | One crate, known values first, patterns second                 |
| Redacted log file       | Planned | The redactor runs in the file writer                           |
| Canary test             | Planned | A CI run that plants private values and searches every output  |
| Support report          | Planned | An allowlisted zip, built by named builders                    |
| Report preview          | Planned | The file list, the redacted text and the replacement counts    |
| Save and copy           | Planned | A file on disk, and a short summary on the clipboard           |
| `Get help` entry points | Planned | Error toasts, both crash screens, the menu, the mod card       |
| Game record             | Planned | One small record for every game, clean games included          |
| Advisory                | Planned | A coded condition that changes what the user gets              |
| Mod trace               | Planned | Why one mod did or did not reach the last game                 |
| Error reference         | Planned | A short id on an error, the same id on its log line            |
| Upload and report code  | Planned | One code to paste. Needs an endpoint and an ADR                |
| Report reader           | Planned | A web page behind the GitHub login                             |
| Patcher codes           | Planned | Every DLL and host warn or error carries a code. `ltk-patcher` |
| Code table by delivery  | Planned | The table for a DLL build travels with that build              |
| Host line buffer        | Planned | The last game's DLL lines in a file, for a closed manager      |

## Vocabulary

| Word           | Meaning                                                                         |
| -------------- | ------------------------------------------------------------------------------- |
| Support report | The redacted zip that one press builds                                          |
| Report code    | The short string that names an uploaded support report                          |
| Game record    | What the manager keeps about one game, whatever the ending                      |
| Advisory       | A coded condition that the manager handled and that changes what the user gets  |
| Mod trace      | The per-mod reading of the overlay build and the last game record               |
| Known value    | A private string that the manager holds at run time, such as the user's profile |

`Advisory` gets a GLOSSARY entry before any code uses it. `Notice` is taken by the news feed,
`Finding` by mod health and `Verdict` by both mod health and League diagnostics.

An incident stays what it is. A game record exists for every game, and an incident exists for a
game whose record the classifier gave a verdict.

## The log

### Levels and filter

| Source              | Written at                                                |
| ------------------- | --------------------------------------------------------- |
| A `dll` record      | The level in the record: `error`, `warn`, `info`, `debug` |
| A host stderr line  | The level in the line. `warn` if the line has no level    |
| Any crate not named | `warn` and above, from a default directive in the filter  |
| A frontend error    | `error`, target `ui`, through one rate-limited command    |
| A panic             | `error`, from the panic hook, before the telemetry call   |

The frontend error and the panic are not in the log file today. Both go to telemetry only, so a
user with telemetry off has no record of either.

**Verbose patcher logging is the default.** The host and the DLL run at the level that the
`Verbose patcher logging` setting selects today, and the setting is removed. Every report then
holds the detailed records, and no maintainer asks a user to play one more game with a switch on.
The cost in a game is not measured. The change ships after a measurement of the records a game
writes and of the time each record takes in the DLL. The default stays as it is if the measurement
shows a cost that a player can notice.

### Ids

Three spans carry three ids, and the formatter writes the open spans on every line.

| Span      | Opens                          | Id                           |
| --------- | ------------------------------ | ---------------------------- |
| `run`     | At process start               | Eight hex characters, random |
| `session` | When the patcher thread starts | A counter inside the run     |
| `game`    | At the first sign of a game    | The game record's id         |

```
2026-11-11T19:02:11.412Z  WARN run{id=4be1c07a}:session{n=2}:game{id=2026-11-11T19-02-04}: ltk_dll: [LTK-V008] host verification failed, refusing overlay
```

The report builder cuts the log by `run` id. The game record keeps its lines by `game` id.

### Retention

Daily rotation stays. A size cap of 5 MB per file is added, because verbose patcher logging has no
bound and becomes the default. The 7-day cleanup stays.

## Redaction

### One redactor

A crate, `ltk-redact`, holds the one redactor. The `Scrubber` in `ltk-telemetry` moves into it, and
the regexes of `game_log::redact_line` move into it. Telemetry, the log writer, the game log
reader, the incident report, the System tab's report and the support report all call it. The
System tab's `reportToText` prints absolute paths today and moves to the backend for this reason.

### Known values first

A pattern guesses what a private string looks like. A known value is the string itself, so it is
matched exactly in every spelling. The redactor is built at startup from the values the process
holds, and a value is registered when the process reads it.

| Known value                                  | Replaced with      |
| -------------------------------------------- | ------------------ |
| The profile directory                        | `%USERPROFILE%`    |
| The username, four characters or longer      | `<user>`           |
| The computer name                            | `<machine>`        |
| The League install path                      | `<league>`         |
| The mod storage path                         | `<data>`           |
| The workshop path, and each project path     | `<workshop>`       |
| `telemetrySecret`, the delivery bearer token | `<secret>`         |
| The delivery install id                      | `<install>`        |
| The RuneForge username and user id           | `<runeforge-user>` |
| The lockfile password, once read             | `<secret>`         |

A path value is matched in each spelling the code can write: backslashes, forward slashes, the
`{:?}` form with doubled backslashes, the `\\?\` prefix, the 8.3 short name, and any letter case.
A path match ends at a separator or at the end of the component, so `C:\Users\bob` does not match
inside `C:\Users\bobby`. The existing scrubber has that defect. The longest value is matched
first, so a workshop path under the profile directory reads `<workshop>` and not
`%USERPROFILE%\...`.

A username shorter than four characters is replaced inside paths only. A bare three-letter
username would match inside ordinary words.

### Patterns second

| Pattern                                       | Replaced with                       |
| --------------------------------------------- | ----------------------------------- |
| `<drive>:\Users\<name>\` for any other name   | `<drive>:\Users\<other>\`           |
| A URL                                         | The scheme, host and path. No query |
| An `ltk://` link                              | The action. No payload              |
| An IPv4 or IPv6 address, loopback excepted    | `<ip>`                              |
| A UUID                                        | `<uuid>`                            |
| A Riot ID in quotes, `'Name#Tag'`             | `<riot-id>`                         |
| An email address                              | `<email>`                           |
| `Bearer <text>`, and `token=`, `key=` values  | `<secret>`                          |
| The game log fields `redact_line` drops today | As today                            |

### Where it runs

The redactor runs in three places.

1. **In the log file writer.** A wrapper around the appender redacts each line before it is
   written. The file on disk is redacted, so a user who finds the file and sends it by hand sends
   a redacted file. A debug build writes the stdout layer unredacted
2. **In every report builder.** A report file is redacted again when it is built. This covers a log
   written by an older release, and a known value that was registered after the line was written
3. **In telemetry.** As today

**Log files from an older release.** The first start of the release that redacts the log rewrites
each existing log file through the redactor, in place. No unredacted file is left, and the history
stays available to a report.

A day of log is under 1,000 lines without verbose logging. The budget is 20 microseconds a line,
with one Aho-Corasick automaton over the known values and one `RegexSet` as the prefilter.

### What redaction keeps

A redacted path keeps its shape. `%USERPROFILE%\AppData\Roaming\dev.leaguetoolkit.manager\mods\x`
tells a maintainer as much as the original does.

Some failures are caused by the path itself, so four facts about a replaced path are kept.

| Fact                  | Kept as                                                               |
| --------------------- | --------------------------------------------------------------------- |
| Non-ASCII characters  | A mark on the placeholder: `%USERPROFILE:non-ascii%`                  |
| Length                | The original length in characters, as a row of the System checks      |
| Drive letter and kind | The letter stays in the path. The System checks report the drive kind |
| Cloud sync            | A row of the System checks for the storage path and the League path   |

The mark is set when the replaced text holds any character outside ASCII. The length and the two
System check rows are computed from the real path before it is replaced.

**Mod names stay in a support report.** A maintainer cannot help with a mod that has no name, so
a report always holds the names, and the dialog has no switch for them. The preview lists them
before anything leaves. Telemetry sends a digest and never a name, and that rule does not change.

### The canary test

A test starts the backend with a planted profile directory, username, League path, deep link with
a query string and each secret. It runs an install, an overlay build and a failed patcher start.
It then searches the log file, every file of a support report, the incident report text and the
telemetry spool for each planted value in each spelling. One hit fails the build. The planted
username runs in four forms: ASCII, with a space, Cyrillic and CJK. A log call
added next year is covered without anybody remembering this document.

The manifest of a report carries the redactor's ruleset version and a count of replacements for
each rule, so a maintainer sees which rules a report was built with.

## The support report

### Contents

A file is in the report only if a named builder writes it. No builder copies a directory, and no
file is included by default.

| File                  | Holds                                                                          |
| --------------------- | ------------------------------------------------------------------------------ |
| `report.md`           | The summary, in English: the user's words, versions, advisories, the verdict   |
| `manifest.json`       | Schema version, ruleset version, replacement counts, the file list             |
| `log/ltk-manager.log` | The current run and the two runs before it, 2 MB at most, newest kept          |
| `games/*.json`        | The last five game records                                                     |
| `incidents/*.json`    | The last five incidents, and the report text of each                           |
| `system.json`         | The System checks, run when the report is built                                |
| `library.json`        | Each mod of the active profile, enabled first. Other profiles as a count       |
| `overlay.json`        | The last build: fingerprint, per-mod counts, advisories                        |
| `settings.json`       | An allowlist of fields. A path field holds its placeholder                     |
| `patcher.json`        | The channel, the DLL's version, digest and build date, the code table version  |
| `game-log/r3dlog.txt` | The incident's game log, redacted line by line. Ticked when an incident exists |

A report never holds `delivery.json`, `telemetrySecret`, the `runeforge` block, a credential, a mod
file, an archive, a screenshot or anything under `Logs/GameCrashes`.

A mod row holds the name, version, digest, enabled state, priority, layers, health verdict and
archives.

The game log is included when the report rests on an incident, and the user can untick it. It is
never included while `Read League's game log` is off in Settings.

`report.md` and the clipboard summary are written in English whatever the app's language is. The
user's own description is kept as typed.

The target size is under 500 KB, and the cap is 2 MB. The log is cut first when the cap is hit.

**The user's own text is redacted.** `Anything to add?` passes the redactor like every other
file, because a user can type a Riot ID, an email or a path. The preview shows the redacted text
with each replaced part marked.

**A report holds no image.** An image cannot be redacted. When the mod trace ends at `The last game
loaded this mod`, the dialog adds one line, `Add a screenshot to your message`, and the user
attaches it in Discord or on GitHub.

**A build that the project did not release is marked.** The first line of `report.md` states the
app identifier, the version, and whether the executable carries the project's signature. A build
without that signature can save a report and cannot upload one.

### The dialog

```
+--------------------------------------------------------------------+
| Get help                                                           |
|                                                                    |
| What went wrong?                                                   |
| (o) A mod does not show   ( ) The game crashed   ( ) The manager   |
|                                                                    |
| Which mod?   [ Aatrox Justicar                                v ]  |
|                                                                    |
| Anything to add? (optional)                                        |
| [                                                                ] |
|                                                                    |
| THE MANAGER FOUND                                                  |
| ! The patcher was not running in your last game                    |
|   Aatrox Justicar was not in the game.          [ Start patcher ]  |
|                                                                    |
| WHAT THE REPORT HOLDS                                    Preview   |
|   The app log, 3 runs                                   212 KB     |
|   5 games, 1 incident                                    31 KB     |
|   System checks, settings, 14 mods of profile Default    18 KB     |
|   [x] League's own game log                              44 KB     |
|                                                                    |
|   61 paths, 4 links and 2 addresses were replaced.                 |
|   No account name and no file of yours is included.                |
|                                                                    |
|   Send anyway:        Save as file        Copy for Discord         |
+--------------------------------------------------------------------+
```

- **What went wrong** is three choices and a mod picker. The text field is optional, so a user who
  does not write English still sends a structured report
- **The manager found** lists the advisories and the verdict the report rests on. A cause that has
  a fix shows the fix as the primary button, and the send actions move under `Send anyway`. A
  report with no known cause shows the send actions as primary
- **Preview** opens every file of the report as text, as it will leave
- **Copy for Discord** writes the zip, reveals it in the file manager, and copies a summary of
  under 1,500 characters: the versions, the user's choice and mod, each advisory and the verdict in
  one line, and the incident token. A Discord message holds 2,000 characters
- **Save as file** writes `ltk-report-<date>-<id>.zip` through the save dialog and reveals it
- **Open a GitHub issue** sits under the two buttons, and opens the issue form with the version,
  the token and the report code filled in

Discord is where most of this support happens, so the Discord action is the primary one. Once the
[upload](#upload-and-the-report-code) ships, `Copy for Discord` uploads the report, and the summary
ends with the report code in place of a file to attach.

### Known causes

The dialog checks four sources for a cause before it offers to send. Each one shows its own fix as
the primary button and moves the send actions under `Send anyway`.

| Source                              | The dialog shows                      | Primary button        |
| ----------------------------------- | ------------------------------------- | --------------------- |
| An advisory or a verdict with a fix | The sentence for the code             | The fix of that code  |
| An update is available              | The installed and the latest version  | `Update now`          |
| A published known issue             | The maintainers' message and its link | `Read more`           |
| The evidence names one mod          | `The problem is in this mod`          | `Open the mod's page` |

**Updates.** A report from an outdated manager or patcher states both versions on its first line.

**Known issues.** `config/known-issues.json` in the repository maps advisory codes and verdict
kinds to a short message, a link and the versions it applies to. The app fetches it the way it
fetches the news. The session bar shows the message beside a matching advisory or verdict, so a
failure that hits every install on a patch day is answered before a user opens the dialog.
Maintainers publish and withdraw an entry without a release.

**The mod's author.** A mod is named when it is unhealthy, when its archive failed verification,
or when it is the one suspect of an incident. `Open the mod's page` uses the origin that the
library index records, a RuneForge post or the install link. The dialog also copies a summary
written for the author. A mod with no recorded origin gets the sentence and no button.

The zip writer and the save dialog exist already, in the mod export.

### Entry points

| From                               | Does                                                           |
| ---------------------------------- | -------------------------------------------------------------- |
| An error toast                     | `Details` on every one. `Get help` on an unexpected code       |
| The crash screen                   | The same action. Replaces the bare issue link                  |
| A route error                      | A `defaultErrorComponent` that renders the crash screen        |
| The next start after a panic       | One line in the session bar: `The manager closed unexpectedly` |
| The title bar menu                 | `Get help`. `Report a Bug` is removed                          |
| A mod card menu                    | `Not working in game?`, which opens the mod trace              |
| The Games tab and the verdict line | `Get help` beside `Copy report`                                |
| Settings, About                    | `Get help`, and `Open log folder` below it                     |
| The command palette                | `Get help`                                                     |

A route render crash shows the router's unstyled `Something went wrong!` today and sends no
telemetry, because no error component is set. The `defaultErrorComponent` fixes both.

### When the manager does not start

Several issues are about a manager that does not open. `Get help` inside the app cannot serve
them, so the report builders live in the backend and need no webview.

| Path                                          | Does                                                               |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `ltk-manager.exe --report`                    | Builds the report, opens a native save dialog, and reveals the zip |
| The Start menu entry `LTK Manager - Get help` | Runs the executable with that flag. The installer adds it          |
| A startup failure the backend detects         | A native dialog with the error and `Save report`                   |

The report from this path holds the log, the System checks, the settings and the mod list. It adds
the WebView2 runtime version and the result of the webview start, which the in-app report does
not need.

## Explaining the failure in the app

A report is the fallback. Most of the conditions in [The problem](#the-problem-measured) can be
named in the app, and a user who reads the reason does not file an issue.

### The game record

The recorder keeps a record for every game and stops dropping it on a clean ending.

```rust
pub struct GameRecord {
    pub id: String,
    pub run: String,
    pub session: u32,
    pub started_at: String,
    pub ended_at: String,
    pub overlay: OverlayOutcome,
    pub overlay_fingerprint: String,
    pub redirected: Vec<String>,
    pub skipped: Vec<SkippedWad>,
    pub advisories: Vec<Advisory>,
    pub incident: Option<String>,
    pub lines: Vec<String>,
}
```

`lines` holds the warn and error records of the game, redacted, 64 at most. The store keeps the
newest 20 records under `games/<id>.json`, 200 KB together. A record is under 10 KB.

No page lists the game records. The mod trace and the support report read them, and the Games tab
stays a list of incidents. The record is built from patcher events and reads no file of League, so
the `Read League's game log` setting does not gate it.

### Advisories

An advisory is a condition that the manager handled and that changes what the user gets. It has a
stable code, a severity, a subject and typed fields. It crosses IPC as a code, and the frontend
catalog words it (ADR-0017).

```rust
pub struct Advisory {
    pub code: AdvisoryCode,
    pub severity: Severity,
    pub subject: Option<Subject>,
    pub fields: BTreeMap<String, String>,
    pub at: String,
}

pub enum Subject {
    Mod(ModId),
    Archive(String),
    Project(String),
}
```

One function raises an advisory. It writes the log line with the code and records the advisory on
the open build or game. A `warn!` about a condition that changes what the user gets is replaced by
that call, so the log and the record cannot disagree.

| Code                  | Raised by         | Subject | The user reads                                              |
| --------------------- | ----------------- | ------- | ----------------------------------------------------------- |
| `mod-missing`         | Overlay content   | Mod     | The mod is in the profile and not in the library            |
| `mod-content-missing` | Overlay content   | Mod     | The mod's files are missing on disk                         |
| `overrides-unrouted`  | `ltk_overlay`     | Mod     | N files of the mod match no game archive                    |
| `mod-shadowed`        | `ltk_overlay`     | Mod     | Every file of the mod is replaced by a higher mod           |
| `layers-unset`        | Overlay content   | Mod     | The mod has layers and none is chosen. `base` alone is used |
| `locale-missing`      | `ltk_overlay`     | Mod     | The mod's strings target a locale the game does not have    |
| `entry-unreadable`    | Library index     | Mod     | The mod's entry cannot be read                              |
| `overlay-refused`     | The DLL, `LTK-V*` | None    | The patcher refused the overlay. No mod was in the game     |
| `archive-not-served`  | The DLL           | Archive | The patcher could not open one modded archive               |
| `skin-data-stale`     | The DLL           | Archive | The skin check ran against another game version             |
| `dll-unattested`      | Delivery          | None    | The downloaded patcher failed its check                     |
| `patcher-uncoded`     | The injector      | None    | The patcher reported an error the manager does not know     |

`mod-shadowed` and the per-mod form of `overrides-unrouted` need `ltk_overlay` to report conflicts.
`BuildResult::conflicts` exists and is always empty today.

`patcher-uncoded` is the row that covers next year. A DLL warn or error record that matches no
phrase and no code is kept on the game record and raises this advisory with the record's text. The
user sees that something was reported, and a report carries the line.

**Two tiers.** A precise reason for an integrity refusal tells a bypass author what to change, so
an advisory from the patcher has one of two tiers.

| Tier        | Covers                                                                             | The user reads                               |
| ----------- | ---------------------------------------------------------------------------------- | -------------------------------------------- |
| Environment | The parent process, elevation, a stale skin database, a file that cannot be opened | A sentence that names the cause, and a fix   |
| Integrity   | Host verification, the anti-skinhack scan, a signature                             | The code, and `The patcher refused this mod` |

The detail of an integrity advisory goes into the support report and nowhere in the app. The
patcher's code table sets the tier of each code. A code with no tier is an integrity code, so an
older manager never explains a code that it does not know.

**Where an advisory shows.** An advisory raises no toast and no dialog.

- The session bar, after a build or a game: `2 mods were not applied`, with `Details`. The line
  stays until the next build or game
- The mod card, on the suspect badge's shape, while the advisory is from the newest build or game
- The mod trace
- The `Get help` dialog
- The support report

**Muting.** Some advisories describe a state the user chose, such as a mod that a higher mod
replaces on purpose. `Do not show again for this mod` mutes one code for one mod. A muted advisory
is absent from the session bar and the badge, and stays in the mod trace and the report. A change
to the mod's content or its priority clears the mute.

**Workshop projects.** A project under test is an advisory subject. The project card and the
project bar's Test action show the advisory, and the mod trace opens from the project. A modder is
the user who can act on `N files match no game archive`.

**A code newer than the manager.** The sentence comes from the code table delivered with the DLL,
in English, with the code. The next manager release adds the code to the catalog and its
translations.

A game with an `overlay-refused` advisory is an incident with the `No mods applied` verdict. The
classifier reads the advisory the way it reads the other overlay outcomes.

### The mod trace

`Not working in game?` on a mod card opens one panel. It reads the overlay build and the newest
game record for that mod, top to bottom, and stops at the first row that fails.

```
+--------------------------------------------------------------------+
| Aatrox Justicar                                                    |
|                                                                    |
| v  Enabled in profile Default                                      |
| v  Healthy, checked today                                          |
| v  In the overlay, built 19:01 for League 16.22                    |
| v  Patches 2 archives: Aatrox.wad.client, Global.wad.client        |
| !  9 of 41 files are replaced by Aatrox Reforged, which is higher  |
| x  The last game did not load this mod                             |
|    The patcher refused the overlay (LTK-V008).                     |
|    The sentence for this code, from the catalog.                   |
|                                                                    |
| Last game: 19:02, 24 minutes, patcher running                      |
|                                                                    |
|                                     Rebuild overlay     Get help   |
+--------------------------------------------------------------------+
```

| Row                | Reads from                                                    |
| ------------------ | ------------------------------------------------------------- |
| Enabled            | The library index                                             |
| Health             | The mod health verdict                                        |
| In the overlay     | The build's fingerprint against the mod's content fingerprint |
| Archives           | `wad-reports.json`                                            |
| Shadowed, unrouted | The build's advisories                                        |
| The last game      | The game record: the overlay outcome, `redirected`, `skipped` |

The last row has five readings.

| The game record holds                                 | The row reads                                  |
| ----------------------------------------------------- | ---------------------------------------------- |
| No game since the mod was enabled                     | `No game has run since you enabled this mod`   |
| A game, and the patcher was not running               | `The patcher was not running in the last game` |
| A game whose overlay was not live, or was refused     | The reason, from the advisory or the outcome   |
| A live overlay, and none of the mod's archives served | `League did not load this mod's archives`      |
| A live overlay, and each of the mod's archives served | `The last game loaded this mod`                |

**A game the manager did not watch.** A game that ran while the manager was closed has no game
record until the [host line buffer](#the-contract-with-the-patcher) exists. The trace compares the
newest directory under `Logs/GameLogs` with the newest game record. If the directory is newer, the
last row reads `The manager was not running during your last game, so no mod was applied`, and
offers the autostart setting. The check is one directory listing, and it does not run while
`Read League's game log` is off.

The fourth reading is common and correct. A champion's archive is served only in a game with that
champion in it. The row says so: `Aatrox was not in the last game`.

The fifth reading is the honest end of what the manager knows. The mod was served and looks wrong,
which the log cannot show. The panel says that, and `Get help` is the action.

### Error reference

An `AppErrorResponse` gains `ref`, eight characters, and the backend writes the same `ref` on the
error's log line. A toast for a failed command gains two actions.

| Action     | On                 | Does                                                                         |
| ---------- | ------------------ | ---------------------------------------------------------------------------- |
| `Details`  | Every error toast  | Expands the toast: the code, the kind, the detail text and the `ref`. `Copy` |
| `Get help` | An unexpected code | Opens the dialog with the code and the `ref` filled in                       |

The unexpected codes are `UNKNOWN`, `IO`, `INTERNAL_STATE`, `WAD`, `OVERLAY` and `PATCHER`. A toast
for any other code reaches `Get help` through `Details`, so a routine error, such as a League path
that is not set, does not invite a report.

The notification center keeps the code and the `ref` with the entry. The entries of the current
run go into `report.md`.

An `UNKNOWN` code is a failure that no variant names. `app_error` telemetry already counts them. A
message that reaches a set count in a week gets a variant and a sentence in the catalog.

## Upload and the report code

A saved file still asks the user to attach it. The issue data shows that users do not attach
files. An upload returns one code, and a code pasted into an issue or a Discord message is the
whole report.

```
LTK-7F3K-92QD
```

| Part        | Is                                                                               |
| ----------- | -------------------------------------------------------------------------------- |
| Endpoint    | `POST https://reports.leaguetoolkit.dev/v1/reports`, a Cloudflare Worker over R2 |
| Admission   | The challenge the patcher delivery service uses. The install id is not stored    |
| Limits      | 2 MB a report, five reports a day for one install                                |
| Retention   | 30 days, then deleted                                                            |
| Reading     | Cloudflare Access with GitHub login, limited to a LeagueToolkit team             |
| Deleting    | The response carries a delete token. Settings, Privacy lists sent reports        |
| Kill switch | `config/support.json` turns the upload off for every install without a release   |

A code reads nothing without that login, so a code is safe to paste in a public channel. Access
follows membership of the team, and the service keeps no account list of its own.

A Discord helper has no access. The pasted summary names the cause, the mod and the versions,
which answers most threads, and a helper asks a maintainer when the full report is needed.

This contradicts a goal of [League diagnostics](LEAGUE_DIAGNOSTICS.md#goals), `Nothing leaves the
machine`, for the one case where the user presses `Send`. It needs an ADR beside ADR-0034 and a
section on the privacy page before a release carries it. The rule the ADR records: a support
report leaves on a press, after the dialog showed its contents, and never otherwise.

`Save as file` and `Copy for Discord` work without the endpoint and ship first. The upload is a
later release of its own.

**Diagnostics off.** The `Anonymous diagnostics` switch does not gate an upload. An upload happens
on a press, after the preview, and the dialog says so in one line. No `support_report_created`
event is sent while the switch is off.

**The report list.** The service has a page that lists the reports of the last 30 days by top code,
verdict kind, app version and game patch. A maintainer sees a wave forming before users post
codes. The list stores those four fields beside each report and nothing else from it.

**A redaction miss.** A rule will miss a value one day. The response has three parts.

1. `config/redaction.json` in the repository holds extra patterns. Every install applies them
   without a release. A published pattern can only replace more text, never less
2. The service has a maintainer action that deletes, or redacts again, every stored report that
   matches a pattern
3. The pattern joins the built-in rules and the canary test in the next release

### The issue form

The form gains two fields, `Report code` and `Diagnostic token`. The `Report a Bug` URL sets
`diagnostic=` today, and the form has no field with that id. `LEAGUE_DIAGNOSTICS.md` describes
such a field as existing.

### The report reader

A maintainer opens `https://reports.leaguetoolkit.dev/r/<code>` and signs in with GitHub. The page
shows the summary, the advisories, the games, the incidents, the System checks and the mod list.
The log opens in a viewer that filters by level, by `session` and by `game`. The page also offers
the zip as a download.

The manager has no maintainer login. A saved zip is read by unpacking it, and `report.md` is the
first file to open.

## The contract with the patcher

The manager matches DLL phrases as text. A phrase renamed in `ltk-patcher` becomes a silent miss
in the manager. Four changes make the contract explicit.

1. **A code on every warn and error.** Each DLL and host record at warn or error starts with a
   code, `[LTK-<area><number>]`. The `[VRF0000000N]` codes are the existing example. The manager
   matches the code and ignores the text
2. **A lint in `ltk-patcher`.** CI fails on a `warn!` or `error!` without a code, and on a code
   without a row in the code table
3. **The code table travels with the DLL.** The delivery manifest carries the table for its build:
   the code, the advisory it maps to, the tier and an English sentence. A DLL delivered after a
   manager release raises advisories that the older manager can still word. An integrity code has
   no sentence
4. **A phrase test in the manager.** A fixture of real DLL output, taken from the `ltk-patcher`
   release, runs through the injector. A record that produces neither an event nor an advisory
   fails the test

`ltk-patcher` commits to the codes as a contract. The manager does not wait for them. It ships on
phrases for the rows of [The problem](#the-problem-measured), relies on `patcher-uncoded` for the
rest, and treats every unmatched record as an integrity record until a table gives it a tier.

**The host line buffer.** The DLL has no log file, and its lines are lost once the host exits. The
host exits when the manager closes. A bounded file of the last game's DLL records, written by the
host under the app data directory, lets the next start build the game record. This is the same
need as the startup reconcile in League diagnostics.

## Telemetry

Two additions, each with a row in [Telemetry](TELEMETRY.md) and a line on the privacy page before
it ships.

| Event or property        | Carries                                                                |
| ------------------------ | ---------------------------------------------------------------------- |
| `game_session_ended`     | `advisory_codes`, the codes of the game and its build, as a list       |
| `support_report_created` | The entry point, the route (`file`, `discord`, `upload`), the top code |

The first shows how often each "mod did not load" cause occurs across installs. The second shows
which failures users ask for help with. A cause that is frequent in the second and has no advisory
is the next advisory to write.

## Measures

The team reads these three months after the first release.

| Measure                                                                  | Source                                        | Today               | Target                     |
| ------------------------------------------------------------------------ | --------------------------------------------- | ------------------- | -------------------------- |
| Issues and help threads that carry a token, a file or a code             | A count by hand                               | About 1 in 4 issues | 3 in 4                     |
| Games with no live overlay and no advisory or verdict that names a cause | Telemetry                                     | Not measured        | Under 1 in 20              |
| Games that raise `patcher-uncoded`                                       | Telemetry                                     | Not measured        | Falls release over release |
| Private values found in a report                                         | The canary, and spot checks of stored reports | Not measured        | None                       |

The first two decide whether the work succeeded. The last two show whether it stays that way.

## Order of work

| Release | Holds                                                                                 | Needs            |
| ------- | ------------------------------------------------------------------------------------- | ---------------- |
| 1       | Log levels, default filter, panic and frontend errors in the log, route error screen  | Nothing          |
| 1       | Phrases for `overlay-refused` and `archive-not-served`, issue form fields             | Nothing          |
| 1       | `ltk-redact`, the redacted log writer, the rewrite of old logs, the canary test       | Nothing          |
| 1       | The support report, the dialog, `Save as file`, `Copy for Discord`, the entry points  | The redactor     |
| 1       | `--report`, the Start menu entry, the native startup dialog                           | The builders     |
| 1       | Known causes: the update, `config/known-issues.json`, the mod's page                  | The dialog       |
| 1       | `Details` on error toasts, the error reference                                        | Nothing          |
| 2       | Run, session and game ids, the game record, advisories, the session bar line          | Nothing          |
| 2       | Advisory muting, workshop projects as subjects, the unwatched game row                | Advisories       |
| 2       | The mod trace, both telemetry additions                                               | The game record  |
| 2       | Verbose patcher logging as the default                                                | The measurement  |
| 3       | The report list, `config/redaction.json`, the purge action                            | The upload       |
| 3       | The upload, the report code, the reader page                                          | An ADR, a Worker |
| 4       | Patcher codes, the tier column, the lint, the code table by delivery, the line buffer | `ltk-patcher`    |
| 4       | `mod-shadowed`, per-mod `overrides-unrouted`                                          | `ltk_overlay`    |

The first release holds the visibility fixes, the redaction and the report together. It answers
"users cannot get the log to us" and "the log is not redacted". The second release answers "the
user does not know the reason".

## Defects found while writing this

Each is separate from the proposal and can be fixed alone.

- A bulk install failure raises two error toasts (`useBulkInstallMods.ts:11`,
  `useLibraryActions.ts:93`)
- `stopPatcher` on a stopped patcher raises an error toast (`patcher/api/mutations.ts:41`)
- `dll_lines.rs` matches `game exit`, and the host sends `awaiting game exit`
- `LEAGUE_DIAGNOSTICS.md` lists three verdicts that record on a clean ending. `classify.rs` records
  nine
- `LEAGUE_DIAGNOSTICS.md` requires `E_INVALIDARG` for the texture verdict. `classify.rs:579` does
  not check it
- `LEAGUE_DIAGNOSTICS.md` describes the opted-out scan line as live. `OPT_OUT_AH` is commented out
  in `ltk-patcher`
- A mod whose library entry is unreadable is built into the overlay and is absent from the
  incident suspects (`pipeline.rs:349`)

## Decisions

The team answered these on 2026-11-12.

| Question                                         | Answer                                                                        |
| ------------------------------------------------ | ----------------------------------------------------------------------------- |
| Who reads an uploaded report?                    | Maintainers only. A saved zip is the user's file                              |
| Which channel is the report shaped for?          | Discord first. The GitHub issue form is the second action                     |
| Does the project run an upload endpoint?         | Yes, as a release of its own after the file export                            |
| How much does the app explain a patcher refusal? | Two tiers. An environment cause is explained, an integrity cause shows a code |
| Which side sets the tier of a code?              | The patcher's code table. No tier means integrity                             |
| When is the log redacted?                        | When written, in release builds, and again at export                          |
| What happens to log files from an older release? | The first start rewrites them through the redactor                            |
| Which facts about a replaced path are kept?      | Non-ASCII, length, drive letter and kind, cloud sync                          |
| Do mod names stay in a report?                   | Always, with no switch                                                        |
| Is a record kept for a clean game?               | Yes. The newest 20, read by the mod trace and the report, on no page          |
| Is `Advisory` a concept of its own?              | Yes, with a GLOSSARY entry, and it feeds incidents                            |
| How does an advisory reach the user?             | The session bar and the mod badge. No toast                                   |
| Does the manager wait for patcher codes?         | No. `ltk-patcher` commits to codes, and the manager ships on phrases          |
| What goes on the clipboard?                      | A summary under 1,500 characters, with the incident token                     |
| Which language is the summary in?                | English                                                                       |
| Is the user's description required?              | No. Three choices and a mod picker give the structure                         |
| Which mods does the report list?                 | The active profile, enabled first. Other profiles as a count                  |
| Is League's game log in the report?              | Yes when an incident exists, and the user can untick it                       |
| Does `Get help` replace `Report a Bug`?          | Yes                                                                           |
| Which error toasts carry `Get help`?             | The unexpected codes. Every error toast carries `Details`                     |
| What does the dialog do with a known cause?      | The fix is the primary action, and sending is under `Send anyway`             |
| How long does the service keep a report?         | 30 days                                                                       |
| How does a maintainer sign in?                   | GitHub login, limited to a LeagueToolkit team                                 |
| How is an upload admitted?                       | The delivery challenge, five a day for one install, no install id stored      |
| Where does a maintainer read a report?           | A web page of the reports service                                             |
| May telemetry gain the two additions?            | Yes, both                                                                     |
| What does the first release hold?                | The visibility fixes, the redaction and the report                            |
| Is verbose patcher logging the default?          | Yes, after the measurement                                                    |

The team closed these gaps on the same day.

| Question                                                 | Answer                                                                  |
| -------------------------------------------------------- | ----------------------------------------------------------------------- |
| How does a user report when the manager does not start?  | `--report`, a Start menu entry and a native dialog on a startup failure |
| What does the dialog do when an update is available?     | The update is a known cause, with `Update now` first                    |
| Can maintainers publish a known issue without a release? | Yes, in `config/known-issues.json`, matched by code and verdict kind    |
| Where does a problem in one mod go?                      | To the mod's page, from its recorded origin                             |
| Can a user silence an advisory?                          | Yes, per mod and code. A change to the mod clears it                    |
| Does a report hold a screenshot?                         | No. The dialog asks the user to attach one in chat                      |
| Is the user's own text redacted?                         | Yes, and the preview shows the result                                   |
| What does an unofficial build do?                        | It is marked on the first line, and it can save and not upload          |
| What is the plan for a redaction miss?                   | Published patterns, a purge action, then a built-in rule                |
| Can maintainers browse reports?                          | Yes, a list by code, verdict, version and game patch                    |
| What do Discord helpers get?                             | The pasted summary. No bot and no access                                |
| Does the diagnostics switch gate an upload?              | No                                                                      |
| Are workshop projects covered?                           | Yes, as advisory subjects, with the trace in the editor                 |
| What does a code newer than the manager read as?         | The delivered English sentence, until the next release                  |
| What does the trace say about an unwatched game?         | That the manager was not running, from one directory listing            |
| How is success judged?                                   | The four rows of Measures. The first two decide                         |

## Open questions

1. What does verbose patcher logging cost in a game? The decision makes it the default. Nobody has
   measured the records a game writes at that level or the time one record takes in the DLL.
2. Which LeagueToolkit team holds read access to the reports?
3. Who operates the reports service and answers a deletion request?
