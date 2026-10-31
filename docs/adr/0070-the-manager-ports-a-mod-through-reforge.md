# ADR-0070: The manager ports a mod through reforge

- **Status:** Proposed (2026-10-25). Open for comments, nothing is built.
- **Date:** 2026-10-25
- **Crates:** proposed: a new `ltk-manager-port` beside `ltk-manager-problems`, and `src-tauri`
  for the service. `ltk-manager-library` installs what a port writes and is not changed by it.
- **Related:** [ADR-0005](0005-a-repair-rewrites-the-archive-in-place.md),
  [ADR-0006](0006-a-repair-preserves-names-instead-of-keeping-a-restore-point.md),
  [ADR-0009](0009-a-health-check-requires-the-hashtables.md),
  [ADR-0011](0011-a-repair-may-lose-fidelity-where-no-in-place-edit-exists.md),
  [ADR-0012](0012-the-overlay-merges-a-mod-over-the-games-copy.md),
  [ADR-0025](0025-a-repair-reads-the-archive-where-it-lies.md),
  [ADR-0069](0069-the-data-location-is-one-folder-and-a-move-restarts-the-app.md),
  `docs/plans/mod-autofixer-gaps.md`. On the reforge side,
  [ADR-0046](https://github.com/LeagueToolkit/ltk-reforge/blob/master/docs/adr/0046-the-first-release-is-a-standalone-app-on-ltk-managers-stack.md),
  [ADR-0080](https://github.com/LeagueToolkit/ltk-reforge/blob/master/docs/adr/0080-the-install-answers-what-the-target-build-holds-and-the-index-what-builds-held.md),
  [ADR-0105](https://github.com/LeagueToolkit/ltk-reforge/blob/master/docs/adr/0105-a-package-is-also-written-as-a-layered-fantome-archive.md),
  [ADR-0106](https://github.com/LeagueToolkit/ltk-reforge/blob/master/docs/adr/0106-a-manager-page-reads-ltk-managers-library.md),
  [ADR-0109](https://github.com/LeagueToolkit/ltk-reforge/blob/master/docs/adr/0109-the-index-is-taken-forward-by-a-published-delta.md).

This record proposes one decision and compares the designs that could carry it. The questions it
leaves open are listed at the end, each with the record it becomes once this one is accepted.

## Context and problem statement

### What the manager does with a broken mod

Mod health runs the Problems rules over an installed mod and offers one press. Nine rules ship.
A repair is derived from the mod alone: a rule reads the mod's files and writes a corrected value
back, where the migration tables and the meta schema say what the current build reads
(ADR-0012, "Context"). The repair edits the archive where it lies (ADR-0025), replaces it in
place (ADR-0005), preserves every name it hashes (ADR-0006) and loses fidelity only where no
in-place edit exists (ADR-0011). Where a fix needs content only the installed game has, the
overlay merges the mod's chunk over the game's copy while it builds, and the mod on disk is
left as it is (ADR-0012).

`docs/plans/mod-autofixer-gaps.md` measured what that reaches. A `(class, field) -> (from,
to)` table covers a property that still exists under a hash that has not moved. It does not
cover a field Riot renamed, a field the mod omits, a struct that was split or nested, or a
file whose format moved. A mod made for a patch two years old carries all of these. The same
note walks a mod with the verdict `healthy` that crashes the game on one spell, because the one
rule applied every finding it could see.

The library also holds mods of a shape no rule addresses: a premium skin's content pasted into
the base slot, the author's skin bin copied to every slot of the champion, game files shipped
as they were at an older build. The overlay mounts all of it.

### What reforge is

ltk-reforge (`LeagueToolkit/ltk-reforge`, v0.5.0 on 2026-10-25, GPL-3.0-or-later) is a fixer
and a porter for champion skin mods. It takes one archive through nine stages, read, load, fix,
facts, decide, plan, build, check and write, and gives a package the current build reads. Two
programs run on the stages:

- A **repair** fixes the mod's files and values for the target build at the mod's own slots and
  paths, and writes whole bins.
- A **port** goes on from the fixed mod. It decides which game skin each unit of the mod was
  made for, puts the mod over that skin as a PTCH of the game's own bin, and ships the mod's
  own objects and files under a namespace of the mod's. Voice and HUD go to layers of their own.

Where the manager's rules see the mod against one install, reforge sees it against every build
the game shipped: a **history index**, a SQLite file of 757 builds and about 11 million objects,
which dates the mod, tells a stale copy of a game file from the author's own, and reads each
field's type at the mod's own build. Over a corpus of 4,909 champion skin mods it repairs 4,884,
and every edge case it declares has a test. The library has 80 integration test files and 109
decisions of its own.

reforge is a library with three callers: a command, a desktop app and, proposed, an AI agent.
The app is a standalone program on the manager's own stack, Tauri, React, `tauri-specta`, the
manager's theme and components copied (reforge ADR-0046). It already meets the manager at
three points:

- It reads the manager's shared caches as its own: the Mimir hash tables and the meta schema
  under the `LeagueToolkit` data folder, and updates both when asked (reforge ADR-0059).
- Its Manager page reads `library.json` and the mods' configs, read-only, lists the champion
  skin mods, finds premium pastes by a scan, and ports the ticked ones in a batch (reforge
  ADR-0106, ADR-0107).
- It writes a package the manager installs: a `.modpkg`, or a layered `.fantome` with the PTCH
  in its layer's `game_data.yaml`, which the manager's overlay applies as it applies a
  declaration (reforge ADR-0105). The default is the `.fantome`, named for the manager.

The question is whether a port belongs inside the manager, and if so what shape it takes.

### What reforge gives, and what a caller has to bring

| part                | state                                                                                                                                                       | reusable from the manager                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `reforge` crate     | `Porter`, `Repairer`, `Run`: one method per stage, a result after each, a report as data, a snapshot per stage, a cancel between steps, progress per step   | As a dependency. No Tauri, no I/O of its own beyond the store                   |
| `Env`               | The install, the names, the schema, the history, built once                                                                                                 | The manager opens the same game dir, the same Mimir cache, the same schema file |
| History index       | Downloaded prebuilt, 1.73 GB, 4.77 GB on disk, taken forward by a published delta of about 220 MB per snapshot (reforge ADR-0109)                           | Nothing in the manager. The whole input is new                                  |
| Package writers     | Project directory, `.modpkg`, layered `.fantome`, each with the run's evidence and report embedded                                                          | `install_mod_from_package` takes the file as it takes any archive               |
| Checks              | The patches applied as the manager's overlay applies them, types, a round trip, links                                                                       | As part of a run                                                                |
| `reforge-app` crate | Inputs opened and shared, the download with resume, the index install and delta, the app's store of runs, the batch, every run view, the generated bindings | Bound to its Tauri states. Copied and adapted, not depended on                  |
| `reforge-census`    | Reads the census history with gix, builds and appends the index                                                                                             | Not needed with deltas. Maintainers' path                                       |
| `reforge-testkit`   | Fake games, archives, bins, schemas and histories                                                                                                           | As a dev-dependency of the manager's driver tests                               |

The app crate is 14,700 lines of Rust and 24,400 of TypeScript. The library and its sibling
crates are the rest of a 130,000-line workspace, tests included.

### Where the two programs differ in what they are willing to pay

Each row names a choice reforge made and the choice the manager makes in the same place.
Neither column is wrong. The point is that a port inside the manager puts both in one program.

| question                   | the manager                                                                                                   | reforge                                                                                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What a fix is derived from | The mod alone, plus tables and a schema shipped or cached. No fix needs the install (ADR-0012, "Context")     | The mod against the target install, required (reforge ADR-0080), and against every build of the history                                                                                                                |
| What a repair writes       | The same archive, edited in place, every name preserved. The mod stays the author's file (ADR-0005, ADR-0006) | A new package built from reforge's own representation. A file nothing names is left out, bins are written back field by field, textures move into TEX's container, banks are cut, objects are renamed into a namespace |
| Fidelity                   | In-place first, the smallest change, refuse rather than approximate (ADR-0011)                                | Every loaded object is fixed, and a value no build since the mod's own read is removed. The pixels of a texture are kept, the container is not                                                                         |
| Content the mod lacks      | Merged from the game's copy at every overlay build, nothing written, recomputed each build (ADR-0012)         | Written as a PTCH over the game's bin. Travels with the package to any manager that applies a layer's declarations, and is bound to the build it was made against                                                      |
| Hash tables                | No check or repair runs without them. A verdict must never be wrong (ADR-0009)                                | A run with no tables runs and names less. A chunk no table spells ships under its hash                                                                                                                                 |
| Disk and network           | Hash tables of 65 MB and a schema of 4 MB, kept in the shared cache                                           | The same two, plus the history index: 1.73 GB downloaded once, 4.77 GB kept, a delta per snapshot                                                                                                                      |
| Time per mod               | A check of an archive mod in about 200 ms (ADR-0025). A repair costs what it changes                          | A run of 2.4 s at the median over the corpus and up to 45 s. A scan took 29 s and a port 22 s on one machine, so a batch runs in parallel (reforge ADR-0108)                                                           |
| What a user is told        | Three words, `healthy`, `repairable`, `unrepairable`, and one press. Severity rides in the counts             | Over a hundred diagnostic codes, each with a record, a severity and a stage. A finding does not stop the write unless the caller's policy blocks on it. Not every mod is ported                                        |
| Rules                      | Nine Rust rules that subscribe to one pass. The migration table is data                                       | Fixups as objects that name their records, table rules as data, a selection saved as JSON, and a change recorded with its value before and after                                                                       |
| Untrusted input            | A Fantome unpacks into a project under its own names (ADR-0001). A check reads the archive where it lies      | No archive is extracted to disk. Bytes live in a blob store by content id, every foreign parser runs under a panic guard, and every read is capped                                                                     |
| Scope                      | Every mod the library holds: champions, maps, UI, audio, built-in mods                                        | Champion skin mods alone (reforge ADR-0033). A map, a UI pack or a restoration ends with a finding and no package                                                                                                      |
| Evidence                   | A verdict in `mod-health-verdicts.json`, a cache of a computation                                             | The run's evidence and its whole report embedded in the package, so a later run reads them instead of judging again                                                                                                    |

Two of these rows carry most of the weight. The install dependency inverts a promise the manager
makes: "a repair is never applied for a game patch the user is not on yet" holds because the
manager's repair does not look at the install, where a port is a statement about one build. And
the output row means a port is not a repair in the manager's vocabulary: it writes a second
artifact, and what happens to the first is a decision this record does not take.

## Options considered

The effort figures are rough. They assume one person who knows both codebases, and they count
what lands in the manager, not changes to reforge.

### A. Nothing in the manager, a handoff to the reforge app

The reforge app already reads the library and ports it. The manager links to it: a card action
"Port in reforge" that opens the app, or a page in Settings that names it. If reforge adds a
setting to write its packages into the manager's drop folder, `<storage>/archives/`, the next
reconcile installs them and the manager changes nothing.

- Effort: days. The drop-folder half is a setting on the reforge side.
- Cost: a second program to install and update, with its own 4.77 GB. The manager cannot say
  which of its mods a port would help, and a user who never opens reforge never learns it
  exists.

### B. The reforge command as a sidecar

The manager bundles the `reforge` command as it bundles `cslol-host.exe`, drives it over a
process boundary, and reads the report JSON it writes. The manager owns the inputs' paths and
the output folder, installs the package, and shows the findings.

- Effort: two to four weeks. The protocol is the command's arguments and its report file, which
  exist. The download of the index, the settings and the result view are the same work as C.
- Gain over C: a run that aborts on allocation takes down a child, not the manager. Memory of a
  batch is the child's. No dependency alignment.
- Cost: two copies of the ltk crates and of the inputs' opening on one machine, a version skew
  between the bundled command and the manager's reading of its report, and no progress inside a
  run beyond what the command prints. The reforge command is not built for a machine protocol
  and has no event stream.

### C. The `reforge` crate as a dependency, driven in process

A new crate `ltk-manager-port` depends on `reforge` and owns the inputs: the install from the
manager's game dir, the names from the shared Mimir cache, the schema from the shared file, the
history index from a folder the manager manages. A `port` service runs one `Porter` off the
window thread with a cancel and progress events, writes the package to staging, and the library
installs it as it installs any archive. The first slice is one action on a champion skin mod's
card with reforge's default settings, a progress line, and a result that lists the findings and
each unit's target. Everything beyond that, the guided view, a batch over the library, a kept
run to rerun from, stays in the reforge app.

- Effort for the first slice: four to eight weeks, in these parts:
  - the history index: the download with resume, the unpack with a 2 GiB window, the delta,
    the folder under the data location (ADR-0069's entry list), the check for a newer snapshot,
    and a setting that opts into 4.77 GB. The reforge app's `download`, `index` and `census`
    modules are the model. The largest part, one to two weeks.
  - the inputs and the driver: `Env` from the manager's paths, a reopen after a hashtable sync,
    the run on a thread, cancel, progress, a package to staging, the install. One week.
  - the service and the bindings: a Tauri plugin on `tauri-specta`, the report's parts the
    result view reads as `specta::Type`, which `reforge`'s types do not derive. One week.
  - the surface: a card action gated on the `champion-skin` tag of the WAD report, a progress
    line, a result panel, the setting, the messages, the error copy. One to two weeks.
  - dependency alignment: `ltk_mod_project` 0.17 against the manager's 0.16, `ltk_fantome` 0.16
    against 0.15, `ltk_hashdb` from a git revision against crates.io 0.1, `windows-sys` 0.61
    against 0.59, Rust edition 2024 beside 2021. Cargo builds two copies where the majors differ,
    which costs build time and binary size until the pins meet. A `reforge` release on crates.io
    or a git pin by revision, as `ritoclient` is pinned. Days, plus `pnpm generate:licenses`.
  - tests: the driver against `reforge-testkit`'s fake games and archives. Days.
- Gain: one program, one copy of every input, progress per step, a port the manager can offer
  where its health check finds nothing to repair.
- Cost: the manager's binary grows by reforge and `rusqlite` with SQLite bundled. A run's memory
  is the manager's. The manager's release cadence binds reforge's library version.

### D. The reforge app folded into the manager

Every page of the reforge app becomes a page of the manager: the run page with its simple,
guided and advanced views, the Runs page over a store of kept runs, the Batch and Manager pages,
the History and Records pages.

- Effort: three to six months, and the work is largely a second copy of a program that exists.
- Cost: reforge ADR-0046 made the app standalone so that `reforge` stays free of a UI and the
  app can release on its own. Folding it in undoes that for both repositories.

## Decision

**Proposed: the manager ports a mod through `reforge` as an in-process library caller (option
C), in a first slice that offers one action with reforge's defaults and installs what it writes.**

With these bounds:

- **A port is not a repair.** It writes no byte into the installed mod. ADR-0005, ADR-0006 and
  ADR-0011 are not engaged, and the health verdict words are not reused for it. The package a
  port writes enters the library as a mod of its own through the install path, and what happens
  to the mod it was made from is open question 1.
- **The manager holds no rule about a mod, and reforge holds no rule of the manager's.** The
  manager chooses the inputs, the settings and where the package lands. Which skin a unit is
  for, what is stale and what is carried are reforge's decisions, with their records. This is
  the mirror of reforge ADR-0046.
- **The history index is optional and opted into.** A port without it is judged against the
  install alone, and the result says what was judged with less. Nothing downloads unasked.
- **The hash tables precondition of ADR-0009 applies to a port** as it applies to a repair: a
  port is offered only when the cache is ready. A chunk no table spells shipping under its hash
  is a result a user cannot read, and the port's patch cannot name a field no table spells.
- **The action is offered on champion skin mods alone**, read off the `champion-skin` tag the
  WAD report already derives. Other mods never see it.
- **The reforge app stays the advanced tool.** A result in the manager links to it for the
  guided view, a rerun with other settings, and a batch. The manager's slice does not grow a
  second run page.

## Consequences

- **Positive:** a mod the health check calls `unrepairable`, or `healthy` and still broken, gets a
  path that reaches a renamed field, a nested struct, a pasted premium skin and a stale game
  file, judged against the game's own history.
- **Positive:** one copy of the hash tables, the schema and the game dir, opened by the program
  that already keeps them current.
- **Positive:** the port's PTCH is the "shipped patch record" ADR-0012 named as the other half
  of the merge, and the overlay applies it with the same semantics it already has.
- **Negative:** 4.77 GB on disk for the full result, on a machine where the manager's data is
  already several gigabytes (ADR-0069). The data location move gains an entry.
- **Negative:** a port is bound to the build it was made against. The next game patch can make
  its patch stale where a merge recomputes itself, and nothing in this slice reruns it.
- **Negative:** the manager's release pins a library whose format and rules change with
  every patch's game changes. A reforge fixup added for a new build reaches manager users at the
  manager's next release, not reforge's.
- **Negative:** the manager's binary and build time grow by the dependency and its SQLite.
- **Neutral:** `GLOSSARY.md` gains the words a port needs, `port`, `unit`, `target`, `history
index`, with reforge's definitions, and `repair` gains the sentence that a port is not one.
- **Neutral:** `bin/base-skin-copy` and `bin/property-type` overlap reforge's facts and fixups.
  Both stay. Which program a check belongs to is not reopened here.

## Open questions

Each is a decision of its own. The ones marked **ADR** become a record when this one is
accepted. The rest are settled in the implementation or the UX spec.

1. **ADR. Where the package lands.** A new library entry beside the original, with the original
   disabled. Or the original's archive replaced in place as ADR-0005 replaces a repaired one,
   which makes a port look like a repair to every surface. Or an update of the same entry where
   `install_mod_from_package` recognises the project. A port renames the mod's objects into
   `<name>.<author>`, so its project name may not match the original's.
2. **ADR. Which format the library takes.** reforge writes the layered `.fantome` for the
   manager by default, and a `.modpkg` on request. A `.fantome` whose PTCH applies in the manager
   and league-mod alone looks like a plain Fantome to a user who copies it to cslol. A `.modpkg`
   says what it is and has no unpacked form in the library.
3. **ADR. Where the history index lives.** The manager's data location, which a move carries
   (ADR-0069), or the shared `LeagueToolkit` folder beside `hashes` and `meta`, so the reforge
   app and the manager hold one copy. The second needs a reforge decision too, since its app
   keeps the index in its own data folder.
4. **ADR. Dependency form.** A `reforge` release on crates.io, or a git pin by revision as
   `ritoclient` is. Who cuts a release, and how the manager's version and the reforge app's
   version are kept from disagreeing about a package's embedded report.
5. **In process or a sidecar (B against C).** reforge guards every foreign parser's panic, and a
   failed allocation still aborts the process. Whether a port in the manager's process is
   acceptable, or the first slice spawns the command and reads its report.
6. **How a port meets the verdict.** ADR-0009 rejected a fourth verdict word. Whether "portable"
   is a badge, a line in the popover, or nothing, with the action in the card menu alone.
7. **Which settings reach the manager.** None, with reforge's defaults. Or the target policy,
   the animation reuse and the output format. Or a handoff to the reforge app for anything past
   the defaults.
8. **Patch day.** A port is judged against one build. Whether the health sweep's basis, which
   moves with the game build, marks a ported mod as due for a rerun, and who runs it.
9. **A batch.** "Port all" over the library exists in the reforge app. Whether the manager
   offers one, and whether reforge's Manager page is retired once the manager ports.
10. **A shared schema crate.** Both programs read `meta-schema.json` with a reader of their own.
    reforge's roadmap lists a shared crate with the manager. Whether it comes before this work,
    so that one type crosses, or after.
11. **The overlap of checks.** reforge's facts find a premium paste with the mesh, the skeleton,
    the texture, the names and the clips against every skin of the history. The manager's
    `bin/base-skin-copy` sees a byte copy. Whether a manager check should ever call reforge's
    facts stage, which runs in seconds, not milliseconds.
