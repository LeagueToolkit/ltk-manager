# ADR-0075: A check and a repair read a modpkg from its package

- **Status:** Accepted (2026-11-01)
- **Date:** 2026-11-01
- **Crates:** `ltk-manager-problems` (`ProjectFiles::in_modpkg`), `ltk-manager-library`
  (`LibraryModEntry::is_checkable`, `ModLibrary::run_over`, `ModLibrary::repair_in_modpkg`)
- **Related:** [ADR-0001](0001-fantome-unpacks-modpkg-stays-packed.md),
  [ADR-0005](0005-a-repair-rewrites-the-archive-in-place.md),
  [ADR-0006](0006-a-repair-preserves-names-instead-of-keeping-a-restore-point.md),
  [ADR-0009](0009-a-health-check-requires-the-hashtables.md),
  [ADR-0025](0025-an-archive-repair-reads-the-archive-where-it-lies.md), "The check and the
  repair, per storage" in `docs/ux/MOD_HEALTH.md`

## Context and problem statement

A health check read a fantome only. A modpkg got no check at import, no Check Health row, no badge
and no place in a sweep, so a modpkg with a fatal `bin/property-type` finding looked the same as a
clean mod. ADR-0001 gave the reason: a modpkg's content exists only inside its archive. Since
ADR-0025 the check reads an archive-storage fantome from its archive, and the modpkg format is
built for that read. The reader reads the chunk table with one seek, reads each chunk on its own,
and finds every chunk under the path that it was packed from.

A verdict must not say `repairable` for a mod that the library cannot repair - ADR-0009. The
fantome repair writes the fixed chunks back into the archive through `ltk_fantome`. `ltk_modpkg`
has a builder and no edit, so a modpkg repair needs a way to write a package that keeps everything
the package carried.

## Considered options

- Read the package in place through a file source of its own, as the fantome scan does
- Extract the package to a scratch directory and run the rules over the tree. A trial over seven
  local packages ran with no panic, and each check copied the whole content to disk
- Leave a modpkg unchecked, and draw it as unchecked
- Repair a modpkg with an unpack into a project, a fix of the tree and a repack through
  `ProjectPacker`. The repack reads `mod.config.json`, which does not carry every field of the
  package's metadata, such as a distributor stamp
- Repair a modpkg by writing the package again from its own chunks, with the fixed files in
  place of the chunks they replace

## Decision

**The check reads a modpkg from its package.** `ProjectFiles::in_modpkg` mounts the package once,
lists each chunk of each declared layer under `{wad}/{path}`, which is the path that an import
writes, and decodes a chunk through the package's decoder when a rule reads its bytes. The
package's declared hashtables name its bin hashes. No resolver names a chunk, because the package
stores its paths.

**`is_checkable` returns `true` for a modpkg.** The sweep, the check at import, the card menu,
the badge and the launch ask include a modpkg with no change of their own. If a package does not
mount, the check fails and the mod keeps no verdict.

**A repair writes the package again from its own chunks.** The fix run holds its writes in
memory, as the fantome repair does. `repair::modpkg::rewrite` then registers every content chunk
of the package on a `ModpkgBuilder`, with the run's bytes for a file the run wrote and the
package's own bytes for every other file, and leaves out a file the run removed. The metadata
chunk, the readme, the license, the thumbnail and every declared table are copied from the
package's own chunks, so a distributor stamp and a layer's `game_data` declarations survive. The
table the run merged its kept names into is written in place of the one it came from, or declared
afresh under `_meta_/hashes/`. The new package is written beside the old one and swapped in once
it is whole - ADR-0005.

**The rules read no declarations.** This holds for every storage and format. The gap is recorded
as an open question in `docs/ux/MOD_HEALTH.md`.

## Consequences

- A repair of a modpkg decodes and encodes every chunk the package holds, where a fantome edit
  rewrites the fixed chunks and copies the rest. The cost is one repack per press.
- A chunk the package stores under `_meta_/` with no project-level form, other than the
  metadata, the readme, the license, the thumbnail and the tables, is not carried.
- The decoder borrows the mounted package mutably, so the reads of one check are serialized
  through one lock. A bin is parsed outside that lock, so a run still parses in parallel.
- A chunk with no extension is decoded whole to read its magic. The fantome scan decodes only the
  head of a nameless chunk.
