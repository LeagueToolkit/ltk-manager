import { TranslateIcon } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";

import { Button } from "@/components";
import type { EditorDocumentProps } from "@/modules/editor";

import { useProjectContext } from "../components/ProjectContext";
import { useSetDocumentDirty } from "../state";
import {
  StringOverridesEmptyState,
  StringOverridesHelpPopover,
  StringOverridesTable,
  StringOverridesToolbar,
  useStringOverridesEditor,
} from "../string-overrides";
import { type ContentDocumentOf, layerTitle } from "./contentDocument";

/** One layer's string overrides for one locale. */
export function StringsDocument({
  document,
  active,
}: EditorDocumentProps<ContentDocumentOf<"strings">>) {
  const project = useProjectContext();
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
  const countLabel = count === 1 ? "1 override" : `${count} overrides`;

  return (
    <div data-ui="StringsDocument" className="flex min-h-0 flex-1 flex-col bg-surface-950">
      <div
        data-ui="StringsDocument:band"
        className="flex min-h-9 items-center justify-between gap-3 pr-1.5 pl-3"
      >
        <div className="flex min-w-0 items-center gap-2">
          <TranslateIcon className="h-3.5 w-3.5 shrink-0 text-surface-400" />
          <span className="font-mono text-sm font-medium text-surface-200">{locale}</span>
          <span className="truncate text-xs text-surface-400">
            {layerTitle(project, document.layerName)} · {countLabel}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <StringOverridesToolbar
            filter={editor.filter}
            onFilterChange={editor.setFilter}
            onAdd={editor.addEntry}
          />
          <StringOverridesHelpPopover />
          {editor.hasChanges && (
            <Button variant="ghost" size="sm" compact onClick={editor.discard}>
              Discard
            </Button>
          )}
          <Button
            variant="filled"
            size="sm"
            compact
            onClick={editor.save}
            disabled={!editor.hasChanges}
            loading={editor.isSaving}
          >
            Save
          </Button>
        </div>
      </div>

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
