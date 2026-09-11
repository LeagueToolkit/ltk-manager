# `Game.db` is a per-asset content index, and not a replacement for the game index

Research note, and the record of what was decided from it. Sections 1 to 5 are evidence measured
on 2026-09-03 against the live install at build `16.17.8104348` (`en_US`, per
`Game\content-metadata.json`). Sections 6 to 8 are the verdict and what follows from it.

The question was whether `Game.db`, the patcher's local chunk index, can serve as a precomputed
global index for the app, and what else it makes possible.

Three findings decide the rest:

- **It cannot replace [`GameIndex`](../../crates/ltk-manager-core/src/game_index.rs), and cannot
  speed its build.** The database holds byte ranges, not asset paths. Getting from a chunk row to
  an asset requires the WAD's own table of contents, which is the read `GameIndex::build` already
  performs, so nothing is saved.
- **Its chunk boundaries align exactly with WAD entry boundaries, measured across three
  archives with zero exceptions.** In the two base archives 94 and 99 percent of entries occupy
  exactly one chunk, so `chunks.id` is a content hash of one asset's compressed bytes, computed by
  Riot and sitting on disk. A locale archive, whose entries are far larger, needs the id sequence
  instead.
- **That hash is content-only.** Forty pairs of the same id in different files at different
  offsets were byte-identical, 40 of 40. Chunks whose id appears in more than one file hold
  7,477,895,495 of the install's 31,043,319,244 bytes, 24.1 percent, and are real content rather
  than padding.

The value is therefore not indexing. It is the three things the app cannot do today: tell whether
two copies of an asset are byte-identical, tell which assets a patch changed, and tell whether
anything has written into the install.

## Sources

Primary, in order of weight:

- The live databases themselves, queried read-only from scratch copies. `Game.db` and
  `league_of_legends.live.db`, copied to the scratchpad and opened
  `file:...?mode=ro&immutable=1`
