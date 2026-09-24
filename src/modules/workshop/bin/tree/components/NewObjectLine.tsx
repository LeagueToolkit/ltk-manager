import { useQuery } from "@tanstack/react-query";
import { use, useEffect, useMemo, useRef, useState } from "react";

import { Combobox } from "@/components";
import { errorSummary, m } from "@/i18n";
import { type AppError, api, type BinDocumentId, type NewObject } from "@/lib/tauri";
import { twMerge } from "@/utils";

import { useOptionalProjectContext } from "../../../projects/state/ProjectContext";
import { binQueries } from "../../documents/hooks/useBinDocument";
import { useDocumentCall } from "../../documents/hooks/useDocumentCall";
import { useInvalidateBinReads } from "../hooks/useBinEdit";
import { NewObjectContext, type ObjectDraft } from "../state/newObject";
import { type ClassSuggestion, classLabel, classSuggestions, classWire } from "../utils/addItem";
import type { AddLine } from "../utils/binRows";
import { ClassText } from "./AddItemLine";
import { AddLineFrame, LINE_FIELD_CLASSES } from "./AddLineFrame";

/** The most classes the class list draws at once. The schema knows thousands. */
const CLASS_LIMIT = 200;

/** The folder a new object's suggested name starts in when no project is open. */
const NO_MOD = "mod";

interface NewObjectLineProps {
  line: AddLine;
  draft: ObjectDraft;
}

/** A class the reader picked for a new object: what is sent, and what the name takes from it. */
interface PickedClass {
  readonly wire: string;
  readonly label: string;
}

/**
 * The line after a declared file's objects where a new object is named. ADR-0049.
 *
 * A copy goes straight to its name. A new object of a class picks the class first, from the
 * classes the file holds and then every class the schema knows. The name starts as
 * `Mods/<mod>/<source or class>`, the prefix the game-data reference suggests, with the caret
 * at its end. Enter declares it, Escape steps back, and a refusal stays on the line under the
 * name. "Declaring from a game bin" in docs/ux/BIN_EDITOR.md.
 */
export function NewObjectLine({ line, draft }: NewObjectLineProps) {
  const drafts = use(NewObjectContext);
  const project = useOptionalProjectContext();
  const invalidate = useInvalidateBinReads();
  const call = useDocumentCall(line.document);
  const [picked, setPicked] = useState<PickedClass | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  const origin = originOf(draft, picked);
  const folder = `Mods/${project?.name ?? NO_MOD}/`;
  const suggested = `${folder}${draft.kind === "clone" ? leafOf(draft.source.name) : (picked?.label ?? "")}`;

  async function create(name: string) {
    if (origin === null || pending) return;
    setPending(true);
    setError(null);
    const { result } = await call((id) =>
      api.bin.edit(id, { kind: "object", edit: { kind: "create", name, origin } }),
    );
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    invalidate();
    drafts?.close();
  }

  function back() {
    setError(null);
    if (draft.kind === "class" && picked !== null) setPicked(null);
    else drafts?.close();
  }

  return (
    <AddLineFrame line={line} pending={pending} error={null}>
      {origin === null && (
        <ClassPicker document={line.document} onPick={setPicked} onEscape={back} />
      )}
      {origin !== null && (
        <NameField
          key={suggested}
          suggested={suggested}
          invalid={error !== null}
          onType={() => setError(null)}
          onCommit={(name) => void create(name)}
          onEscape={back}
        />
      )}
      {error !== null && (
        <span role="alert" className="min-w-0 truncate text-meta text-danger-text">
          {errorSummary(error)}
        </span>
      )}
    </AddLineFrame>
  );
}

/** What the backend makes the object from, or null while its class is still to pick. */
function originOf(draft: ObjectDraft, picked: PickedClass | null): NewObject | null {
  if (draft.kind === "clone") return { type: "clone", source: draft.source.entry };
  return picked === null ? null : { type: "class", class: picked.wire };
}

/** The last segment of an object's path, which a copy's suggested name ends in. */
function leafOf(name: string): string {
  return name.slice(name.lastIndexOf("/") + 1);
}

interface NameFieldProps {
  suggested: string;
  invalid: boolean;
  onType: () => void;
  onCommit: (name: string) => void;
  onEscape: () => void;
}

/** The name of the new object, focused with the caret after the suggestion. */
function NameField({ suggested, invalid, onType, onCommit, onEscape }: NameFieldProps) {
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(suggested);
  const label = m.workshop_bin_new_object_name_label();

  useEffect(() => {
    const input = ref.current;
    if (input === null) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, []);

  return (
    <input
      ref={ref}
      type="text"
      value={text}
      aria-label={label}
      placeholder={label}
      aria-invalid={invalid || undefined}
      spellCheck={false}
      autoComplete="off"
      className={twMerge(LINE_FIELD_CLASSES, invalid && "border-danger")}
      onChange={(event) => {
        setText(event.target.value);
        onType();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && text.trim() !== "") {
          event.preventDefault();
          onCommit(text.trim());
        }
        if (event.key === "Escape") {
          event.preventDefault();
          onEscape();
        }
      }}
    />
  );
}

interface ClassPickerProps {
  document: BinDocumentId;
  onPick: (picked: PickedClass) => void;
  onEscape: () => void;
}

/** The class of a new object, searched over the file's classes and the schema's. */
function ClassPicker({ document, onPick, onEscape }: ClassPickerProps) {
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(true);
  const label = m.workshop_bin_new_object_class_label();

  const classes = useQuery(binQueries.objectClasses(document));
  const suggestions = useMemo(
    () => limited(classSuggestions(classes.data ?? [], text)),
    [classes.data, text],
  );

  useEffect(() => {
    ref.current?.focus();
  }, []);

  function pick(suggestion: ClassSuggestion | null) {
    if (suggestion === null) return;
    onPick({ wire: classWire(suggestion), label: classLabel(suggestion) });
  }

  return (
    <Combobox.Root<ClassSuggestion>
      items={suggestions}
      inputValue={text}
      onInputValueChange={(next, details) => {
        if (details.reason === "input-clear" || details.reason === "none") return;
        setText(next);
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
        placeholder={label}
        aria-label={label}
        spellCheck={false}
        autoComplete="off"
        className={LINE_FIELD_CLASSES}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          if (text === "") onEscape();
          else setText("");
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

/** The first classes of a list, with the typed text kept where it was offered. */
function limited(suggestions: readonly ClassSuggestion[]): ClassSuggestion[] {
  const choices = suggestions.filter((suggestion) => suggestion.kind === "choice");
  const typed = suggestions.filter((suggestion) => suggestion.kind === "typed");
  return [...choices.slice(0, CLASS_LIMIT), ...typed];
}
