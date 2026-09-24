/* The layout sub-barrel rather than the module barrel: the full barrel pulls
   the editor's components, whose imports circle back into workshop state. */
// eslint-disable-next-line no-restricted-imports -- the cycle the comment above names
import { type LayoutNode, singleLeaf } from "@/modules/editor/layout";

import type { SelectedModule } from "../../bin/documents/state/editorFile";
import {
  defaultShellArrangements,
  type ShellArrangements,
  type ShellKind,
} from "../../bin/shell/utils/shellPanes";
import type { AbilityRecipe } from "../../bin/spells/utils/abilityRecipe";
import type { ContentDocument } from "../../documents/utils/contentDocument";
import type {
  CurveAimRequest,
  IgnoreLineRevealRequest,
  RevealRequest,
  RowRevealRequest,
  StringKeyAimRequest,
} from "./editorRequests";
import type { PreviewIds } from "./previewTabs";

/**
 * Everything the editor holds for one project.
 *
 * `documents`, `layout`, `activeLeafId`, `selectedLayer` and `selectedModule` persist, written to
 * the project's own `.ltk/editor.json` by `useEditorPersistence`. The rest is
 * rebuilt each run: a dirty flag belongs to an editor that is currently
 * mounted, and neither the shut directories nor a pending scroll are worth
 * carrying across a restart.
 */
export interface ProjectEditor {
  abilities?: readonly AbilityRecipe[];
  /** Every open document, keyed by id. A leaf's tabs are ids into this map. */
  documents: Record<string, ContentDocument>;
  /** The split tree of editor groups. A single leaf until the user splits. */
  layout: LayoutNode;
  /** The leaf a newly opened document lands in. */
  activeLeafId: string;
  /**
   * The layer every layer-scoped panel reads.
   *
   * Held rather than derived from the active tab, so a panel that is not a
   * document - the file tree, the WAD list - still has a layer to read once the
   * strip is empty or the active tab belongs to no layer.
   */
  selectedLayer: string | null;
  /** The project's "Use game data declarations" choice, absent until the reader makes one. */
  useDeclarations?: boolean;
  /** The module of `selectedLayer` a declared document writes to, null for the default placement. */
  selectedModule: SelectedModule | null;
  /**
   * The ephemeral tab of each group, which that group's next open replaces.
   *
   * Empty unless the user asked for the `replace` tab mode. One per leaf rather
   * than one per project, so a walk through a tree in one group leaves the
   * replaceable tab of another group standing. Keyed by leaf id, holding a
   * document id.
   */
  previewIds: PreviewIds;
  /** Ids with unsaved edits. Editors report their own. */
  dirty: ReadonlySet<string>;
  /**
   * Ids a user pinned, which lead their strip and outlive a close of the rest.
   *
   * One list for the project rather than one per group, because a document
   * sits in exactly one group and its pin travels with it into another. An
   * array rather than a set so the persisted slice compares by identity.
   */
  pinned: readonly string[];
  /** Directories the user shut, per layer name. Anything absent is open. */
  collapsed: Record<string, ReadonlySet<string>>;
  /** The pending scroll request, which at most one layer's tree answers. */
  reveal: RevealRequest | null;
  /** The pending row request, which at most one open bin or object tab answers. */
  revealRow: RowRevealRequest | null;
  /** The pending line request, which at most one open rules document answers. */
  revealIgnoreLine: IgnoreLineRevealRequest | null;
  /** The pending curve request, which at most one open object tab answers. */
  aimCurve: CurveAimRequest | null;
  /** The pending key request, which at most one open strings document answers. */
  aimStringKey: StringKeyAimRequest | null;
  /**
   * Each shell's tree of panes, and the leaf a reopened pane lands in.
   *
   * One arrangement per project and kind of shell rather than per tab, so a reader
   * arranges the panes once and every object of that kind opens arranged that way.
   */
  shells: ShellArrangements;
  /** The one panel filling the grid, or null while the tree draws whole. */
  maximizedLeafId: string | null;
  /** The one panel filling each shell, absent for a shell drawing its whole tree. */
  maximizedShellLeaf: Readonly<Partial<Record<ShellKind, string>>>;
}

/* Shared by every editor nothing has touched. Safe to share because every tree
   op copies before it writes. */
const ROOT = singleLeaf();

/** The pane trees every project starts on, shared for the same reason as ROOT. */
export const SHELL_ROOTS = defaultShellArrangements();

export const EMPTY_EDITOR: ProjectEditor = {
  documents: {},
  layout: ROOT,
  activeLeafId: ROOT.id,
  selectedLayer: null,
  selectedModule: null,
  previewIds: {},
  dirty: new Set(),
  pinned: [],
  collapsed: {},
  reveal: null,
  revealRow: null,
  revealIgnoreLine: null,
  aimCurve: null,
  aimStringKey: null,
  shells: SHELL_ROOTS,
  maximizedLeafId: null,
  maximizedShellLeaf: {},
};

/** The collapsed-set of a layer nobody has shut a directory in. */
export const NO_COLLAPSED_DIRS: ReadonlySet<string> = new Set();
