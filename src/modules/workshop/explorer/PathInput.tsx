import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Field } from "@/components";
import { m } from "@/i18n";
import { twMerge } from "@/utils";

import { parentLocation } from "./location";

/** Completions offered at once, which is what fits under the bar without a scroll. */
const MAX_COMPLETIONS = 8;

export interface PathInputProps {
  location: string;
  /**
   * The directories under a path, which complete the segment being typed.
   *
   * A hook, because the game index answers this from a query while an archive
   * answers it from the listings it already holds.
   */
  useCompletions: (directory: string) => readonly string[];
  onCommit: (path: string) => void;
  onCancel: () => void;
}

/**
 * The location as a string, for a modder who is holding one.
 *
 * A `.bin` file names a path eight directories deep, and the reader holding
 * that string wants the directory it names rather than eight expand clicks. The
 * segment being typed completes against the children of the directory before
 * it, which the sources answer without a read.
 */
export function PathInput({ location, useCompletions, onCommit, onCancel }: PathInputProps) {
  const [typed, setTyped] = useState(location);
  const [highlighted, setHighlighted] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const available = useCompletions(parentLocation(typed));

  const completions = useMemo(() => {
    const needle = typed.toLowerCase();
    return available
      .filter((path) => path.toLowerCase().startsWith(needle) && path !== typed)
      .slice(0, MAX_COMPLETIONS);
  }, [typed, available]);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((at) => Math.min(at + 1, completions.length - 1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((at) => Math.max(at - 1, -1));
      return;
    }

    if (event.key === "Tab" && completions.length > 0) {
      event.preventDefault();
      setTyped(completions[Math.max(highlighted, 0)]!);
      setHighlighted(-1);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      onCommit(highlighted >= 0 ? completions[highlighted]! : typed);
    }
  }

  return (
    <div data-ui="PathInput" className="relative min-w-0 flex-1">
      <Field.Root>
        <Field.Control
          ref={inputRef}
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value);
            setHighlighted(-1);
          }}
          onKeyDown={handleKeyDown}
          onBlur={onCancel}
          aria-label={m.workshop_explorer_location_label()}
          spellCheck={false}
          autoComplete="off"
          className="h-7 w-full font-mono text-code"
        />
      </Field.Root>

      {completions.length > 0 && (
        <ul
          role="listbox"
          aria-label={m.workshop_explorer_completions_label()}
          className="absolute top-full left-0 z-50 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-surface-600 bg-surface-800 p-1 shadow-lg scrollbar-md"
        >
          {completions.map((path, index) => (
            <li key={path}>
              <button
                type="button"
                role="option"
                aria-selected={index === highlighted}
                /* Ahead of the blur that would close the list first. */
                onMouseDown={(event) => {
                  event.preventDefault();
                  onCommit(path);
                }}
                className={twMerge(
                  "w-full truncate rounded-md px-2 py-1 text-left font-mono text-code text-surface-200",
                  index === highlighted && "bg-surface-veil text-surface-50",
                )}
              >
                {path}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
