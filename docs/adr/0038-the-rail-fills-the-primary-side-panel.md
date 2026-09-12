# ADR-0038: The rail fills the primary side panel

- **Status:** Accepted (2026-09-12)
- **Date:** 2026-09-12
- **Crates:** none. A panel is frontend, and Rust knows no view
- **Related:** Amends [ADR-0034](0034-the-shells-panes-are-the-editors-split-tree.md), whose
  split tree holds the editor surfaces the rail's views are not in.
  [ADR-0028](0028-an-object-is-a-document-of-its-own.md), whose documents stay documents. The
  rule is stated in "The rail" in `docs/ux/PROJECT_EDITOR.md`.

## Context and problem statement

The primary side panel held one view, the project map of Content, WADs and Strings, and a row of
nine icons sat above it. Six of those icons opened a document in the editor grid and the rest ran
a command, so a row that read as navigation was a launcher for tabs.

That cost the browsers their place. Problems, the objects browser and the game index are places a
modder looks while editing something else, and a tab holds the work rather than the place. Each
one opened over the file a modder was changing, or took a split they then had to arrange.

The row also grew along one axis the panel does not have. Nine icons at 224px wide left no room
for a tenth, and source control is still to come.

## Decision

**The rail fills the primary side panel, and one view fills it at a time.** The rail is a column
down the content browser's outer edge. Its upper group is six views - Explorer, Search, Problems,
Objects, Game index, Source control - and the panel shows whichever one the rail selected.
`sidebarView` in the workshop layout store is that selection, persisted beside the side and the
open state the panel already kept.

**The rail sits outside the panel it drives.** The panel is a share of a `react-resizable-panels`
`Group` and hides on its own; the rail is neither, so it draws in `ContentBrowser` beside that
group, on whichever side `layerPanelSide` says. A project's routes are then on screen whatever
the editor grid holds, and pressing the showing view's own icon is what hides the panel.

**A view is given the toolbar slot an editor surface gives a document.** The panel provides
`DocumentToolbarSlotContext` for its header row, so a view that hosts a document - Problems,
Objects - draws that document's own box, counts and actions there rather than losing them. A view
with no document of its own draws into the same row through `DocumentToolbar`.

**The wide forms stay documents, and the view names its own.** The game browser's grid and
details list need a surface, so `gameDocument()` and `objectsDocument()` still open as tabs, and
the Game index view draws the tree half alone. A view that stands in for a document declares it
as `wide` on its `railViews()` entry, and the panel header's kebab opens it. The `wide` title is
the document's rather than the view's, because Search draws half of the game browser and an item
reading "Open Search in a tab" would name a tab that does not exist. A scoped game browser is
still a document, because two of them side by side is the point of it.

## Consequences

- The lower group of the rail keeps the project's own documents - Mod details, Readme, Ignore
  rules - and the folder. They open tabs, so a rule separates them from the views above.
- `useRevealInObjects`, `useRevealGameSearch` and the Problems badge now show a view rather than
  opening a document. A reveal always opens the panel, so the toggle lives in the rail rather
  than in the store's action.
- The same browser can be mounted twice, once in the panel and once in a tab. Both read one
  zustand store, so the two agree, and neither holds state the other cannot see.
- A seventh view is one entry in `railViews()` and one arm of the panel's body. The panel is a
  host and not a list of special cases.
- The panel's narrow width is the constraint every view now answers to. `useNarrowToolbar`
  already exists for a toolbar that has to drop what a reader reaches another way, and a view
  whose chrome does not fit at 224px adopts it rather than growing the panel.
