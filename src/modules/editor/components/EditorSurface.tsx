import { type ReactNode, useCallback, useMemo, useState } from "react";
import { twMerge } from "tailwind-merge";

import { Button, Dialog } from "@/components";

import type { EditorDocumentBase, EditorDocumentDefinition, EditorRegistry } from "../types";
import { DocumentActionsSlotContext } from "./DocumentActions";
import { EditorTabs } from "./EditorTabs";

export interface EditorSurfaceProps<D extends EditorDocumentBase> {
  /** The leaf this surface draws, which the strip scopes its drag ids by. */
  leafId: string;
  documents: readonly D[];
  activeId: string | null;
  registry: EditorRegistry<D>;
  /** Documents whose editor has reported unsaved edits. */
  dirtyIds: ReadonlySet<string>;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  /** The keyboard route to a split, offered from a tab's context menu. */
  onSplit?: (id: string, edge: "right" | "bottom") => void;
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
  onActivate,
  onClose,
  onSplit,
  onFocus,
  focused,
  empty,
  className,
}: EditorSurfaceProps<D>) {
  const [pendingClose, setPendingClose] = useState<D | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);

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
          },
        ];
      }),
    [documents, definitionFor, dirtyIds],
  );

  const requestClose = useCallback(
    (id: string) => {
      const document = documents.find((candidate) => candidate.id === id);
      if (document && dirtyIds.has(id)) {
        setPendingClose(document);
        return;
      }

      onClose(id);
    },
    [documents, dirtyIds, onClose],
  );

  function confirmClose() {
    if (!pendingClose) return;
    onClose(pendingClose.id);
    setPendingClose(null);
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
        onClose={requestClose}
        onSplit={onSplit}
        focused={focused}
        actions={
          <div
            ref={setSlot}
            data-ui="EditorSurface:actions"
            className="flex items-center gap-1.5"
          />
        }
      />

      <div data-ui="EditorSurface:documents" className="relative min-h-0 flex-1 overflow-hidden">
        {documents.length === 0 && empty}

        <DocumentActionsSlotContext value={slot}>
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
        </DocumentActionsSlotContext>
      </div>

      <UnsavedCloseDialog
        title={pendingClose ? definitionFor(pendingClose)?.label(pendingClose).title : undefined}
        onCancel={() => setPendingClose(null)}
        onDiscard={confirmClose}
      />
    </div>
  );
}

interface UnsavedCloseDialogProps {
  /** The document being closed. Absent means nothing is pending. */
  title: string | undefined;
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
