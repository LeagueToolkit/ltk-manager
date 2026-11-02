# Research: LTK Protocol Install List

## R1: One link, a manifest the manager pulls

**Decision**: The link carries a manifest URL and the manager fetches the list.

**Rationale**: A link per mod does not work: browsers prompt per protocol launch and block
bursts, and the manager rate-limits launches under one second apart. A list in the link itself
cannot carry 500 download URLs that expire in 15 minutes while the manager is on item 40. A
manifest the site mints when Install all is pressed can be a short-lived signed URL, so a private
collection reads without a session in the manager.

**Alternatives considered**:

- A link per mod: rejected, as above.
- Download URLs embedded in the manifest: rejected, they expire mid-run and bypass the site's
  download counting.

## R2: A download link minted per item, just in time

**Decision**: Each item names the route that mints its link. The manager POSTs it just before
that item downloads, resolves the answered `path` against the link's origin, and hands the result
to the existing `download_mod_file`.

**Rationale**: The site signs each download link for 15 minutes and counts downloads on the mint.
Minting in advance would expire the tail of a long list; minting per item keeps every link fresh
and every download counted.

**Alternatives considered**:

- Mint all links up front: rejected, expiry.
- `GET` only: kept as a second method for a site that serves files directly, at no cost.

## R3: Same host, whole-manifest refusal

**Decision**: Every item's `download.url` and every minted path must be `https` on the manifest's
host. One bad item refuses the manifest whole, before any download.

**Rationale**: A list is a way to make the manager fetch 500 URLs. Holding them to the host the
reader trusted keeps the trusted providers list meaningful, and refusing whole keeps "a bad
manifest installs nothing" true.

## R4: One item at a time

**Decision**: Items install one after another, each a mint, a download and an install.

**Rationale**: The site rate-limits downloads and its storage, the install pipeline takes the
index lock per install, and one-at-a-time makes progress readable and the final order simple.

**Alternatives considered**:

- Two downloads in flight: deferred. It would need a second progress channel and buys little
  against a per-minute download limit.

## R5: The origin record

**Decision**: Every mod a run installs, updates or finds already installed records
`{ source, id, version }` in `library.json`, surfaced on `InstalledMod.origin`.

**Rationale**: A second Install all of the same collection should skip what is current. The
library matches archives by bytes and mods by name, author and semver, neither of which knows the
site's id or its version label. The record is the item's identity as the site names it. A mod
installed through a single `ltk://install` link records nothing: that link carries no id.

**Alternatives considered**:

- Match by name and version only: rejected, the site's version label is not always the project's
  version, and names repeat across sites.
- Re-download and let the library say already installed: rejected, 500 wasted downloads.

## R6: The top of the list wins

**Decision**: The run installs top first for readable progress, then one reorder puts the list's
mods at the front of the active profile's order in the list's order.

**Rationale**: A fresh install lands at the front of the order, so a list installed top first
would leave its bottom item in front. The owner's order on the site is the one the reader saw.

## R7: The profile choice

**Decision**: The dialog offers the active profile and a new profile named after the list. A new
profile is created and switched to before the first item.

**Rationale**: The install pipeline enables a new mod in the active profile. Switching first is
what makes "install into a new profile" the same pipeline with no second code path. A retry runs
into the active profile, which by then is the new one.

## R8: Stop between items

**Decision**: An atomic flag the cancel command sets and the run reads between items.

**Rationale**: An item mid-download is a temp file and nothing in the index. Stopping between
items leaves the library consistent with no rollback.
