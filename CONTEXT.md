# Domain glossary

The words this codebase uses for its own concepts, and the ones it deliberately does not. Coding
conventions live in the per-directory `CLAUDE.md` files. Decisions live in `docs/adr/`.

## The library

**Mod library** — everything a user has installed, under one **storage directory** (`modStoragePath`
in settings, the app data directory by default). Distinct from the **Creator Workshop**, where a
user authors mods rather than installs them.

**Library index** — `<storage>/library.json`, the single document holding every mod entry, profile
and folder. Every read and write goes through the index lock, because each write rewrites the whole
file.

**Mod entry** — one row of the index: an id, an installed-at timestamp, the format it arrived as,
where its content is stored, its slug, and its fault if it has one. It is the only record of which
mod is which — see ADR-0002.

**Drop folder** — `<storage>/archives/`. Somewhere a user can drop a `.fantome` or `.modpkg` and
have it installed on the next reconcile. Since the layout migration it is _only_ that: installed
archives no longer live there.

## A mod on disk

**Mod project** — the on-disk layout a mod is stored in: `mod.config.json` plus a `content/<layer>/`
tree. The same layout the Creator Workshop authors in, and the one `ltk_overlay`'s `FsModContent`
reads. A fantome installed now is one. A modpkg is not, and neither is a mod the layout migration
moved — see ADR-0001 and ADR-0003.

**Import** — turning a packaged mod into a mod project directory, whatever it arrived as. One driver
serves every surface, `ltk_mod_project`'s `ProjectImporter`: it owns the output directory, a
directory for every layer the config declares and the config write, leaving a per-format backend to
decode. `FantomeImporter` and `ModpkgImporter` are those backends, so the library's install and
unpack paths and the Creator Workshop's two import dialogs are four call sites over one
implementation. `RAW/` routing, case-insensitive `WAD/` matching and reading past a bad CRC32 live
inside the fantome backend, so a second importer beside it is a second copy of those bugs — the
workshop had one per format until they were collapsed onto this.

**Slug** — a mod's directory name under `<storage>/mods/`, derived from the project's `name` (never
its `display_name`), assigned once at install and never re-derived. **Id** is the mod's identity, a
UUID, and it is what profiles, folders and reports refer to. Two mods can want the same slug; the
second gets a numeric suffix.

**Preserve** — the import step that reads the names a fantome's own files still hold and embeds
the ones the community hashtables cannot recover into the archive copy, per the Embedded
Hashtables standard. The **harvest** is what that step found, recorded on the entry as
`HarvestSummary`: how many names the archive gained, and how many chunks arrived with no
recoverable name at all (`unharvestable` — what tells a mod that preserved cleanly from one that
was already lossy).

**Mod archive** — `mods/<slug>.fantome` or `mods/<slug>.modpkg`, the file the mod arrived as,
beside its directory. Its role follows storage. For a mod stored `archive` it is the mod — the
content provider reads from it — and a modpkg, which only ever has that storage, therefore
always has one. For a fantome stored `project` it is optional: kept when the `retainModArchives`
setting is on, and always kept when the preserve rewrote it — the standard has the project carry
its tables in `hashes/`, but until the importer writes them there, the rewritten archive is the
embedded names' only record.

**Storage** — where a mod's content is: `project` for the unpacked tree, `archive` for a mod read
out of the file beside it. Recorded on the entry rather than derived, and the two coexist per mod: a
fantome installed now is `project`, and one the layout migration moved is `archive` (ADR-0003).

**Unpack** and **repack** — moving one mod between the two storage modes, from its card in the
library. Both need the archive still beside the mod, and neither is offered for a modpkg, which has
no unpacked form. See ADR-0004.

**Staging directory** — `mods/.staging-<uuid>/`, where an install or a conversion assembles a mod
before it is renamed into place, with `mods/.staging-<uuid>.<ext>` beside it for the archive copy.
Swept at startup, and only there: staging runs outside the index lock, so a sweep at any other
moment could delete a directory an install is still filling.

**Quarantine** — `<storage>/quarantine/<id>/`, where a failed conversion's original files are parked
along with a `quarantine.json` saying what went wrong.

**Fault** — the state of a mod that is in the library but unusable. It keeps its index entry and its
place in every profile, renders greyed out with its reason, and is excluded from overlay builds.

## Mod health

**Check** — one pass of the Problems rules over an installed mod's content, summarized for a mod
user. It reads and never writes: an `archive`-storage mod is unpacked into staging just to be
read. A modder's view of the same rules is the Problems panel, and the split is deliberate — see
`docs/ux/MOD_HEALTH.md`.

**Verdict** — what a check concluded: `healthy`, `repairable`, or `unrepairable`, with the counts
behind it. Remembered per mod in `mod-health-verdicts.json` beside the index. A cache of a
computation, not a record — a lost file refills on the next check.

**Basis** — what a check was a claim about: the installed game build, and the manager version the
rules and their tables shipped in. Recorded on every verdict, and comparing it is how the health
sweep decides which verdicts are stale.

**Health sweep** — the startup pass that re-checks every mod whose basis moved, and forgets the
verdicts of mods the library no longer holds. Not the **staging sweep**, which is the same word
for clearing `mods/.staging-*` and is unrelated. What it found draws as a banner above the
library.

**Repair** — applying every fix the live rules derive for one mod. In the tree for a `project`
mod, with a restore point. For an `archive` mod: unpack, fix, repack, and the repaired archive
takes the original's place — see ADR-0005. **Repair all** is the banner's one press over every
repairable mod at once, and nothing is ever repaired without it.

## The three migrations

Three different things, and the words do not overlap:

**Layout migration** — the one-time pass that moves every mod off the uuid layout and onto its slug.
Two renames per mod and no unpack (ADR-0003), so it runs unasked at startup, ahead of the first
reconcile. A toast reports it while it runs, and a dialog lists whatever it could not move.

**Schema migration** — versioning of `library.json` itself (`v0 → v1 → v2`). Runs on load, backs the
old file up first, and never touches anything on disk outside that one document.

**Cslol import** — bringing in mods from a cslol-manager installation. An _import_, not a migration,
whatever the surrounding code is still called.

## The overlay

**Content provider** — how the overlay builder reads a mod's files, chosen by the mod's **storage**
and never by its provenance: an unpacked mod project through `FsModContent`, a modpkg through
`ModpkgContent`, and a fantome whose content is still inside its archive through `FantomeContent`.
A mod entry's `format` records where it came from and only picks between the two packed readers.

**Layer** — a named slice of a mod's content that a profile can turn on independently. `base` is
always on.

**Profile** — a named set of enabled mods, their order, and their per-mod layer states. The active
profile is what the overlay is built from.
