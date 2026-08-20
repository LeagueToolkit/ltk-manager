import { FileArchiveIcon, MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useRef, useState } from "react";
import { twMerge } from "tailwind-merge";

import { Button, EmptyState, Field, IconButton } from "@/components";
import { NO_OVERSCROLL } from "@/hooks/useOverscrollSpring";
import type { GameWadSummary } from "@/lib/tauri";
import { DocumentToolbar, type EditorDocumentProps } from "@/modules/editor";
import { formatBytes } from "@/utils";

import { type ContentDocumentOf, gameWadDocument } from "../documents/contentDocument";
import { useActiveDocumentId, useOpenDocument } from "../state";
import { GameLoadingState, GameWadsErrorState } from "./GameBrowserStates";
import { wadBasename, wadDirname } from "./sourceIndex";
import { useGameWads } from "./useGameWads";

/* The file trees' row height, so a list of archives scans like the trees it
   opens into. */
const ROW_HEIGHT = 24;

/**
 * Every archive the install holds, as the list the folded tree cannot be.
 *
 * The root browser merges the archives away on purpose, so a modder after one
 * archive by name needs this instead.
 */
export function GameWadsDocument({ active }: EditorDocumentProps<ContentDocumentOf<"game-wads">>) {
  const wads = useGameWads();
  const [filter, setFilter] = useState("");

  const matches = useMemo(() => {
    const all = wads.data ?? [];
    const needle = filter.trim().toLowerCase();
    if (!needle) return all;
    /* The whole relative name, so `champions/aa` narrows as well as `aatrox`. */
    return all.filter((wad) => wad.name.toLowerCase().includes(needle));
  }, [wads.data, filter]);

  return (
    <div data-ui="GameWadsDocument" className="flex min-h-0 flex-1 flex-col bg-surface-950">
      <DocumentToolbar active={active}>
        <FilterField value={filter} onChange={setFilter} total={wads.data?.length ?? 0} />
      </DocumentToolbar>

      <ArchiveList
        wads={matches}
        filtered={filter.trim().length > 0}
        onClearFilter={() => setFilter("")}
      />
    </div>
  );
}

interface FilterFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** How many the install holds, which the placeholder reports. */
  total: number;
}

function FilterField({ value, onChange, total }: FilterFieldProps) {
  /* The count rides the placeholder rather than a label of its own, so the row
     is the one control it looks like. Nothing is lost while filtering: what a
     filter left is the list itself. */
  const placeholder = total > 0 ? `Search ${total} WADs` : "Search WADs";

  return (
    <Field.Root className="relative min-w-0 flex-1">
      <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-surface-400" />
      <Field.Control
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label="Search WADs"
        className="h-6 pr-7 pl-7 text-xs"
      />
      {value && (
        <IconButton
          icon={<XIcon weight="bold" className="h-3 w-3" />}
          variant="transparent"
          size="xs"
          compact
          onClick={() => onChange("")}
          aria-label="Clear filter"
          className="absolute top-1/2 right-1 h-4 w-4 -translate-y-1/2"
        />
      )}
    </Field.Root>
  );
}

interface ArchiveListProps {
  /** What the filter left, which the parent owns because it owns the box. */
  wads: readonly GameWadSummary[];
  filtered: boolean;
  onClearFilter: () => void;
}

function ArchiveList({ wads, filtered, onClearFilter }: ArchiveListProps) {
  const query = useGameWads();
  const scrollRef = useRef<HTMLDivElement>(null);
  const openDocument = useOpenDocument();
  const activeId = useActiveDocumentId();

  const virtualizer = useVirtualizer({
    count: wads.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    getItemKey: (index) => wads[index]!.name,
  });

  if (query.isPending) return <GameLoadingState />;
  if (query.isError) return <GameWadsErrorState error={query.error} />;

  if (wads.length === 0 && filtered) {
    return (
      <EmptyState
        size="sm"
        title="No match"
        description="No archive of the install carries that name."
        action={
          <Button variant="outline" size="xs" onClick={onClearFilter}>
            Clear filter
          </Button>
        }
      />
    );
  }

  if (wads.length === 0) {
    return (
      <EmptyState size="sm" title="No archives" description="The installed game holds no WADs." />
    );
  }

  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-auto py-1 select-none"
      {...NO_OVERSCROLL}
    >
      <div
        role="presentation"
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualizer.getVirtualItems().map((row) => {
          const wad = wads[row.index]!;
          const document = gameWadDocument(wad.name);
          const directory = wadDirname(wad.name);

          return (
            <button
              key={row.key}
              type="button"
              onClick={() => openDocument(document)}
              style={{ height: `${ROW_HEIGHT}px`, transform: `translateY(${row.start}px)` }}
              className={twMerge(
                "absolute inset-x-0 flex min-w-0 cursor-pointer items-center gap-2 px-3 text-left font-mono text-xs transition-colors outline-none",
                "focus-visible:ring-1 focus-visible:ring-accent-500/70 focus-visible:ring-inset",
                document.id === activeId && "bg-accent-500/15 text-accent-100",
                document.id !== activeId &&
                  "text-surface-200/90 hover:bg-surface-700/70 hover:text-surface-100",
              )}
            >
              <FileArchiveIcon
                className={twMerge(
                  "h-3.5 w-3.5 shrink-0",
                  document.id === activeId ? "text-accent-400" : "text-surface-400",
                )}
              />
              {/* One span, so the whole thing reads and truncates as the path
                  it is rather than as a name with a note after it. */}
              <span className="min-w-0 truncate">
                {directory && <span className="text-surface-400">{directory}/</span>}
                {wadBasename(wad.name)}
              </span>
              <span className="ml-auto shrink-0 text-[10px] text-surface-400 tabular-nums">
                {formatBytes(Number(wad.sizeBytes))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