- The install on disk: `C:\Riot Games\League of Legends\Game\`, read but never written
- `crates/ltk-manager-core/src/game_index.rs` - the app's own global index
- `crates/ltk-manager-core/src/game_wads.rs` - `GameArchives`, what the build walks
- `ltk_overlay` 0.9.7 `src/game_index.rs` - the second index, its disk cache and its game
  fingerprint
- `crates/ltk-manager-core/src/mods/analysis/wad_reports.rs` - where a game fingerprint decides a
  cached report is stale
- `crates/ltk-manager-core/src/overlay/artifacts.rs` - what the overlay keys its reuse on
- [ADR-0012](../adr/0012-the-overlay-merges-a-mod-over-the-games-copy.md) - why vanilla asset bytes
  are load-bearing
- [SQLite, WAL mode](https://www.sqlite.org/wal.html) and
  [URI filenames](https://www.sqlite.org/uri.html) - the read-only access question in section 5

Reproduction scripts, left in the session scratchpad:

```
scratchpad
|-- dbs
|   |-- Game.db                     copy of the live database
|   |-- Game.manifest
|   |-- league_of_legends.live.db
|   |-- league_of_legends.live.manifest
|-- inspect_db.py                   pragmas, row counts, one file's rows
|-- wad_boundary_check.py           section 2, the boundary test
|-- vanilla_tripwire.py             section 4, rows against disk
|-- shared_chunk_bytes.py           section 3, same id in two files
```

## 1. What the database holds, on this machine

Every number here is `measured`, not read from any prior account.

| property                | value                                           |
| ----------------------- | ----------------------------------------------- |
| size                    | 32,276,480 bytes                                |
| `PRAGMA application_id` | 1414482258 = `0x544F4952`, `RIOT` little-endian |
| `PRAGMA user_version`   | 3                                               |
| `PRAGMA page_size`      | 4096                                            |
| `PRAGMA journal_mode`   | `wal`                                           |
| `files` rows            | 402                                             |
| `chunks` rows           | 1,075,012                                       |
| distinct `chunks.id`    | 461,412                                         |
| `SUM(files.size)`       | 31,043,319,244 bytes                            |

The chunker type per file, `SELECT type, COUNT(*) FROM files GROUP BY type`, is 3 rows of type 0
(the metadata jsons), 392 of type 2 (WAD) and 7 of type 3 (PE). The three chunking-parameter sets
are `(4, 16384, 65536, 8388608)` for 10 files, `(4, 62500, 250000, 8388608)` for 210, and
`(4, 250000, 1000000, 8388608)` for 182. Both match the documented schema exactly, so that account
is taken as sound for the parts not re-derived here.

Two of its claims were **not** re-verified, and nothing below rests on either: that
`path_id` is `XXH64` of the path text, and that the row-to-manifest correspondence holds 402 of 402. Reading `path_id` back out of `files` costs nothing, so the app would never need to compute
it.

## 2. The decisive test: chunk boundaries against WAD entry boundaries

The schema says nothing about whether the database's byte ranges mean anything at the asset level.
The WAD chunker's emission rules say they should: it emits the header and table of contents as one
region, then walks the entries sorted by `dataOffset` and hands each entry's byte range to the
plain CDC chunker as its own call, with a sparse chunker over the gaps.

If that holds on shipped data, every entry boundary is also a chunk boundary, and no chunk can
straddle two assets.

`wad_boundary_check.py` parses the WAD header and table of contents, reproduces those emission
rules including the zero-size skip and the `(dataOffset, compressedSize)` duplicate
collapse, then compares against `SELECT offset, size, id FROM chunks WHERE path_id=? ORDER BY
offset`. Three archives, chosen as a base champion WAD, a locale WAD and the largest archive in
the install:

|                                       | `Aatrox.wad.client` | `Aatrox.en_US.wad.client` | `Global.wad.client` |
| ------------------------------------- | ------------------- | ------------------------- | ------------------- |
| file size                             | 110,288,615         | 99,981,071                | 1,004,749,648       |
| WAD version                           | 3.4                 | 3.4                       | 3.4                 |
| table-of-contents rows                | 2,646               | 18                        | 65,498              |
| entry regions emitted                 | 2,031               | 18                        | 50,069              |
| gap regions                           | 611                 | 5                         | 14,106              |
| `chunks` rows                         | 4,271               | 162                       | 71,304              |
| rows tile the file exactly            | yes                 | yes                       | yes                 |
| entries covered by exactly 1 chunk    | 1,911               | 12                        | 49,428              |
| entries covered by more than 1        | 120                 | 6                         | 641                 |
| **chunks crossing an entry boundary** | **0**               | **0**                     | **0**               |
| start or end mismatches               | 0                   | 0                         | 0                   |

The header-plus-table region ends exactly on a chunk boundary in all three: one chunk ending at
84,944 for `Aatrox`, one ending at 848 for the locale WAD, eight chunks ending at 2,096,208 for
`Global`.

So the alignment is real on shipped data, not only in the emission rules. An entry maps to a
contiguous run of chunk rows, one row for 94 percent of `Aatrox`'s entries and 98.7 percent of
`Global`'s, and the multi-chunk cases are simply large assets that CDC split further inside their
own region.

The locale WAD is the shape to keep in mind: 18 entries, but 162 chunk rows, because its handful of
very large entries are each split into 15 to 25 chunks. Its parameter set has a one-megabyte
target. Per-entry identity there is a chunk-id _sequence_, not a single id.

## 3. What the ids are, therefore

For a single-chunk entry the chunk covers exactly the entry's compressed byte range, so its id is a
pure function of that asset's bytes. The version-4 chunk id is the first eight bytes of a BLAKE3
digest. Nothing in the app would ever compute one, only
compare Riot's.

That is only useful if the id is independent of where the bytes lie. `shared_chunk_bytes.py` takes
ids occurring in two different files at two different offsets and compares the actual bytes on
disk:

```
pairs compared: 40, byte-identical: 40, differing: 0
example: id 6bfa24d8a1c0dd27, 8388608 bytes
  DATA/FINAL/Champions/Mordekaiser.en_US.wad.client @ 36478935
  DATA/FINAL/Champions/Ekko.wad.client @ 94877267
