# Feature Specification: LTK Protocol Install List

**Feature Branch**: `002-ltk-protocol-install-list`
**Created**: 2026-11-02
**Status**: Draft
**Input**: Handoff "Install all for Runeforge collections in LTK Manager", runeforge-io/runeforge#544
**Reference**: [001-ltk-protocol-install](../001-ltk-protocol-install/spec.md)

## Clarifications

### Session 2026-11-02

- Q: Which profile receives a collection? → A: The confirm dialog offers the active profile and a
  new profile named after the collection, defaulting to the active one. A new profile is created
  and switched to before the first item installs.
- Q: When two mods in a list override the same files, which wins? → A: The top of the list. The
  run installs top first and then puts the list's mods at the front of the load order, in the
  list's order.
- Q: Does the manager take download URLs embedded in the manifest, or mint each one? → A: It mints
  each one with a POST to the item's `download.url`, just before that item downloads. Runeforge's
  signing and download counting depend on it.
- Q: How does the dialog treat an item the library already holds at the listed version? → A: It
  is shown as installed, not selectable, and counted as skipped.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Install a whole collection from one link (Priority: P1)

A reader on a Runeforge collection page presses Install all. The browser opens LTK Manager once.
The manager reads the list, shows its name, author, source and every mod with a checkbox, and
installs the checked mods one after another on Install. Each row reports where it has got to, and
a report at the end lists what was installed, updated, already there and failed.

**Why this priority**: A collection of up to 500 mods cannot be installed through 500 single
links. The browser prompts per launch and the manager rate-limits launches under one second apart.

**Independent Test**: Follow an `ltk://install-list?url=<manifest>` link to a manifest of three
mods and confirm. The three mods appear in the library in the list's order.

**Acceptance Scenarios**:

1. **Given** a valid manifest, **When** the reader follows the link, **Then** one dialog opens
   with the list's name, author, source and item count, and every item checked.
2. **Given** the reader presses Install, **When** the run proceeds, **Then** each item moves
   through preparing, downloading and installing, and the dialog shows how many are done.
3. **Given** one item's download is refused, **When** the run reaches it, **Then** the item is
   marked failed with the reason and the run continues with the next.
4. **Given** the run ends, **Then** the report counts installed, updated, already installed and
   failed, and offers Retry failed when any failed.
5. **Given** the reader presses Stop, **When** the current item finishes, **Then** the run ends,
   what installed stays installed, and the report says the run was stopped.

---

### User Story 2 - A second Install all installs only what changed (Priority: P2)

The owner adds two mods to a collection the reader installed last week. The reader presses
Install all again. The dialog shows the mods already installed at their listed version as
installed and unselectable, and offers only the two new ones.

**Why this priority**: Without it, updating a collection costs the reader a download of every
mod in it.

**Independent Test**: Install a list, then follow the same link again. Every item is marked
installed and the Install button is absent.

**Acceptance Scenarios**:

1. **Given** a mod the manager installed from the list, **Then** the mod records the site, the
   item's id and the listed version.
2. **Given** a manifest whose item names the same id and version as a recorded mod, **Then** the
   dialog marks the item installed and does not offer it.
3. **Given** a manifest whose item names a newer version than the recorded one, **Then** the
   item is offered, and installing it updates the mod in place.

---

### User Story 3 - A collection into its own profile (Priority: P3)

The reader wants the collection as a set to switch to, apart from the mods already enabled. The
dialog offers a new profile named after the collection.

**Independent Test**: Pick New profile, confirm. The library is on a new profile named after the
list, with the list's mods enabled and nothing else.

**Acceptance Scenarios**:

1. **Given** New profile is picked, **When** the run starts, **Then** a profile named after the
   list is created and switched to before the first item installs.
2. **Given** a profile of that name exists, **Then** the run refuses before the first item and
   the dialog shows why.

---

### Edge Cases

- The manifest is version 2: the run refuses whole, naming the version it reads.
- The manifest lists more than 500 items, or is larger than 1 MiB, or takes longer than 10 s:
  the run refuses whole.
- An item's `download.url` is on another host, or over `http`: the manifest is refused whole.
- A minted download path resolves off the manifest's host: the item fails, the run continues.
- The download link mint answers 429 with `Retry-After` under a minute: the item waits and
  retries once.
- The manifest host is outside the trusted providers list: the dialog asks before reading the
  list, as the single install asks before downloading.
- The same mod appears twice in a list: the second lands as already installed or as an update.
- The reader presses Stop: the run ends after the current item.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST parse `ltk://install-list?url=<manifest>&source=<name>` into its own
  route, with the same URL checks and allowlist stamp as `ltk://install`.
- **FR-002**: System MUST fetch the manifest with a 10 s timeout and refuse a body over 1 MiB.
- **FR-003**: System MUST refuse a manifest whose `version` is not 1, whose `items` count is
  over 500, or whose items download from a host other than the manifest's, before any download.
- **FR-004**: System MUST show one confirmation dialog for the list, with its name, author,
  source, item count, and each item with a checkbox, all checked.
- **FR-005**: System MUST mark items the library holds at the listed version, by the recorded
  origin, as installed and not selectable.
- **FR-006**: System MUST offer installing into the active profile or into a new profile named
  after the list.
- **FR-007**: System MUST mint each item's download link with a POST to `download.url` just
  before that item downloads, resolve the answered `path` against the link's origin, and refuse a
  result off the manifest's host.
- **FR-008**: System MUST install the checked items in order, one at a time, and continue past
  a failed item.
- **FR-009**: System MUST report each item's stage as it changes, and the whole run's result at
  the end, with each failure's reason.
- **FR-010**: System MUST record the source, item id and listed version on every mod the run
  installs, updates or finds already installed.
- **FR-011**: System MUST put the list's mods at the front of the active profile's load order in
  the list's order once the run ends.
- **FR-012**: System MUST let the reader stop a run between items.
- **FR-013**: System MUST offer a retry of the failed items from the report.
- **FR-014**: System MUST send `ltk-manager/<version>` as its user agent on every request.

### Key Entities

- **Install list link**: `ltk://install-list` with a manifest URL and a display source.
- **Manifest**: The list as the site publishes it: a version, a name, an author, a source, a
  page URL, and the items in the owner's order.
- **Item**: A mod of the list: its id on the site, name, author, listed version, page URL and
  download link.
- **Download link**: A method and a URL. `POST` mints `{ path, expiresAt }`; `GET` is the file.
- **Origin**: The site, item id and listed version recorded on an installed mod.
- **Report**: What a run did, item by item, and whether the reader stopped it.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A collection of 500 mods installs from one browser prompt and one manager launch.
- **SC-002**: No download link is minted before its item's turn.
- **SC-003**: One refused download never stops the items after it.
- **SC-004**: A second Install all of an unchanged collection downloads nothing.
- **SC-005**: The list's mods sit at the front of the load order in the list's order.

## Assumptions

- Runeforge mints the manifest URL as a short-lived signed URL when the reader presses Install
  all, so a private collection reads without a session in the manager.
- Each item's `download.url` answers a POST from the manager without a browser session, for
  every mod the manifest lists, and for longer than the manifest's own 15 minutes: a long list
  runs past that.
- The manifest's host and every item's download host are the same host. Redirects from the
  download route to a storage host are followed by the download itself, as for a single install.
- A mod installed through a single `ltk://install` link records no origin: that link carries no
  item id.
