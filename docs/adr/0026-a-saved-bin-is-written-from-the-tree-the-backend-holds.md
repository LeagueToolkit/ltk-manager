# ADR-0026: A saved bin is written from the tree the backend holds

- **Status:** Accepted (2026-09-05). The save sentence is superseded by
  [ADR-0040](0040-a-bin-save-writes-the-edited-objects-over-the-bytes-it-opened.md). The bound
  is amended from eight to thirty-two documents (2026-09-24)
- **Date:** 2026-09-05
- **Crates:** `ltk-manager-core`, `src-tauri`
- **Related:** [ADR-0027](0027-a-node-is-addressed-by-the-games-property-path.md), which names
  the node a row and an edit refer to. The rule is stated in "Rust owns the tree" in
  `docs/ux/BIN_EDITOR.md`.

## Context and problem statement

The bin editor draws a `.bin` as blocks over its parsed tree. A `.bin` of a project layer is
edited and written back. `ltk_meta` reads 27 value kinds. A viewer draws a subset of them well.
Two shapes fit where the tree lives:

1. The backend parses the file and serializes the whole tree to JSON. The frontend holds it,
   edits it and sends it back to be written.
2. The backend parses the file once and keeps the `Bin` for as long as the document is open. The
   frontend holds a window of rows and asks for more.

The first is the shape of a text editor over a file, and the shape the strings editor takes, where
a document is a flat table of keys and values. A bin is a tree. A tree serialized to JSON, edited
and serialized back loses what the crossing does not model: a kind with no widget, a hash no table
names, a container order, a duplicate key. Any of those written back corrupts game data silently. A
silent corruption of game data is the one failure a mod manager cannot ship.

## Decision

**The backend parses a bin once and keeps the `Bin` for as long as the document is open. The
frontend never holds the tree.** The frontend opens a document and receives a handle, asks for
the children of one node as rows, and closes the document. An edit is a patch applied to the tree
in Rust, answered with the rows that changed. A save writes the `Bin` the backend holds, never a
tree rebuilt from what the frontend drew.

The store is bounded to thirty-two open documents and evicts the least recently used. Every read
and every edit marks its document the most recently used. A frontend that crashes without
closing costs the memory of thirty-two trees and no more, and a reload of the page closes every
clean tree. The open and the close are
explicit over IPC. A tab closed without a close call is a leaked tree.

## Consequences

- **Positive:** the frontend cannot lose data. It holds none. What it fails to draw, it fails to
  draw, and the file is unharmed. A kind with no widget has a row and round-trips.
- **Positive:** a container of several thousand elements is one node and one row until it is
  expanded. The rows under it arrive as a range. The payload is what the viewport reads.
- **Negative:** every expansion is an IPC round trip. The design budgets 16ms for one. A
  projection over an in-memory tree meets that with room.
- **Negative:** a document evicted from the store while its tab is open answers its next call
  with an error, and the frontend reopens it and sends the call again on the fresh id. Eviction
  refuses a document with unsaved edits, so a reopen loses no edit. It loses the undo history of
  a saved tree.
- **Neutral:** every tree in the store is held by an open id, so an eviction always takes a tab's
  tree. The bound sits above the tabs a user keeps open, and a burst of short opens, such as a
  spell preview's, takes at most the least recently used tree.
- **Neutral:** the hash tables name rows at projection time and not at parse time. A hashtable
  sync renames the rows a document draws next and leaves its tree alone.
