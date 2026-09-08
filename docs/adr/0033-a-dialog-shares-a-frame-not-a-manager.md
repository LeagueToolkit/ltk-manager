# ADR-0033: A dialog shares a frame, not a manager

- **Status:** Proposed
- **Date:** 2026-09-08
- **Crates:** none, `src/components/Dialog.tsx`, `src/components/ConfirmDialog.tsx`,
  `src/stores/createDialogStore.ts`
- **Related:** ADR-0022 (one self-raising dialog holds the screen)

## Context and problem statement

Thirty-three files draw a dialog, about 5,900 lines between them. Twenty-seven of those open with
the same seven-element ladder - root, portal, backdrop, overlay, header, title, close - and
eighteen write the same `onOpenChange={(open) => !open && close()}` under it. Four files repeat
one destructive-confirmation body: a toned callout, a heading, a sentence, then Cancel beside a
danger button, and a fifth asks the same question as plain prose.

The duplication is four separate things wearing one name.

| Layer                 | What repeats                                                    |
| --------------------- | --------------------------------------------------------------- |
| The frame             | the ladder, in 27 files                                         |
| The confirmation      | the callout and its footer, in 5 files                          |
| Open state            | three mechanisms, correct but written out longhand at each site |
| Where a dialog mounts | a store dialog hand-mounted per route, twice for two of them    |

Only the last is what a modal manager addresses, and ADR-0022 already weighed one and declined
it: a registry keyed by id fixes rendering and ergonomics, and stacking policy was the question
that ADR was asked.

The three open-state mechanisms are not the problem they look like. Local `useState` is for a
dialog its own trigger owns. `createDialogStore` is for one that outlives the menu that raised it.
`useQueuedDialog` is for one that raises itself and must not stack. Each answers a different
question, and collapsing them loses the answer.

## Decision drivers

- A dialog stays where its trigger imports it, so the module graph still records who opens what.
- A dialog keeps the React tree it was written in, so a provider above it still reaches it.
- A store dialog nobody mounted opens to nothing and reports no error. That has to stop being
  possible one route at a time.
- Nothing about how a dialog is opened changes.

## Considered options

1. **An imperative manager.** `dialogs.open(<Foo />)` against one root mount. It erases the
   import edge from trigger to dialog, which is what `import/no-cycle`, the barrel policy and
   the index all read. Worse, an element raised this way mounts at the root rather than where it
   was called, so a workshop dialog loses the four providers `BinTree` nests and the per-project
   editor state under them.
2. **A registry of `id -> component`.** The same erasure of the edge, without the context loss.
   The mount hole closes and nothing else does.
3. **Primitives for each layer.** A shell component for the frame, a confirm component for the
   body, a hook for the store subscription, and a per-module bundle for the mount.

## Decision

Option 3.

`Dialog.Shell` takes `open`, `onClose`, `title`, and optionally `description`, `size`, `tone`,
`closable` and `titleClassName`, and draws everything down to the title row. Its children are the
`Dialog.Body` and `Dialog.Footer` under that header. Twenty-one files take it directly and four
more reach it through `ConfirmDialog`.

Every part stays exported, and eight files still build the frame from them. Three are not a title
row at all: the sheet and the two context-menu forms, whose fields sit inside the header. Five
each hold one thing the shell does not express - a header that is not a `Dialog.Header`, an
overlay with no header, a close button toned per severity, a `truncate` description, and a dialog
undismissable mid-install. `titleClassName` is the one escape hatch, because an icon laid out
beside the title was the single reason four otherwise ordinary files could not convert. A second
hatch for the close button or the description would make the shell a wrapper around the parts
rather than the common case over them.

`ConfirmDialog` is one question and one destructive answer. With a `heading` the body is the toned
callout, and without one it is the description as plain prose. `useConfirm` asks the same question
from a caller with no place to mount, and `ConfirmHost` above the router is where it draws. It is
the one imperative path in the system, and it is safe because a confirmation's whole content is
data: no context, no fields, no pending state of its own.

`useDialog(store)` is one `useShallow` subscription over a `createDialogStore`, answering `isOpen`,
`payload` and `close`. The trigger side keeps reading `open` on its own, because a trigger that
subscribed to the payload would re-render on every raise.

`WorkshopDialogs` and `LibraryDialogs` mount their module's store dialogs, once, at the route
every consumer sits under. Mount-completeness becomes one import instead of a list per route.

## Consequences

A new dialog is a `Dialog.Shell` and a body. A new confirmation is props. A new store dialog is a
line in its module's bundle, and forgetting that line is a diff a reviewer sees rather than a
control that silently does nothing.

The mount bundle is the part that trades something away: a dialog scoped to one route mounts in
the bundle over every route in the module, so it is live where it can never open. That costs a
component rendering null and buys the class of bug away. A dialog that must not exist off its own
route - the extract dialog and its runner - stays mounted on that route.

`useConfirm` lands with no caller. It exists so the next confirmation raised from a menu is a call
rather than a tenth dialog store, and it is the reason option 1 does not have to come back.
