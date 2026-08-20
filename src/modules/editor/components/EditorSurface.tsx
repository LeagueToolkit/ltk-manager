import { type ReactNode, useCallback, useMemo, useState } from "react";
import { twMerge } from "tailwind-merge";

import { Button, Dialog } from "@/components";

import type { EditorDocumentBase, EditorDocumentDefinition, EditorRegistry } from "../types";
import { DocumentActionsSlotContext, DocumentToolbarSlotContext } from "./DocumentActions";
import { DocumentActionsMenu } from "./DocumentActionsMenu";
import { EditorTabs } from "./EditorTabs";

export interface EditorSurfaceProps<D extends EditorDocumentBase> {
  /** The leaf this surface draws, which the strip scopes its drag ids by. */
  leafId: string;
  documents: readonly D[];
  activeId: string | null;
  registry: EditorRegistry<D>;
  /** Documents whose editor has reported unsaved edits. */
  dirtyIds: ReadonlySet<string>;
  /** The ephemeral tab, which draws in italic. Null when the strip holds none. */
  previewId?: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  /** The keyboard route to a split, offered from a tab's context menu. */
  onSplit?: (id: string, edge: "right" | "bottom") => void;
  /** A double click on a tab, which keeps an ephemeral one. */
  onPromote?: (id: string) => void;
  /** A pointer landing anywhere in the surface, tab strip or document body. */
  onFocus?: () => void;
  /** This leaf holds the layout's focus, so its active tab carries the accent rail. */
  focused?: boolean;
  /** Shown while nothing is open. */
  empty?: ReactNode;
  className?: string;
}

/**
 * A tab strip over a stack of open documents, in the shape an IDE uses.
 *
 * Every open document stays mounted and inactive ones are hidden, so
 * scroll position and half-typed edits survive a trip to another tab.
 * Closing one with unsaved edits asks first.
 *
 * The strip's trailing edge is a slot the active document fills through
 * {@link DocumentActions}, rather than chrome this surface is handed.
 */
export function EditorSurface<D extends EditorDocumentBase>({
  leafId,
  documents,
  activeId,
  registry,
  dirtyIds,
  previewId,
  onActivate,
  onClose,
  onSplit,
  onPromote,
  onFocus,
  focused,
  empty,
  className,
}: EditorSurfaceProps<D>) {
  /* A queue rather than one document: Close Others can meet several unsaved
     editors at once, and each of them is its own question. */
  const [pendingCloses, setPendingCloses] = useState<readonly D[]>([]);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [toolbar, setToolbar] = useState<HTMLElement | null>(null);

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

        return [
          {
            id: document.id,
            ...definition.label(document),
            icon: definition.icon(document),
            dirty: dirtyIds.has(document.id),
            preview: document.id === previewId,
          },
        ];
      }),
    [documents, definitionFor, dirtyIds, previewId],
  );

  /** Close what can go now, and queue whatever would lose edits. */
  const requestClose = useCallback(
    (ids: readonly string[]) => {
      const pending: D[] = [];
      for (const id of ids) {
        const document = documents.find((candidate) => candidate.id === id);
        if (document && dirtyIds.has(id)) pending.push(document);
        else onClose(id);
      }
      setPendingCloses(pending);
    },
    [documents, dirtyIds, onClose],
  );

  const closeOne = useCallback((id: string) => requestClose([id]), [requestClose]);

  const closeOthers = useCallback(
    (id: string) =>
      requestClose(documents.filter((document) => document.id !== id).map((it) => it.id)),
    [documents, requestClose],
  );

  const closeToRight = useCallback(
    (id: string) => {
      const from = documents.findIndex((document) => document.id === id);
      if (from < 0) return;
      requestClose(documents.slice(from + 1).map((document) => document.id));
    },
    [documents, requestClose],
  );

  const closeAll = useCallback(
    () => requestClose(documents.map((document) => document.id)),
    [documents, requestClose],
  );

  function discardPending() {
    const [head, ...rest] = pendingCloses;
    if (!head) return;
    onClose(head.id);
    setPendingCloses(rest);
  }

  function pendingTitle(): string | undefined {
    const document = pendingCloses[0];
    if (!document) return undefined;
    return definitionFor(document)?.label(document).title;
  }

  return (
    <div
      data-ui={`EditorSurface:${leafId}`}
      onPointerDownCapture={onFocus}
      className={twMerge(
        "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-950",
        className,
      )}
    >
      <EditorTabs
        leafId={leafId}
        tabs={tabs}
        activeId={activeId}
        onActivate={onActivate}
        onClose={closeOne}
        onCloseOthers={closeOthers}
        onCloseToRight={closeToRight}
        onCloseAll={closeAll}
        onSplit={onSplit}
        onPromote={onPromote}
        focused={focused}
        actions={<DocumentActionsMenu slot={slot} onSlot={setSlot} />}
      />

      {/* `empty:hidden` rather than a conditional, because what fills this row
          arrives through a portal and so cannot be read from here. */}
      <div
        ref={setToolbar}
        data-ui="EditorSurface:toolbar"
        className="flex shrink-0 items-center gap-2 px-2 pb-1.5 empty:hidden"
      />

      <div data-ui="EditorSurface:documents" className="relative min-h-0 flex-1 overflow-hidden">
        {documents.length === 0 && empty}

        <DocumentActionsSlotContext value={slot}>
          <DocumentToolbarSlotContext value={toolbar}>
            {documents.map((document) => {
              const definition = definitionFor(document);
              if (!definition) return null;

              const Editor = definition.component;
              const active = document.id === activeId;

              return (
                <div
                  key={document.id}
                  data-ui={`EditorSurface:document:${document.kind}`}
                  hidden={!active}
                  className="absolute inset-0 flex flex-col"
                >
                  <Editor document={document} active={active} />
                </div>
              );
            })}
          </DocumentToolbarSlotContext>
        </DocumentActionsSlotContext>
      </div>

      <UnsavedCloseDialog
        title={pendingTitle()}
        onCancel={() => setPendingCloses([])}
        onDiscard={discardPending}
      />
    </div>
  );
}

interface UnsavedCloseDialogProps {
  /** The document being closed. Absent means the queue is empty. */
  title: string | undefined;
  /** Drops the whole queue, since one refusal answers for the batch. */
  onCancel: () => void;
  onDiscard: () => void;
}

function UnsavedCloseDialog({ title, onCancel, onDiscard }: UnsavedCloseDialogProps) {
  return (
    <Dialog.Root open={title !== undefined} onOpenChange={(open) => !open && onCancel()}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Overlay size="sm">
          <Dialog.Header>
            <Dialog.Title>Close without saving?</Dialog.Title>
            <Dialog.Close />
          </Dialog.Header>

          <Dialog.Body>
            <p className="text-sm text-surface-400">
              {title} has unsaved changes. Closing it now throws them away.
            </p>
          </Dialog.Body>

          <Dialog.Footer>
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="danger" onClick={onDiscard}>
              Discard changes
            </Button>
          </Dialog.Footer>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
