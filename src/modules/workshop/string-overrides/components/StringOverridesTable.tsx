import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { type ReactNode, useRef, useState } from "react";

import { IconButton, TextareaField, Tooltip } from "@/components";
import type { StringKeySuggestion } from "@/lib/tauri";
import { twMerge } from "@/utils";

import type { OverrideEntry, OverrideEntryField } from "../types";
import { StringKeyField } from "./StringKeyField";

interface StringOverridesTableProps {
  /** The rows to show, already filtered by the document. */
  entries: OverrideEntry[];
  /** Current in-game text by key, for the line beneath each replacement. */
  originals: Record<string, string>;
  errors: Record<string, string>;
  /** Shown under the composer when `entries` is empty. */
  emptyState: ReactNode;
  onCommitEntry: (key: string, value: string) => void;
  onUpdateEntry: (id: string, field: OverrideEntryField, value: string) => void;
  onPickSuggestion: (id: string, suggestion: StringKeySuggestion) => void;
  onRemoveEntry: (id: string) => void;
  className?: string;
}

/**
 * The override list: a composer on top, then one full-width row per entry.
 *
 * Rows stack key over replacement over original rather than sharing columns,
 * because the values are prose - an item description wants the panel's whole
 * width and as many lines as it takes, which no column can give it. A click
 * turns the key or the replacement into its input in place, and new rows only
 * ever enter whole, through the composer.
 */