```

Content-only, confirmed. The scale of the sharing:

```sql
SELECT id, COUNT(*) c, COUNT(DISTINCT path_id) f FROM chunks GROUP BY id;
```

gives 461,412 distinct ids over 1,075,012 rows. 71,138 ids occur more than once and 70,472 occur in
more than one file. Summing the sizes of rows whose id crosses files gives 7,477,895,495 bytes of
31,043,319,244, or 24.1 percent of the install.

A random sample of 200 cross-file shared chunks was read off disk to rule out the obvious
deflation, that the sharing is all zero padding. 197 of 200 hold real content, median chunk size
10,313 bytes. The duplication is genuine.

## 4. The vanilla tripwire

`files` carries `size` and a Windows `FILETIME` `timestamp` per row. `vanilla_tripwire.py` stats
every row against disk and walks `Game\` for anything unaccounted:

```
rows: 402, read in 0.0005s
stat of all rows: 0.011s
matching size+mtime: 402
missing on disk: 0
size drift: 0
mtime drift only: 0
files under Game\ with no row: 1 ['imgui.ini']
```

A clean install answers in 11 milliseconds, and the single unaccounted file is a runtime artifact
rather than an installed one. This is a **vanilla** comparison, which is the part the app has no
equivalent of: `ltk_overlay`'s game fingerprint (`calculate_game_fingerprint`, from WAD sizes and
modification times) detects that the install _moved since the last run_, and cannot distinguish a
Riot patch from another tool writing into `Game\`.

## 5. What reading it would cost

Query timings on the copy, warm:

| operation                              | time   |
| -------------------------------------- | ------ |
| full `files` read, 402 rows            | 0.5 ms |
| `COUNT(*) FROM chunks WHERE path_id=?` | 0.3 ms |
| `GROUP BY id` over all 1,075,012 rows  | 0.64 s |

The database is 32 MB and the per-file lookups are index hits on the `(path_id, offset)` primary
key, so nothing here is a cost worth designing around.

The real cost is the dependency. `Cargo.lock` has no `rusqlite`, no `libsqlite3-sys` and no `sqlx`
today, so any of this means a new native dependency and a C compile in the build.

The access mode needs care. The database is `journal_mode=wal`. Per
[SQLite's WAL documentation](https://www.sqlite.org/wal.html), a WAL reader needs write access to
the shared-memory `-shm` file, so a genuinely read-only open of a live WAL database fails unless
`immutable=1` is set, and [the URI documentation](https://www.sqlite.org/uri.html) states that
`immutable=1` on a file another process may be changing yields undefined results. Copying the
database and its `-wal`/`-shm` siblings before reading, which is what every measurement here did,
is the pattern that avoids both horns.

## 6. Verdict

**As a replacement for `GameIndex`, no, and not as an accelerator either.**

`GameIndex` is keyed by WAD path hash and answers "what assets exist, under what path, in which
archive" (`game_index.rs:279`). `Game.db` contains no path hashes and no asset paths. Recovering an
asset from a chunk row needs the archive's own table of contents, which is precisely what
`GameArchives::for_each_chunk` already reads during the build, and the payload bytes are never
touched by either. The database removes no work from that build. Its own doc comment is accurate
about where the seconds go, and none of them are anywhere `Game.db` can reach.

Incremental invalidation is no better an argument. A stat of 392 archives costs 11 milliseconds,
measured in section 4, and `ltk_overlay` already caches its index behind exactly that check.

**As a precomputed per-asset content index, yes, and it is the only source of one.** Sections 2 and
3 establish that the install ships a Riot-computed content hash per asset, comparable across the
whole install, free of any hashing on the app's part.

## 7. What it opens

Ranked by payoff over cost. Each states the mechanism and what has to hold.

### Byte-identical asset detection across archives

Neither index can tell whether two copies of an asset are the same bytes. `GameIndex` dedups by
path hash and keeps the first archive, and says so: its `wad` field "names the archive that copy
came from and not every archive that carries it". `ltk_overlay`'s `find_wads_with_hash` returns
every archive carrying a path hash, which is what lets one mod override be distributed across
archives, and it too is blind to whether those copies agree.

Joining each archive's table of contents against its chunk rows gives the answer directly: equal
id sequence means equal bytes. Requires the alignment of section 2, which holds, and a
toc-to-chunk join at index-build time. It also finds duplication _between different paths_, which
nothing in the app can currently see at all.

### Which assets a patch changed

Snapshotting the per-entry chunk-id sequences at one build and comparing at the next names exactly
the assets Riot changed, with no second install, no download and no hashing. The app cannot
produce this today at any price, and it is the material for telling a user which of their mods a
patch actually disturbed rather than invalidating every cached report on a fingerprint move
(`wad_reports.rs:223`).

Requires the app to keep its own snapshot, because the database only ever describes the current
build. The snapshot is small: one id sequence per entry.

### Vanilla drift detection

Section 4, at 11 milliseconds. Distinguishes "the game was patched" from "something wrote into the
install", which is a real diagnostic the Problems surface has no input for today.

Requires that the app never writes into `Game\` itself, which ADR-0012 keeps true: the overlay
merges a mod over the game's copy into its own output rather than editing the install.

### Not worth doing

Computing `ltk_overlay`'s game fingerprint from the database rather than from stats. It replaces an
11-millisecond walk with a 0.5-millisecond query and adds a dependency on Riot's bookkeeping to a
path that works. Likewise reading the shipped file list from `files` instead of walking
`DATA/FINAL`.

The three above share one integration and one dependency. Taken together they justify it. The
tripwire alone does not.

## 8. Risks

- **Presence is not guaranteed.** Verified here only on one live install plus the
  `league_of_legends.live` product database. PBE is claimed elsewhere and untested here.
  Garena and other region clients, partial installs, and any install mid-patch are all unverified.
  Every path must treat absence as ordinary and fall back to what the app does today.
- **The patcher does not trust it either.** Every local chunk is re-hashed before reuse, and a
  stale row costs a download rather than corruption. A
  feature built on these ids inherits that: they are a fast path, never an authority.
- **Staleness has no signal.** The rows describe the last patch or repair. A third-party tool
  writing into `Game\` invalidates them silently, which is the same fact the tripwire exploits and
  the reason nothing else may assume freshness without checking size and mtime first.
- **The schema is already moving.** `user_version` is 3 here, and `rpatch.dll` already carries a
  twelve-column `files` with the manifest's own file id. Read defensively, check `user_version`,
  degrade rather than fail on a shape that does not match.
- **WAL concurrency.** Copy before reading. Never open the live file for write, and
  never hold a reader across a patch.
- **Anti-cheat.** Everything here is an ordinary read of files the user owns, with no injection and
  no write, and the app writing nothing into `Game\` is what keeps it that way. Vanguard's view of
  a process reading the install was not examined and is not something this note can answer.
