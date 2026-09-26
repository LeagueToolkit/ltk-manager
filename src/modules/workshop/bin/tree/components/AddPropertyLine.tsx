import { useQuery } from "@tanstack/react-query";
import { use, useEffect, useMemo, useRef, useState } from "react";

import { Combobox } from "@/components";
import { m } from "@/i18n";
import type { AppError } from "@/lib/tauri";
import { twMerge } from "@/utils";

import { binQueries } from "../../documents/hooks/useBinDocument";
import { shapeTag } from "../../values/utils/kindTag";
import { BinEditContext } from "../hooks/useBinEdit";
import { type AddSuggestion, shapeOf, suggestionLabel, suggestionsFor } from "../utils/addProperty";
import type { AddLine } from "../utils/binRows";
import { AddLineFrame, LINE_FIELD_CLASSES } from "./AddLineFrame";

interface AddPropertyLineProps {
  line: AddLine;
  /** The line takes focus as it draws, after a holder's add action asked for it. */
  autoFocus: boolean;
}

/**
 * The last line under an editable holder, where a property is typed in.
 *
 * "What an edit is" in docs/ux/BIN_EDITOR.md. The declared fields of the holder's class
 * are suggested as the text narrows, and a field typed as `name: kind` adds as written.
 * The line clears and keeps focus after an add, so a run of fields types straight through.
 */
export function AddPropertyLine({ line, autoFocus }: AddPropertyLineProps) {
  const edit = use(BinEditContext);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /* A line already drawn takes focus on request too, which autoFocus on mount does not. */
  useEffect(() => {
    if (!autoFocus) return;
    inputRef.current?.focus();
    edit?.settleFocus();
  }, [autoFocus, edit]);

  const addable = useQuery({
    ...binQueries.addable(line.document, line.entry, line.path),
    enabled: open || text !== "",
  });
  const suggestions = useMemo(
    () => suggestionsFor(addable.data?.fields ?? [], text),
    [addable.data, text],
  );

  if (edit === null) return null;
  const add = edit.add;

  function pick(suggestion: AddSuggestion | null) {
    if (suggestion === null || pending) return;
    setPending(true);
    setError(null);
    void add(line, suggestion).then((result) => {
      setPending(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setText("");
    });
  }

  const label = m.workshop_bin_add_property_placeholder();

  return (
    <AddLineFrame line={line} pending={pending} error={error}>
      <Combobox.Root<AddSuggestion>
        items={suggestions}
        inputValue={text}
        onInputValueChange={(next, details) => {
          if (details.reason === "input-clear" || details.reason === "none") return;
          setText(next);
          setError(null);
        }}
        onValueChange={pick}
        open={open && suggestions.length > 0}
        onOpenChange={setOpen}
        filter={() => true}
        autoHighlight
        itemToStringLabel={suggestionLabel}
        itemToStringValue={suggestionLabel}
      >
        <Combobox.Input
          ref={inputRef}
          data-draft={text !== "" || undefined}
          placeholder={label}
          aria-label={label}
          aria-invalid={error !== null || undefined}
          spellCheck={false}
          autoComplete="off"
          className={twMerge(LINE_FIELD_CLASSES, error !== null && "border-danger")}
          onKeyDown={(event) => {
            if (event.key === "Escape" && text !== "") {
              event.preventDefault();
              setText("");
            }
          }}
        />
        <Combobox.Portal>
          <Combobox.Positioner side="bottom" align="start" sideOffset={2}>
            <Combobox.Popup className="max-h-64 min-w-80 py-0.5">
              <Combobox.List>
                {(suggestion: AddSuggestion) => (
                  <Combobox.Item
                    key={suggestionKey(suggestion)}
                    value={suggestion}
                    className="gap-2 px-2 py-1 font-mono text-mono-row"
                  >
                    <SuggestionText suggestion={suggestion} />
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
      {addable.isSuccess && addable.data.fields.length === 0 && text === "" && (
        <span className="shrink-0 text-meta text-surface-400 select-none">
          {m.workshop_bin_add_property_typed_hint()}
        </span>
      )}
    </AddLineFrame>
  );
}

function suggestionKey(suggestion: AddSuggestion): string {
  return suggestion.kind === "declared" ? suggestion.field.hash : `custom:${suggestion.field}`;
}

function SuggestionText({ suggestion }: { suggestion: AddSuggestion }) {
  if (suggestion.kind === "custom") {
    return (
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate text-surface-100">{suggestion.field}</span>
        {/* DS-KIND-HUE */}
        <span className="shrink-0 text-bin-kind-text">{shapeTag(shapeOf(suggestion))}</span>
        {suggestion.class !== null && (
          <span className="truncate text-surface-400">{suggestion.class}</span>
        )}
        <span className="ml-auto shrink-0 text-meta text-surface-400">
          {m.workshop_bin_add_property_typed_label()}
        </span>
      </span>
    );
  }

  const { field } = suggestion;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span
        className={twMerge("truncate text-surface-100", field.name === null && "text-surface-300")}
      >
        {field.name ?? field.hash}
      </span>
      {/* DS-KIND-HUE */}
      <span className="shrink-0 text-bin-kind-text">{shapeTag(shapeOf(suggestion))}</span>
      {field.class !== null && <span className="truncate text-surface-400">{field.class}</span>}
      {field.inheritedFrom !== null && (
        <span className="ml-auto shrink-0 text-meta text-surface-400">
          {m.workshop_bin_add_property_inherited_label({ class: field.inheritedFrom })}
        </span>
      )}
    </span>
  );
}
