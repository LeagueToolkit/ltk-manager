import { useQuery } from "@tanstack/react-query";
import { type RefObject, use, useEffect, useMemo, useRef, useState } from "react";

import { Combobox } from "@/components";
import { m } from "@/i18n";
import type { AppError } from "@/lib/tauri";
import { twMerge } from "@/utils";

import { binQueries } from "../../documents/hooks/useBinDocument";
import { type BinEdit, BinEditContext } from "../hooks/useBinEdit";
import {
  type ClassSuggestion,
  classLabel,
  classSuggestions,
  classWire,
  typedKey,
} from "../utils/addItem";
import { type AddLine, holdsClass, type LineTarget } from "../utils/binRows";
import { AddLineFrame, LINE_FIELD_CLASSES } from "./AddLineFrame";

interface AddItemLineProps {
  line: AddLine;
  /** The line takes focus as it draws, after a row's action asked for it. */
  autoFocus: boolean;
}

/**
 * The line under an editable list, map, absent option or null pointer, where an item goes in.
 *
 * "Editing a list, a map, an option and a pointer" in docs/ux/BIN_EDITOR.md. An item of a
 * leaf kind needs nothing typed, a map entry takes its key, and a struct takes its class.
 */
export function AddItemLine({ line, autoFocus }: AddItemLineProps) {
  const edit = use(BinEditContext);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const { target } = line;
  if (
    edit === null ||
    target.kind === "property" ||
    target.kind === "object" ||
    target.kind === "dependency"
  ) {
    return null;
  }

  const inserting = edit;
  async function send(text: string): Promise<boolean> {
    if (pending) return false;
    setPending(true);
    setError(null);
    const result = await inserting.insert(line, text);
    setPending(false);
    if (!result.ok) setError(result.error);
    return result.ok;
  }
  const props: FieldProps = { line, edit, autoFocus, error, send, onType: () => setError(null) };
  const takes = fieldOf(target);

  return (
    <AddLineFrame line={line} pending={pending} error={error}>
      {takes === "key" && <KeyField {...props} />}
      {takes === "class" && <ClassField {...props} />}
      {takes === "press" && <PressField {...props} />}
    </AddLineFrame>
  );
}

/** What a line is typed or pressed in: a key, a class, or nothing for a leaf item. */
function fieldOf(
  target: Exclude<LineTarget, { kind: "property" } | { kind: "object" } | { kind: "dependency" }>,
): "key" | "class" | "press" {
  if (target.kind === "entry") return "key";
  if (target.kind === "pointer") return "class";
  return holdsClass(target.itemKind) ? "class" : "press";
}

interface FieldProps {
  line: AddLine;
  edit: BinEdit;
  autoFocus: boolean;
  error: AppError | null;
  /** Send the text, answering whether the item went in. */
  send: (text: string) => Promise<boolean>;
  /** The reader typed, which clears a refusal. */
  onType: () => void;
}

/** What the line reads as before anything is typed. */
function lineLabel(line: AddLine): string {
  switch (line.target.kind) {
    case "entry":
      return m.workshop_bin_add_entry_action();
    case "option":
      return m.workshop_bin_set_value_action();
    case "pointer":
      return m.workshop_bin_set_class_action();
    default:
      return m.workshop_bin_add_item_action();
  }
}

/* A line already drawn takes focus on request too, which autoFocus on mount does not. */
function useFocusOnRequest(
  ref: RefObject<HTMLElement | null>,
  autoFocus: boolean,
  edit: BinEdit,
): void {
  useEffect(() => {
    if (!autoFocus) return;
    ref.current?.focus();
    edit.settleFocus();
  }, [autoFocus, edit, ref]);
}

/** Escape on an insert line closes it, since nothing lands there. */
function closesOnEscape(line: AddLine, edit: BinEdit, text: string): boolean {
  if (text !== "" || line.index === null) return false;
  edit.closeInsert();
  return true;
}

/** An item of a leaf kind, which goes in on a press at its kind's zero. */
function PressField({ line, edit, autoFocus, send }: FieldProps) {
  const ref = useRef<HTMLButtonElement>(null);
  useFocusOnRequest(ref, autoFocus, edit);
  const label = lineLabel(line);

  return (
    <button
      ref={ref}
      type="button"
      className={twMerge(LINE_FIELD_CLASSES, "w-auto cursor-pointer text-left text-surface-400")}
      onClick={() => void send("")}
      onKeyDown={(event) => {
        if (event.key === "Escape" && closesOnEscape(line, edit, "")) event.preventDefault();
      }}
    >
      {label}
    </button>
  );
}

