# ADR-0006: A repair preserves names instead of keeping a restore point

Status: accepted (2026-08-28)

Supersedes the restore point and Undo that [PROJECT_PROBLEMS.md](../ux/PROJECT_PROBLEMS.md)
described, and completes [ADR-0005](0005-a-repair-rewrites-the-archive-in-place.md), which left
`project` storage relying on a restore point that `archive` storage never had.

## Context

The `bin/property-type` repair rewrites a `String` holding a path into a `File` holding the
XXH64 of that path. The hash is one-way. Once the fix has written it, the string is gone from
the bin and no reader can derive it back.

The first answer to that was a restore point: before writing anything, a fix run copied every
file it was about to touch under `.ltk/restore/<stamp>/`, kept the last three, and offered one
Undo per run. It made a repair reversible.

Three things then changed.

- **The cost is real.** Eighteen mods repaired in one run wrote 365 MB of copies. A restore
  point of a 60 MB project is 60 MB on disk, three deep, per project.
- **It only ever covered half the feature.** An `archive`-storage mod has no tree to copy from
  and no `.ltk/` to copy into, so [ADR-0005](0005-a-repair-rewrites-the-archive-in-place.md)
  replaced its archive with no way back. Library repair was already irreversible for one of the
  two storage modes.
- **The names can now be kept.** `ltk_hashtable` and the `hashtables` manifest let a mod carry
  its own names: a project declares tables under `hashes/`, and a reader resolves a hash out of
  the mod itself. The path a repair is about to destroy can be written down before it is.

Reversibility and losslessness are not the same promise. A restore point answers "put it back";
a preserved name answers "you did not lose anything". The second is what a modder actually
needs, and it is the one that survives the archive being repacked, the mod being shared, and
the manager not being installed.

## Decision

**A repair writes every path it hashes into the mod's own `Category::Game` hashtable, and keeps
no restore point.**

Before converting a property, the rule asks the run to keep each path under it. A name the
community tables already resolve is not embedded - it costs size and buys nothing. A name whose
key another name already claims is refused, and the rule leaves that one property alone: the
post-fix check still reports it and the mod keeps a repairable verdict. `Category::Game` keys at
the full 64 bits, so that path is defensive rather than one a real mod reaches.

Deleted with the restore point: `.ltk/restore/`, `undo_fix_run`, `fix_runs`, `KEPT_RESTORE_POINTS`,
`UndoReport`, `FixRunSummary`, `FixReport::stamp`, the panel's Undo control, and the hooks
behind it.

## Consequences

A repair is no longer reversible by the manager, and a user who wants the mod as it was
reinstalls it. In exchange every repair is lossless, both storage modes make the same promise,
and a repaired mod carries its names wherever it goes rather than only while the manager's
`.ltk/` survives beside it.

The merge is additive and idempotent: a table gains names and never loses one, a second repair
declares no second table, and a repair offered twice writes nothing the second time.

A project whose tables cannot be read starts empty rather than failing, and a table that cannot
be written is a warning rather than a failed repair - the bins have already landed by then, and
refusing at that point would leave the mod broken as well as unnamed.
