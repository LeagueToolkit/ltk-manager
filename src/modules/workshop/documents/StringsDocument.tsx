import { useEffect, useRef } from "react";

import { Button } from "@/components";
import { DocumentActions, type EditorDocumentProps } from "@/modules/editor";

import { useSetDocumentDirty } from "../state";
import {
  StringOverridesEmptyState,
  StringOverridesHelpPopover,
  StringOverridesTable,
  StringOverridesToolbar,
  useStringOverridesEditor,
} from "../string-overrides";
import type { ContentDocumentOf } from "./contentDocument";

/** One layer's string overrides for one locale. */
export function StringsDocument({
  document,
  active,
}: EditorDocumentProps<ContentDocumentOf<"strings">>) {
  const locale = document.locale;
  const editor = useStringOverridesEditor(document.layerName, locale);
  const setDocumentDirty = useSetDocumentDirty();

  const documentId = document.id;
  const hasChanges = editor.hasChanges;

  useEffect(() => {
    setDocumentDirty(documentId, hasChanges);
  }, [documentId, hasChanges, setDocumentDirty]);

  useEffect(() => {
    return () => setDocumentDirty(documentId, false);
  }, [documentId, setDocumentDirty]);

  const save = useRef(editor.save);
  useEffect(() => {
    save.current = editor.save;
  });

  useEffect(() => {
    if (!active) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.key.toLowerCase() !== "s") return;

      event.preventDefault();
      save.current();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active]);

  const count = editor.entries.length;

  return (
    <div data-ui="StringsDocument" className="flex min-h-0 flex-1 flex-col bg-surface-950">
      <DocumentActions active={active}>
        <StringOverridesToolbar
          filter={editor.filter}
          onFilterChange={editor.setFilter}
          onAdd={editor.addEntry}
        />
        <StringOverridesHelpPopover />
        {editor.hasChanges && (
          <Button variant="ghost" size="xs" compact onClick={editor.discard}>
            Discard
          </Button>
        )}
        <Button
          variant="filled"
          size="xs"
          compact
          onClick={editor.save}
          disabled={!editor.hasChanges}
          loading={editor.isSaving}
        >
          Save
        </Button>
      </DocumentActions>

      <div className="min-h-0 flex-1 overflow-hidden p-3">
        {count === 0 && <StringOverridesEmptyState onAdd={editor.addEntry} />}
        {count > 0 && (
          <StringOverridesTable
            entries={editor.entries}
            errors={editor.errors}
            filter={editor.filter}
            pendingFocusId={editor.pendingFocusId}
            onClearFilter={() => editor.setFilter("")}
            onFocusHandled={editor.clearPendingFocus}
            onUpdateEntry={editor.updateEntry}
            onPickSuggestion={editor.pickSuggestion}
            onRemoveEntry={editor.removeEntry}
            className="flex h-full flex-col"
            scrollClassName="min-h-0 flex-1"
          />
        )}
      </div>
    </div>
  );
}
