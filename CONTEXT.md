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
where its content is stored, and its slug once the layout migration has assigned one. It is the
only record of which mod is which — see ADR-0002.

**Drop folder** — `<storage>/archives/`. Somewhere a user can drop a `.fantome` or `.modpkg` and
have it installed on the next reconcile. Since the layout migration it is _only_ that: installed
archives no longer live there.

## A mod on disk

**Mod project** — the on-disk layout a mod is stored in: `mod.config.json` plus a `content/<layer>/`
tree. The same layout the Creator Workshop authors in, and the one `ltk_overlay`'s `FsModContent`
reads. A fantome the user unpacked is one. A modpkg is not, and neither is a mod as an install
leaves it — see ADR-0001, ADR-0003 and ADR-0007.

**Import** — turning a packaged mod into a mod project directory, whatever it arrived as. One driver
serves every surface, `ltk_mod_project`'s `ProjectImporter`: it owns the output directory, a
directory for every layer the config declares and the config write, leaving a per-format backend to
decode. `FantomeImporter` and `ModpkgImporter` are those backends, so the library's unpack path
and the Creator Workshop's two import dialogs are three call sites over one implementation. `RAW/` routing, case-insensitive `WAD/` matching and reading past a bad CRC32 live
inside the fantome backend, so a second importer beside it is a second copy of those bugs — the
workshop had one per format until they were collapsed onto this.

**Ritobin** — our own text syntax for a `.bin`, and the format the manager opens one in for
editing. A ritobin file is source rather than content: the game reads only the compiled form, so a
ritobin file packaged into a shipped mod is build residue the author left in.

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
beside its directory. For a mod stored `archive` it is the mod — the content provider reads from
it. An unpack consumes it and a repack packs the tree into a fresh one (ADR-0007), so exactly one
of tree or archive is the mod at any moment. A fantome's copy is made through the preserve, so
names the community tables cannot recover ride in the archive itself.

**Storage** — where a mod's content is: `project` for the unpacked tree, `archive` for a mod read
out of the file beside it. Recorded on the entry rather than derived. Every install lands as
`archive` (ADR-0007), and `project` is what an unpack from the card, or a discovered project
directory, records.

**Unpack** and **repack** — moving one mod between the two storage modes, from its card in the
library. Unpack reads the archive and deletes it, repack packs the tree into a fresh archive and
deletes the tree (ADR-0007). Neither is offered for a modpkg, which has no unpacked form. See
ADR-0004.

**Staging directory** — `mods/.staging-<uuid>/`, where an install or a conversion assembles a mod
before it is renamed into place, with `mods/.staging-<uuid>.<ext>` beside it for the archive copy.
Swept at startup, and only there: staging runs outside the index lock, so a sweep at any other
moment could delete a directory an install is still filling.

**Legacy layout** — `mods/<uuid>/` plus `archives/<uuid>.<ext>`, the shape a pre-slug library
stored a mod in. A transient state, not a kind of mod: everything core does — overlay builds
included — reads it, while conveniences such as unpack and repack wait for the slug. The layout
migration drains it, retrying whatever it could not move every launch. See ADR-0008.

## Mod health

**Check** — one pass of the Problems rules over an installed mod's content, summarized for a mod
user. It reads and never writes, and it reads a mod where it lies: an `archive`-storage mod is
scanned inside its archive rather than unpacked to be looked at. A modder's view of the same rules
is the Problems panel, and the split is deliberate — see `docs/ux/MOD_HEALTH.md`. A check requires
the **hashtable cache** and does not run without it — see ADR-0009.

**Verdict** — what a check concluded: `healthy`, `repairable`, or `unrepairable`, with the counts
behind it. Remembered per mod in `mod-health-verdicts.json` beside the index. A cache of a
computation, not a record — a lost file refills on the next check. There is no fourth word: a mod
the manager could not judge is **unchecked** instead.

The three words say what a **repair** can do, and nothing about how badly the mod is hurt.
`unrepairable` covers both a mod the game will refuse to load and one that plays with an effect
missing, because neither carries a fix. Severity is the other axis, it rides in the counts, and a
surface that draws a verdict reads both.

**Unchecked** — a mod carrying no verdict, which draws no badge and says nothing. Never checked,
checked by a build whose stored shape has since been discarded, or declined because the hashtable
cache was empty. A verdict is a claim, and an unchecked mod is a claim about nothing — the state
ADR-0009 chose over a fourth verdict word.

**Dormant** — a rule that ran, found everything it finds, and claims none of it, because
something it needs is not on this machine. Two states put a rule to sleep: an installed game older
than the patch the rule describes, and no installed game to read at all. Either way its findings
draw dimmed and count towards nothing, so a **verdict** is a claim only about the rules that were
awake. Not **unchecked**, which is the whole mod saying nothing.

