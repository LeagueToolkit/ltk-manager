import { type ReactNode, useCallback, useMemo, useState } from "react";

import { m } from "@/i18n";
import { twMerge } from "@/utils";

import { PortalSlot } from "../layout/PortalHosts";
import { useLeafCloses } from "../state/leafCloses";
import { NO_SHARED_TITLES } from "../tabTitles";
import type { EditorDocumentBase, EditorDocumentDefinition, EditorRegistry } from "../types";
import { useCloseQueue } from "../useCloseQueue";
import { useEditorKeys } from "../useEditorKeys";
import { useDocumentStage, usePublishLeafChrome } from "./DocumentStage";
import { EditorTabs } from "./EditorTabs";
import { UnsavedCloseDialog } from "./UnsavedCloseDialog";

/** The strip and the toolbar row, one island while the shown document is islands. */
const HEADER = [
  "flex shrink-0 flex-col bg-surface-900",
  "group-data-[islands-shown]/surface:mb-1.5",
  "group-data-[islands-shown]/surface:overflow-hidden",
  "group-data-[islands-shown]/surface:rounded-lg",
  "group-data-[islands-shown]/surface:rounded-t-xl",
  "group-data-[islands-shown]/surface:border",
  "group-data-[islands-shown]/surface:border-surface-700/50",
].join(" ");

/* The strip's scrollbar track is the row's top inset. The island's own border closes the row,
   so the row drops its hairline under it. */
const TOOLBAR = [
  "flex shrink-0 items-center gap-2 border-b border-surface-700/50 px-2 pb-1.5 empty:hidden",
  "group-data-[islands-shown]/surface:border-b-0",
].join(" ");

export interface EditorSurfaceProps<D extends EditorDocumentBase> {
  /** The leaf this surface draws, which the strip scopes its drag ids by. */
  leafId: string;
  documents: readonly D[];
  activeId: string | null;
  registry: EditorRegistry<D>;
  /** Documents whose editor has reported unsaved edits. */
  dirtyIds: ReadonlySet<string>;
  /** Documents a user pinned. They lead the strip, and a batch close passes them over. */
  pinnedIds: readonly string[];
  /** The ephemeral tab, which draws in italic. Null when the strip holds none. */
  previewId?: string | null;
  /** Titles more than one open document carries, whose tabs name their layer. */
  sharedTitles?: ReadonlySet<string>;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  /** The keyboard route to a split, offered from a tab's context menu. */
  onSplit?: (id: string, edge: "right" | "bottom") => void;
  /** A double click on a tab, which keeps an ephemeral one. */
  onPromote?: (id: string) => void;
  /** Absent leaves the strip without a pin, for a host whose tabs are all alike. */
  onTogglePin?: (id: string, pinned: boolean) => void;
  /** This group takes a document only from a gesture that names it. */
  locked?: boolean;
  /** Absent leaves the strip without a lock, for a host whose groups all take an open. */
  onToggleLock?: (locked: boolean) => void;
  /** A double click on a kept tab, which fills the grid with this surface. */
  onMaximize?: () => void;
  /** A pointer landing anywhere in the surface, tab strip or document body. */
  onFocus?: () => void;
  /** Where a find goes for an active document with no search box of its own. */
  onFindElsewhere?: () => void;
  /** Puts the newest closed tab back, which `Ctrl+Shift+T` asks the focused group for. */
  onReopenClosed?: () => void;
  /** This leaf holds the layout's focus, so its active tab carries the accent on its top edge. */
  focused?: boolean;
  /** Shown while nothing is open. */
  empty?: ReactNode;
  className?: string;
}

/**
 * A tab strip over a stack of open documents, in the shape an IDE uses.
 *
 * The documents mount in the `DocumentStage` above the split tree, and the surface adopts them.
 * Inactive ones are hidden, so scroll position and half-typed edits survive a trip to another
 * tab. Closing one with unsaved edits asks first.
 *
 * The focused group answers the editor's keys, per "The editor's keys" in
 * `docs/ux/PROJECT_EDITOR.md`.
 *
 * The row under the strip is a slot the active document fills through
 * {@link DocumentToolbar}, rather than chrome this surface is handed.
 *
 * A shown document that reports islands, through `useIslands`, draws its own framed panes. The
 * strip and the row then become one rounded island over the ground, and the surface paints
 * none of its own. The surface marks itself `data-islands-shown` for that, which a wrapper's
 * `className` can read too.
 */
