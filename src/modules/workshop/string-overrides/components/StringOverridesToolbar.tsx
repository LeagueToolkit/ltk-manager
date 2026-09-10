import { CaretDownIcon, MagnifyingGlassIcon, TranslateIcon, XIcon } from "@phosphor-icons/react";
import { useRef } from "react";

import { Field, IconButton, Menu, Tooltip } from "@/components";
import { twMerge } from "@/utils";

import { useProjectContext } from "../../components/ProjectContext";
import { stringsDocument } from "../../documents/contentDocument";
import { useOpenDocument } from "../../state";
import { LOCALES } from "../constants";

interface StringOverridesToolbarProps {
  layerName: string;
  locale: string;
  filter: string;
  onFilterChange: (filter: string) => void;
  /** Rows the filter leaves on screen, against `total` for the count line. */
  shown: number;
  total: number;
}

/** The document's toolbar row: which locale this is, the filter, the count. */
export function StringOverridesToolbar({
  layerName,
  locale,
  filter,
  onFilterChange,
  shown,
  total,
}: StringOverridesToolbarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <LocaleMenu layerName={layerName} locale={locale} />

      <Field.Root className="relative min-w-0 flex-1">
        <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-surface-400" />
        <Field.Control
          ref={inputRef}
          type="text"
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && filter.length > 0) {
              event.preventDefault();
              onFilterChange("");
            }
          }}
          placeholder="Filter the overrides"
          aria-label="Filter the overrides"
          autoComplete="off"
          spellCheck={false}
          className="h-6 pr-7 pl-7 text-xs select-text"
        />
        {filter && (
          <IconButton
            icon={<XIcon weight="bold" className="h-3 w-3" />}
            variant="transparent"
            size="xs"
            compact
            onClick={() => {
              onFilterChange("");
              inputRef.current?.focus();
            }}
            aria-label="Clear the filter"
            className="absolute top-1/2 right-1 h-4 w-4 -translate-y-1/2"
          />
        )}
      </Field.Root>

      {total > 0 && (
        <span className="shrink-0 text-[0.6875rem] text-surface-400 tabular-nums select-none">
          {countText(shown, total)}
        </span>
      )}
    </>
  );
}

function countText(shown: number, total: number): string {
  if (shown < total) return `${shown} of ${total} shown`;
  return total === 1 ? "1 override" : `${total} overrides`;
}

interface LocaleMenuProps {
  layerName: string;
  locale: string;
}

/* Every locale the game ships, counts alongside, switching the document in
   place rather than through the sidebar. */
function LocaleMenu({ layerName, locale }: LocaleMenuProps) {
  const project = useProjectContext();
  const openDocument = useOpenDocument();

  const overrides =
    project.layers.find((candidate) => candidate.name === layerName)?.stringOverrides ?? {};
  const current = LOCALES.find((candidate) => candidate.value === locale);

  return (
    <Menu.Root>
      <Tooltip content="Switch locale">
        <Menu.Trigger
          render={
            <button
              type="button"
              className={twMerge(
                "flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-sm px-1.5 text-xs text-surface-200 transition-colors select-none",
                /* DS-VEIL */ "hover:bg-surface-veil hover:text-surface-100",
              )}
            >
              <TranslateIcon className="h-3.5 w-3.5 text-doc-strings-text" />
              {current?.label ?? locale}
              <CaretDownIcon className="h-3 w-3 text-surface-400" />
            </button>
          }
        />
      </Tooltip>
      <Menu.Portal>
        <Menu.Positioner align="start" sideOffset={4}>
          <Menu.Popup className="max-h-80 overflow-y-auto">
            {LOCALES.map((candidate) => {
              const count = Object.keys(overrides[candidate.value] ?? {}).length;

              return (
                <Menu.Item
                  key={candidate.value}
                  shortcut={count > 0 ? String(count) : undefined}
                  onClick={() => openDocument(stringsDocument(layerName, candidate.value))}
                >
                  <span className={candidate.value === locale ? "text-accent-300" : undefined}>
                    {candidate.label}
                  </span>
                </Menu.Item>
              );
            })}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
