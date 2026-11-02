# ADR-0076: A list installs through one link and mints each download in turn

- **Status:** Accepted (2026-11-02)
- **Date:** 2026-11-02
- **Crates:** `ltk-manager-core` (`deep_link::install_list`, `DeepLinkRequest::InstallList`),
  `ltk-manager-library` (`ModOrigin`, `ModLibrary::set_mod_origin`), `ltk-manager-base`
  (`InstallListProgress`), `src-tauri` (`deep_link::install_list::run`)
- **Related:** [ADR-0017](0017-errors-cross-ipc-as-codes-and-the-frontend-owns-the-words.md),
  [ADR-0022](0022-one-self-raising-dialog-holds-the-screen-at-a-time.md), "Installing a list" in
  `docs/ux/LIBRARY.md`, `.specify/specs/002-ltk-protocol-install-list/`

## Context and problem statement

`ltk://install` takes one mod. A Runeforge collection is a list of up to 500 mods, and its
Install all button has nowhere to send them: a link per mod meets a browser prompt per launch and
the manager's one-second rate limit, and a link that carries 500 download URLs carries links that
expire in 15 minutes while the manager is on item 40. Runeforge signs each download link and
counts downloads on the mint, so the manager cannot hold a link for later or take one it did not
ask for.

A second press of Install all on a collection the reader installed last week should install what
changed, and nothing else. The library matches an archive by its bytes and a mod by its name,
authors and semver, and neither knows a mod's id on the site or the version label the site lists.

## Considered options

- One `ltk://install` link per mod, fired in sequence from the page
- A link that carries the download URLs of every mod
- A link that carries a manifest URL, with the download URLs in the manifest
- A link that carries a manifest URL, with the route that mints each download link in the
  manifest, minted by the manager just before that item downloads
- Record each installed mod's site id and listed version, or match by name and version

## Decision

**One link names a manifest, and the manager mints each download in turn.** `ltk://install-list`
carries a manifest URL and a display source. The manager reads the manifest within its limits -
version 1, at most 500 items, 1 MiB, 10 seconds - and refuses it whole for any item that downloads
from another host or over `http`. Each item names the route that mints its link. The run POSTs it
just before the item downloads, resolves the answered path against the link's origin, holds it to
the manifest's host, and hands it to the download a single install uses. Nothing is minted in
advance.

**The run is one command, one item at a time, and a failure is a row.** Each item moves through
resolving, downloading and installing, reported as `install-list-progress`. A refused item is a
row of the report's `failed`, and the run goes on to the next. A 429 with a `Retry-After` under a
minute is waited through once. The reader stops the run between items, and what installed stays.

**Every mod the run touches records its origin.** `ModOrigin { source, id, version }` goes on
the library entry of each item the run installs, updates or finds already installed. The dialog
marks an item whose id and listed version a recorded mod names as installed and does not offer it.
A single `ltk://install` link records nothing: it carries no id.

**The top of the list wins.** The run installs top first and then puts the list's mods at the
front of the active profile's order, in the list's order, through the one reorder the table uses.

**A new profile is a switch before the first item.** The dialog offers the active profile and a
new profile named after the list. The install pipeline enables a new mod in the active profile, so
creating and switching first is the whole of "install into a new profile".

## Consequences

- Runeforge's part is a signed manifest endpoint and an Install all button, in its own session.
  Its download-link route must answer the manager's POST without a browser session for every mod
  the manifest lists, and for longer than the manifest's 15 minutes.
- A manifest from a host outside the trusted providers list is a question before the read, as a
  single install's download is, and the fetch and the run both read the list.
- `library.json` gains an optional `origin` per entry. An index without it reads as before.
- The run holds one IPC command for as long as the list takes. Progress reaches the dialog by
  event, and a closed window loses nothing the index already holds.
- The same mod twice in a list lands the second time as already installed or as an update, and
  is counted once in the order.