**Basis** — what a check was a claim about: the installed game build, the manager version the rules
and their tables shipped in, and the **generation** of the hashtable cache the run read. Recorded
on every verdict, and comparing it is how the health sweep decides which verdicts are stale.

**Hashtable cache** — the shared mimir cache of community hashtables, one per machine rather than
per library, which is how a WAD chunk and a bin's hashed properties get their names back. Its
**generation** is the manifest stamp, which moves only when a sync installs a table, so a press
that changes nothing makes no verdict stale. Filled by **Sync now** in Settings and by the startup
sync that runs in front of the health sweep.

**Health sweep** — the startup pass that re-checks every mod whose basis moved, and forgets the
verdicts of mods the library no longer holds. It forgets either way and checks only with the
hashtable cache in hand, standing down without it rather than recording verdicts it could not
earn. Not the **staging sweep**, which is the same word for clearing `mods/.staging-*` and is
unrelated. What it found draws as a banner above the library.

**Repair** — applying every fix the live rules derive for one mod. In the tree for a `project`
mod. For an `archive` mod: unpack, fix, and edit the fixed files back into the archive where it
lies, so a repair costs what changed rather than everything the mod holds. An archive that cannot
be edited is repacked whole instead, which is the same outcome by a slower road — see ADR-0005.
Neither is reversible. Neither destroys a **name**, which is what preserved names guarantee, but a
repair may lose fidelity where the defect admits no in-place correction — see ADR-0011.
**Repair all** is the banner's one press over every repairable mod at once, and nothing is ever
repaired without it. Not every defect is a repair's to fix: where the correction needs content only
the installed game has, the overlay **merge**s at build time and the mod is left as it is — see
ADR-0012.

**Compensated** — a defect the overlay **merge** corrects while it builds, so the mod on disk
keeps it forever and the game never sees it. Not **repaired**: nothing is written, no press exists,
and the mod carries the defect again under any other manager. Not healthy either, because the mod
really is defective. So a rule offering no fix is now two different statements — nothing can correct
this, and a repair is the wrong instrument for this — and no **verdict** word tells them apart.

**Preserved names** — the paths a repair writes into the mod's own `hashes/game.hashes.txt`
before it hashes them into `File` properties, so the mod still names what it holds. Additive and
idempotent, and it excludes what the community hashtables already resolve. It is what replaced
the restore point and Undo — see ADR-0006. Not the same as the **harvest** at import, which
recovers names off an incoming archive rather than keeping ones a write is about to destroy.

## The three migrations

Three different things, and the words do not overlap:

**Layout migration** — the startup pass that moves every mod off the uuid layout and onto its slug.
Two renames per mod and no unpack (ADR-0003), so it runs unasked, ahead of the first reconcile. A
toast reports it while it runs, and a dialog lists whatever it could not move — which stays in the
legacy layout, keeps working, and is tried again next launch (ADR-0008).

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
always on. Not what a **merge** does to a chunk, which is a different relationship with the same
everyday word.

**Merge** — building a mod's chunk over the game's copy of it rather than in place of it, so the
game's content survives wherever the mod says nothing. A value replaces, a map combines key by key,
and an object combines field by field. It happens while the overlay is built and is never written
into the mod, so it is not a **repair** and costs the mod nothing — see ADR-0012.
_Avoid_: layer, patch, override

**Profile** — a named set of enabled mods, their order, and their per-mod layer states. The active
profile is what the overlay is built from.

**Mount error** — why the game refused an archive it was mounting. There are four, and the manager
takes the game's word for each rather than coining its own, so a health finding and a diagnostics
code name one state:

- **Missing** — the archive was not where the game looked for it.
- **Unable to open** — the archive was there, and the game could not open it.
- **Corrupt** — the archive opened, and its own contents do not hold together.
- **Inconsistent** — two archives the game mounted disagree about the bytes behind one path.

**Inconsistent** is the one an overlay could create, because routing can put a single path into
several archives. It crashes the game and flags the install for repair, though that repair finds
nothing to fix, because an overlay leaves the game's own files untouched. No rule carries the name:
the build routes every copy of a path by that path's own hash and fans a shared chunk out to all of
its holders, so the state is one the build prevents rather than one a check finds. **Corrupt**
names no rule either, and for the same reason: each of the three defects that would have sat under
it was measured at zero, and each is a state the build should assert over the archives it just
wrote rather than one a pass over a library should hunt for. So the naming rule now has no
instance, which does not make it wrong — see ADR-0010.