export function StringOverridesTable({
  entries,
  originals,
  errors,
  emptyState,
  onCommitEntry,
  onUpdateEntry,
  onPickSuggestion,
  onRemoveEntry,
  className,
}: StringOverridesTableProps) {
  return (
    <div
      className={twMerge(
        "flex flex-col overflow-hidden rounded-xl border border-surface-700 bg-surface-800/40",
        className,
      )}
    >
      <ComposerRow onCommit={onCommitEntry} />

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-md">
        {entries.length === 0 && emptyState}
        {entries.length > 0 && (
          <ul className="flex flex-col">
            {entries.map((entry) => (
              <OverrideRow
                key={entry.id}
                entry={entry}
                original={originals[entry.key]}
                error={errors[entry.id]}
                onUpdate={onUpdateEntry}
                onPick={onPickSuggestion}
                onRemove={onRemoveEntry}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

interface ComposerRowProps {
  onCommit: (key: string, value: string) => void;
}

/**
 * The one place a new override starts: pick a field, type the replacement.
 *
 * Picking a suggestion prefills the replacement with the current in-game text
 * and selects it, so the author types over what the game says today.
 * Committing hands the row to the list below and returns focus to the key
 * box, so entering several overrides is pick, type, Enter, repeat.
 */
function ComposerRow({ onCommit }: ComposerRowProps) {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const keyRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef<HTMLTextAreaElement>(null);

  function commit() {
    if (!key.trim()) return;
    onCommit(key, value);
    setKey("");
    setValue("");
    keyRef.current?.focus();
  }

  return (
    <div className="flex items-start gap-2 border-b border-surface-700 px-3 py-2">
      <div className="flex w-2/5 shrink-0">
        <StringKeyField
          value={key}
          inputRef={keyRef}
          placeholder="Add an override - field name or in-game text"
          onChange={setKey}
          onPick={(suggestion) => {
            setKey(suggestion.key);
            if (!value) setValue(suggestion.value ?? "");
            /* The prefilled value renders next frame, and select() before
               that grabs the field's previous text. */
            requestAnimationFrame(() => {
              valueRef.current?.focus();
              valueRef.current?.select();
            });
          }}
          onKeyDown={(event) => {
            /* With the popup open, Enter is Base UI's pick. Closed, it walks
               a free-text key (e.g. a hash) on to the replacement. */
            if (event.key === "Enter" && !event.defaultPrevented) {
              event.preventDefault();
              valueRef.current?.focus();
            }
          }}
        />
      </div>
      <TextareaField
        ref={valueRef}
        className="min-w-0 flex-1"
        textareaClassName={GROWING_TEXTAREA}
        rows={1}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            commit();
          }
        }}
        placeholder="Replacement text"
      />
      <Tooltip content="Add override">
        <IconButton
          icon={<PlusIcon weight="bold" className="h-4 w-4" />}
          variant="ghost"
          size="sm"
          disabled={!key.trim()}
          onClick={commit}
          aria-label="Add override"
        />
      </Tooltip>
    </div>
  );
}

/* Grows with its content from one input-sized line, so a short value reads as
   a field and a long one never scrolls inside itself. Enter commits, and
   Shift+Enter is the newline. The padding makes one text-sm line plus borders
   exactly min-h-8, because a textarea top-aligns whatever slack is left. */
const GROWING_TEXTAREA = "field-sizing-content min-h-8 resize-none px-4 py-[5px]";

interface OverrideRowProps {
  entry: OverrideEntry;
  original: string | undefined;
  error: string | undefined;
  onUpdate: (id: string, field: OverrideEntryField, value: string) => void;
  onPick: (id: string, suggestion: StringKeySuggestion) => void;
  onRemove: (id: string) => void;
}

function OverrideRow({ entry, original, error, onUpdate, onPick, onRemove }: OverrideRowProps) {
  return (
    <li className="group flex flex-col gap-0.5 border-b border-surface-700/40 px-3 py-2 last:border-b-0">
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <KeyCell entry={entry} error={error} onUpdate={onUpdate} onPick={onPick} />
        </div>
        <Tooltip content="Delete override">
          <IconButton
            icon={<TrashIcon className="h-4 w-4" />}
            variant="ghost"
            size="xs"
            compact
            onClick={() => onRemove(entry.id)}
            aria-label={`Delete the ${entry.key} override`}
            className="shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          />
        </Tooltip>
      </div>
      <ValueCell entry={entry} original={original} onUpdate={onUpdate} />
    </li>
  );
}

/* Reading, until clicked: the veil says "editable" without drawing a box.
   DS-VEIL. */
const READ_BUTTON =
  "-ml-1.5 cursor-text rounded-sm px-1.5 py-0.5 text-left outline-none transition-colors hover:bg-surface-veil focus-visible:ring-1 focus-visible:ring-accent-500";

interface KeyCellProps {
  entry: OverrideEntry;
  error: string | undefined;
  onUpdate: (id: string, field: OverrideEntryField, value: string) => void;
  onPick: (id: string, suggestion: StringKeySuggestion) => void;
}

function KeyCell({ entry, error, onUpdate, onPick }: KeyCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [popupOpen, setPopupOpen] = useState(false);
  const readRef = useRef<HTMLButtonElement>(null);

  function startEdit() {
    setDraft(entry.key);
    setEditing(true);
  }

  function close(refocus: boolean) {
    setEditing(false);
    /* The read button only exists after this render commits. */
    if (refocus) requestAnimationFrame(() => readRef.current?.focus());
  }

  function commit(refocus: boolean) {
    onUpdate(entry.id, "key", draft.trim());
    close(refocus);
  }

  if (!editing) {
    return (
      <>
        <button
          ref={readRef}
          type="button"
          onClick={startEdit}
          className={twMerge(
            READ_BUTTON,
            "max-w-full self-start truncate font-mono text-xs text-surface-300",
          )}
        >
          {entry.key}
        </button>
        {error && <p className="pt-0.5 text-xs text-danger-text">{error}</p>}
      </>
    );
  }

  return (
    <StringKeyField
      value={draft}
      error={error}
      autoFocus
      onChange={setDraft}
      onOpenChange={setPopupOpen}
      onPick={(suggestion) => {
        onPick(entry.id, suggestion);
        close(true);
      }}
      onKeyDown={(event) => {
        if (event.defaultPrevented) return;
        if (event.key === "Enter") commit(true);
        if (event.key === "Escape" && !popupOpen) close(true);
      }}
      onBlur={() => {
        /* A blur into the suggestion popup is not the edit ending. */
        if (!popupOpen) commit(false);
      }}
    />
  );
}

interface ValueCellProps {
  entry: OverrideEntry;
  original: string | undefined;
  onUpdate: (id: string, field: OverrideEntryField, value: string) => void;
}

function ValueCell({ entry, original, onUpdate }: ValueCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const readRef = useRef<HTMLButtonElement>(null);

  const showOriginal = original !== undefined && original !== entry.value;

  function startEdit() {
    setDraft(entry.value);
    setEditing(true);
  }

  function close(refocus: boolean) {
    setEditing(false);
    if (refocus) requestAnimationFrame(() => readRef.current?.focus());
  }

  function commit(refocus: boolean) {
    onUpdate(entry.id, "value", draft);
    close(refocus);
  }

  if (!editing) {
    return (
      <>
        <button
          ref={readRef}
          type="button"
          onClick={startEdit}
          className={twMerge(
            READ_BUTTON,
            "w-full text-sm break-words whitespace-pre-wrap text-surface-100",
          )}
        >
          {entry.value || <span className="text-surface-500 italic">empty</span>}
        </button>
        {showOriginal && (
          /* Two lines locate the string; the full text is a click away, shown
             uncut beside the edit. */
          <p className="line-clamp-2 text-xs break-words text-surface-500">was: {original}</p>
        )}
      </>
    );
  }

  return (
    <>
      <TextareaField
        textareaClassName={twMerge(GROWING_TEXTAREA, "px-2.5")}
        rows={1}
        value={draft}
        autoFocus
        onFocus={(event) => event.target.select()}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            commit(true);
          }
          if (event.key === "Escape") close(true);
        }}
        onBlur={() => commit(false)}
      />
      {showOriginal && (
        <p className="text-xs break-words whitespace-pre-wrap text-surface-500">was: {original}</p>
      )}
    </>
  );
}