/** A map entry, which goes in under the key typed. */
function KeyField({ line, edit, autoFocus, error, send, onType }: FieldProps) {
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  useFocusOnRequest(ref, autoFocus, edit);
  const label = lineLabel(line);

  return (
    <input
      ref={ref}
      type="text"
      value={text}
      data-draft={text !== "" || undefined}
      placeholder={label}
      aria-label={label}
      aria-invalid={error !== null || undefined}
      spellCheck={false}
      autoComplete="off"
      className={twMerge(LINE_FIELD_CLASSES, error !== null && "border-danger")}
      onChange={(event) => {
        setText(event.target.value);
        onType();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && text.trim() !== "") {
          event.preventDefault();
          void send(typedKey(text)).then((added) => added && setText(""));
        }
        if (event.key === "Escape" && (text !== "" || closesOnEscape(line, edit, text))) {
          event.preventDefault();
          setText("");
        }
      }}
      onBlur={() => {
        if (text === "" && line.index !== null) edit.closeInsert();
      }}
    />
  );
}

/** A struct item, an option's struct or a pointer, which goes in as the class picked. */
function ClassField({ line, edit, autoFocus, error, send, onType }: FieldProps) {
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  useFocusOnRequest(ref, autoFocus, edit);
  const label = lineLabel(line);

  const classes = useQuery({
    ...binQueries.itemClasses(line.document, line.entry, line.path),
    enabled: open || text !== "" || autoFocus,
  });
  const suggestions = useMemo(
    () => classSuggestions(classes.data ?? [], text),
    [classes.data, text],
  );

  function pick(suggestion: ClassSuggestion | null) {
    if (suggestion === null) return;
    void send(classWire(suggestion)).then((added) => added && setText(""));
  }

  return (
    <Combobox.Root<ClassSuggestion>
      items={suggestions}
      inputValue={text}
      onInputValueChange={(next, details) => {
        if (details.reason === "input-clear" || details.reason === "none") return;
        setText(next);
        onType();
      }}
      onValueChange={pick}
      open={open && suggestions.length > 0}
      onOpenChange={setOpen}
      filter={() => true}
      autoHighlight
      itemToStringLabel={classLabel}
      itemToStringValue={classLabel}
    >
      <Combobox.Input
        ref={ref}
        data-draft={text !== "" || undefined}
        placeholder={label}
        aria-label={label}
        aria-invalid={error !== null || undefined}
        spellCheck={false}
        autoComplete="off"
        className={twMerge(LINE_FIELD_CLASSES, error !== null && "border-danger")}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          if (text === "" && !closesOnEscape(line, edit, text)) return;
          event.preventDefault();
          setText("");
        }}
      />
      <Combobox.Portal>
        <Combobox.Positioner side="bottom" align="start" sideOffset={2}>
          <Combobox.Popup className="max-h-64 min-w-80 py-0.5">
            <Combobox.List>
              {(suggestion: ClassSuggestion) => (
                <Combobox.Item
                  key={
                    suggestion.kind === "choice"
                      ? suggestion.choice.hash
                      : `typed:${suggestion.text}`
                  }
                  value={suggestion}
                  className="gap-2 px-2 py-1 font-mono text-mono-row"
                >
                  <ClassText suggestion={suggestion} />
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}

/** A class suggestion as a line of a class list: its name, and whether the file holds it. */
export function ClassText({ suggestion }: { suggestion: ClassSuggestion }) {
  let note: string | null = null;
  if (suggestion.kind === "typed") note = m.workshop_bin_class_typed_label();
  else if (suggestion.choice.held) note = m.workshop_bin_class_held_label();
  else if (suggestion.choice.derivesFrom !== null) {
    note = m.workshop_bin_class_derived_label({ class: suggestion.choice.derivesFrom });
  }
  const unnamed = suggestion.kind === "choice" && suggestion.choice.name === null;

  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span className={twMerge("truncate text-surface-100", unnamed && "text-surface-300")}>
        {classLabel(suggestion)}
      </span>
      {note !== null && <span className="ml-auto shrink-0 text-meta text-surface-400">{note}</span>}
    </span>
  );
}
