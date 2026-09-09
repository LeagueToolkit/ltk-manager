import { CaretDownIcon, MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from "react";

import { Field, IconButton, Menu, Tooltip } from "@/components";
import { m } from "@/i18n";
import { twMerge } from "@/utils";

/** Where the box reads: the open directory, or everything the source holds. */
export type ExplorerScope = "here" | "whole";

export interface ExplorerSearchBoxProps {
  value: string;
  onChange: (value: string) => void;
  scope: ExplorerScope;
  onScopeChange: (scope: ExplorerScope) => void;
  /** What the whole-source scope is called, which is the source's own word. */
  wholeLabel: string;
  /**
   * The regex toggle, offered only by a source that searches an index.
   *
   * A filter over rows already on screen matches a substring and nothing more,
   * so a source with no index behind it draws no toggle at all.
   */
  regex?: { on: boolean; onChange: (on: boolean) => void };
  /** A match count or a spinner, at the trailing edge. */
  children?: ReactNode;
  inputRef?: RefObject<HTMLInputElement | null>;
}

/**
 * One box, and the control that says what it reads.
 *
 * The scope sits inside the box's own shell rather than beside it, because the
 * two are one question: a reader asking "where does this search?" is looking at
 * the box when they ask it.
 */
export function ExplorerSearchBox({
  value,
  onChange,
  scope,
  onScopeChange,
  wholeLabel,
  regex,
  children,
  inputRef,
}: ExplorerSearchBoxProps) {
  const scopeLabel = scope === "here" ? m.workshop_explorer_scope_here_label() : wholeLabel;

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape" && value.length > 0) {
      event.preventDefault();
      onChange("");
    }
  }

  return (
    <div
      data-ui="ExplorerSearchBox"
      /* DS-VEIL, DS-HOVER */
      className={twMerge(
        "flex h-7 w-72 shrink-0 items-center gap-0.5 rounded-md border border-surface-veil-strong",
        "bg-surface-veil-soft pr-0.5 transition-colors",
        "focus-within:border-accent-500 hover:border-accent-hover",
      )}
    >
      <Menu.Root>
        <Menu.Trigger className="flex h-full shrink-0 items-center gap-0.5 rounded-l-md px-2 text-fine text-surface-300 outline-none hover:bg-surface-veil hover:text-surface-100">
          {scopeLabel}
          <CaretDownIcon className="h-3 w-3" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="bottom" align="start" sideOffset={6}>
            <Menu.Popup className="w-44">
              <Menu.Item onClick={() => onScopeChange("here")}>
                {m.workshop_explorer_scope_here_label()}
              </Menu.Item>
              <Menu.Item onClick={() => onScopeChange("whole")}>{wholeLabel}</Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>

      <span className="h-4 w-px shrink-0 bg-surface-veil-strong" aria-hidden />
      <MagnifyingGlassIcon className="ml-1 h-3.5 w-3.5 shrink-0 text-surface-400" />

      <Field.Root className="min-w-0 flex-1">
        <Field.Control
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={scopeLabel}
          aria-label={scopeLabel}
          spellCheck={false}
          autoComplete="off"
          className="h-6 rounded-none border-0 bg-transparent px-1 text-meta hover:border-0 focus:border-0 focus:ring-0"
        />
      </Field.Root>

      {children}

      {value.length > 0 && (
        <IconButton
          icon={<XIcon weight="bold" className="h-3 w-3" />}
          variant="ghost"
          size="xs"
          compact
          onClick={() => onChange("")}
          aria-label={m.workshop_explorer_clear_box_action()}
        />
      )}

      {regex && (
        <Tooltip content={m.workshop_game_search_regex_action()}>
          <IconButton
            icon={<span className="font-mono text-fine">.*</span>}
            variant="ghost"
            size="xs"
            compact
            aria-pressed={regex.on}
            onClick={() => regex.onChange(!regex.on)}
            aria-label={m.workshop_game_search_regex_action()}
            className={regex.on ? "text-accent-300" : undefined}
          />
        </Tooltip>
      )}
    </div>
  );
}
