import { type KeyboardEvent, useState } from "react";

import { m } from "@/i18n";
import { twMerge } from "@/utils";

import { LINE_FIELD_CLASSES } from "../../bin/tree/components/AddLineFrame";

/** The name entry of an event: blank, the name of a copy of `copyOf`, an alias of `aliasOf`, or a rename of `renames`. */
export interface Naming {
  /** The event that the new event copies, or null for an event with no action. */
  readonly copyOf: number | null;
  /** The event that the new event aliases, or null for a copy or new event. */
  readonly aliasOf?: number | null;
  /** The event that the name renames, or null for a new event. */
  readonly renames?: number | null;
  readonly initial: string;
}

interface NewEventEntryProps {
  /** The open entry, or null while the press shows. */
  readonly naming: Naming | null;
  readonly onNaming: (naming: Naming | null) => void;
  /** Creates the event. Resolves false if the backend refused the name. */
  readonly onCommit: (name: string, naming: Naming) => Promise<boolean>;
}

/**
 * The name entry of an event in the toolbar row, which Insert - New event opens.
 *
 * Enter creates the event, whose ID is the hash of the name, and Escape or a press outside drops
 * the entry. A refused name keeps the entry open with the text. Duplicate on an event opens the
 * same entry, prefilled, and so does Rename. Draws nothing while `naming` is null. Per "New
 * objects" in docs/ux/AUDIO.md.
 */
export function NewEventEntry({ naming, onNaming, onCommit }: NewEventEntryProps) {
  if (naming === null) return null;

  return (
    <NameField
      key={`${naming.copyOf ?? "new"}:${naming.aliasOf ?? ""}:${naming.renames ?? ""}:${naming.initial}`}
      naming={naming}
      onClose={() => onNaming(null)}
      onCommit={onCommit}
    />
  );
}

interface NameFieldProps {
  readonly naming: Naming;
  readonly onClose: () => void;
  readonly onCommit: (name: string, naming: Naming) => Promise<boolean>;
}

function NameField({ naming, onClose, onCommit }: NameFieldProps) {
  const [text, setText] = useState(naming.initial);
  const [refused, setRefused] = useState(false);

  function commit() {
    const name = text.trim();
    if (name === "") {
      onClose();
      return;
    }

    void onCommit(name, naming).then((created) => {
      if (created) onClose();
      else setRefused(true);
    });
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  return (
    <input
      autoFocus
      data-draft
      aria-label={
        naming.renames == null ? m.audio_events_new_label() : m.audio_events_rename_label()
      }
      aria-invalid={refused}
      placeholder={m.audio_events_new_placeholder()}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        setRefused(false);
      }}
      onKeyDown={keyDown}
      onBlur={onClose}
      onFocus={(event) => event.currentTarget.select()}
      className={twMerge(
        LINE_FIELD_CLASSES,
        "w-64 shrink-0 font-sans text-row",
        refused && "border-danger focus:border-danger",
      )}
    />
  );
}
