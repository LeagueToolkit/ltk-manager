import { MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import type { KeyboardEvent, ReactNode, RefObject } from "react";

import { Field, IconButton, Tooltip } from "@/components";
import { twMerge } from "@/utils";

interface TreeSearchBoxProps {
  value: string;
  onChange: (value: string) => void;
  regex: boolean;
  onRegexChange: (regex: boolean) => void;
  /** The box's own name, and its placeholder as the pattern reads plain. */
  label: string;
  /** The placeholder while the pattern reads as a regex. */
  regexLabel: string;
  regexToggleLabel: string;
  clearLabel: string;
  /** `Enter` or `ArrowDown`, which hand the keyboard to the rows below. */
  onCommit: () => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  /** What sits after the box in its row: a count, a spinner. */
  children?: ReactNode;
}

/**
 * The find box a browser's toolbar carries: a pattern, its regex toggle, and a clear.
 *
 * `Escape` empties a box that holds something and otherwise passes. The count and the
 * spinner are the caller's. What they read differs per browser.
 */
export function TreeSearchBox({
  value,
  onChange,
  regex,
  onRegexChange,
  label,
  regexLabel,
  regexToggleLabel,
  clearLabel,
  onCommit,
  inputRef,
  children,
}: TreeSearchBoxProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape" && value.length > 0) {
      event.preventDefault();
      onChange("");
    }
    if (event.key === "Enter" || event.key === "ArrowDown") {
      event.preventDefault();
      onCommit();
    }
  }

  return (
    <>
      <Field.Root className="relative min-w-0 flex-1">
        <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-surface-400" />
        <Field.Control
          ref={inputRef}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={regex ? regexLabel : label}
          aria-label={label}
          autoComplete="off"
          spellCheck={false}
          className="h-6 pr-14 pl-7 text-xs select-text"
        />
        <span className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5">
          {value && (
            <IconButton
              icon={<XIcon weight="bold" className="h-3 w-3" />}
              variant="transparent"
              size="xs"
              compact
              onClick={() => {
                onChange("");
                inputRef?.current?.focus();
              }}
              aria-label={clearLabel}
              className="h-4 w-4"
            />
          )}
          <Tooltip content={regexToggleLabel}>
            <button
              type="button"
              aria-pressed={regex}
              onClick={() => onRegexChange(!regex)}
              className={twMerge(
                "flex h-4.5 cursor-pointer items-center rounded-sm px-1 font-mono text-[0.625rem] text-surface-400 transition-colors",
                /* DS-VEIL */ "hover:bg-surface-veil hover:text-surface-100",
                regex &&
                  "bg-accent-500/20 text-accent-300 hover:bg-accent-500/30 hover:text-accent-300",
              )}
            >
              .*
            </button>
          </Tooltip>
        </span>
      </Field.Root>
      {children}
    </>
  );
}
