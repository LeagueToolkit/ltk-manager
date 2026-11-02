# ADR-0022: One self-raising dialog holds the screen at a time

- **Status:** Proposed
- **Date:** 2026-09-02
- **Crates:** none, `src/stores/dialogQueue.ts`
- **Related:** ADR-0008 (the library upgrade's failure report)

## Context and problem statement

Six dialogs raise themselves off an async result rather than off a press, and every one of
them is mounted in `src/routes/__root.tsx`: the update check, the deep-link install, the WAD
scan failure, the linked-bin warning, the library upgrade's failure report and the mod health
drawer. None knew about the others, so whichever resolved second drew on top of the first,
each with its own backdrop. The update check lands about three seconds after mount, which
puts it in a race with everything the app does at startup.

Stacking is what the dialog library does by default, and it is what the platform's own
`<dialog>` top layer does. Neither arbitrates. A modal manager of the usual kind - one mount
point plus an imperative `open()` - would not have changed the outcome, because its job is
rendering and ergonomics rather than policy.

The codebase had already invented half of this once. `useModHealthDrawerStore.takeAnnouncement`
spends a run's single unprompted announcement, so mod health cannot announce twice. That is the
same idea scoped to one feature.

## Decision drivers

- Never two backdrops.
- Every surface keeps its own state and its own trigger, since each one already knows when it
  has something to say.
- A dialog that closes must hand the screen on rather than leave the queue stuck.
- Nothing changes for a dialog the reader opened themselves.

## Considered options

1. **Defer the updater behind the others.** One pairwise rule, and the six surfaces are fifteen
   pairs. It fixes the pair that was reported and waits to be rediscovered.
2. **A modal manager.** One mount point, a registry and an imperative API. A large refactor of
   about a dozen dialogs, which fixes real friction and does not fix this.
3. **A queue over the self-raising subset.** A claim on one slot, granted by a fixed order.

## Decision

Option 3. `useDialogQueue` holds the claims, and `useQueuedDialog(dialog, wanted)` takes one
while a surface has something to say. Only the highest-ranked claim is `current`, and a surface
renders on that rather than on its own boolean. Releasing is the effect's cleanup, so a dialog
that clears its own state hands the screen to the next claim without knowing one exists.

The order, most urgent first, is what the reader loses by acting uninformed:

| Dialog              | Why here                                               |
| ------------------- | ------------------------------------------------------ |
| `protocol-install`  | the reader asked for this one, from outside the app    |
| `install-list`      | the same ask, for a whole list                         |
| `wad-scan-failed`   | the patcher stopped and no mods loaded                 |
| `library-migration` | a report, and the move is retried next launch          |
| `mod-health`        | findings, and the status bar keeps a way back to them  |
| `update`            | least urgent, and the title bar keeps a way back to it |

Only self-raising surfaces queue. A dialog the reader opened by pressing something opens, because
deferring it would read as a broken control. The distinction holds without a rule: a modal
backdrop already covers every trigger that could open a second one.

## Consequences

A seventh self-raising dialog is a line in `DIALOG_ORDER` and one hook call, and the ordering
argument happens in one place instead of at each new pair. The cost is that a surface's `open`
prop is no longer the whole truth about whether it wants the screen, so a reader tracing one has
to look at the claim as well.

The update claim is conditional on the route: a check that opens the dialog over Home drops its
opening, because the notes are on the page under it and the title bar cell keeps the way back,
while the order is unchanged and a press opens the dialog on any route (#391).