export function EditorSurface<D extends EditorDocumentBase>({
  leafId,
  documents,
  activeId,
  registry,
  dirtyIds,
  pinnedIds,
  previewId,
  sharedTitles = NO_SHARED_TITLES,
  onActivate,
  onClose,
  onSplit,
  onPromote,
  onTogglePin,
  locked,
  onToggleLock,
  onMaximize,
  onFocus,
  onFindElsewhere,
  onReopenClosed,
  focused,
  empty,
  className,
}: EditorSurfaceProps<D>) {
  const [toolbar, setToolbar] = useState<HTMLElement | null>(null);
  /* How many shown documents report islands, which is one or none. */
  const [islands, setIslands] = useState(0);
  const reportIslands = useCallback(() => {
    setIslands((count) => count + 1);
    return () => setIslands((count) => count - 1);
  }, []);

  const stage = useDocumentStage();
  const chrome = useMemo(() => ({ toolbar, reportIslands }), [toolbar, reportIslands]);
  usePublishLeafChrome(leafId, chrome);

  /* The registry narrows to one kind per key, which a lookup by a union's own
     kind cannot express. The key comes off the document, so the two agree. */
  const definitionFor = useCallback(
    (document: D): EditorDocumentDefinition<D> | undefined => {
      const definition = registry[document.kind as D["kind"]];
      return definition as unknown as EditorDocumentDefinition<D> | undefined;
    },
    [registry],
  );

  /* Each tab carries a freshly built icon element, so deriving these inline
     handed the strip a new object per tab on every render of this component -
     a dialog opening was enough to repaint every tab. */
  const tabs = useMemo(
    () =>
      documents.flatMap((document) => {
        const definition = definitionFor(document);
        if (!definition) return [];

        const { title, context, layer, path } = definition.label(document);
        return [
          {
            id: document.id,
            title,
            context: context ?? (sharedTitles.has(title) ? layer : undefined),
            path,
            icon: definition.icon(document),
            dirty: dirtyIds.has(document.id),
            preview: document.id === previewId,
            pinned: pinnedIds.includes(document.id),
            menu: definition.tabMenu?.(document),
          },
        ];
      }),
    [documents, definitionFor, dirtyIds, pinnedIds, previewId, sharedTitles],
  );

  const close = useCloseQueue({
    documents,
    dirtyIds,
    pinnedIds,
    titleOf: (document) => definitionFor(document)?.label(document).title,
    onClose,
    onActivate,
  });

  useLeafCloses(leafId, close);

  const documentIds = useMemo(() => documents.map((document) => document.id), [documents]);

  useEditorKeys({
    enabled: focused === true,
    documentIds,
    activeId,
    onActivate,
    onClose: close.closeOne,
    onFindElsewhere,
    onReopenClosed,
  });

  return (
    <div
      data-ui={`EditorSurface:${leafId}`}
      data-islands-shown={islands > 0 || undefined}
      onPointerDownCapture={onFocus}
      className={twMerge(
        "group/surface flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-900",
        "data-[islands-shown]:bg-transparent",
        className,
      )}
    >
      <div data-ui="EditorSurface:header" className={HEADER}>
        <EditorTabs
          leafId={leafId}
          tabs={tabs}
          activeId={activeId}
          onActivate={onActivate}
          onClose={close.closeOne}
          onCloseOthers={close.closeOthers}
          onCloseToRight={close.closeToRight}
          onCloseAll={close.closeAll}
          onSplit={onSplit}
          onPromote={onPromote}
          onTogglePin={onTogglePin}
          locked={locked}
          onToggleLock={onToggleLock}
          onMaximize={onMaximize}
          focused={focused}
        />

        {/* `empty:hidden` rather than a conditional, because what fills this row
            arrives through a portal and so cannot be read from here. */}
        <div ref={setToolbar} data-ui="EditorSurface:toolbar" className={TOOLBAR} />
      </div>

      <div data-ui="EditorSurface:documents" className="relative min-h-0 flex-1 overflow-hidden">
        {documents.length === 0 && empty}

        {documents.map((document) => (
          <PortalSlot key={document.id} host={stage.hostOf(document.id)} />
        ))}
      </div>

      <UnsavedCloseDialog
        open={close.question !== null}
        title={m.editor_unsaved_close_title()}
        description={m.editor_unsaved_close_hint({ title: close.question?.title ?? "" })}
        saveLabel={close.question?.saves === true ? m.editor_unsaved_save_action() : undefined}
        discardLabel={m.editor_unsaved_discard_action()}
        saving={close.saving}
        onAnswer={close.answer}
      />
    </div>
  );
}
