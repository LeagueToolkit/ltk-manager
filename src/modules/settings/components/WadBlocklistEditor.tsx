import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertCircle,
  ChevronRight,
  Plus,
  Regex as RegexIcon,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { match, P } from "ts-pattern";

import { Button, Field, IconButton, SelectField, Tabs } from "@/components";
import { useClickOutside } from "@/hooks";
import type { Settings, WadBlocklistEntry } from "@/lib/tauri";
import { useAvailableWads } from "@/modules/settings/api";
import {
  type BlocklistSortKey,
  listRegexMatches,
  useBlocklistView,
  useRegexPreview,
  useWadAutocomplete,
  useWadBlocklist,
} from "@/modules/settings/hooks";

type Mode = "exact" | "regex";

/** Fixed suggestion row height (px) so the virtualizer can precompute positions
 * without per-row measurement. */
const SUGGESTION_ROW_HEIGHT = 32;

interface WadBlocklistEditorProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
}

export function WadBlocklistEditor({ settings, onSave }: WadBlocklistEditorProps) {
  const { blocklist, add, removeAt, clear } = useWadBlocklist(settings, onSave);
  const {
    data: availableWads,
    isLoading: availableWadsLoading,
    isError: availableWadsError,
  } = useAvailableWads();

  const [mode, setMode] = useState<Mode>("exact");
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<BlocklistSortKey>("nameAsc");
  const [confirmingClear, setConfirmingClear] = useState(false);

  const regexPreview = useRegexPreview(draft, availableWads);
  const filteredSorted = useBlocklistView(blocklist, search, sortKey);
  const blockedExactValues = useMemo(() => exactValueSet(blocklist), [blocklist]);

  function submitDraft() {
    const value = draft.trim();
    if (!value) return;
    if (mode === "regex" && !regexPreview.valid) return;

    const entry: WadBlocklistEntry =
      mode === "exact" ? { kind: "exact", value } : { kind: "regex", value };
    if (add(entry)) setDraft("");
  }

  function clearAll() {
    clear();
    setConfirmingClear(false);
  }

  const totalCount = blocklist.length;
  const exactCount = blocklist.filter((e) => e.kind === "exact").length;
  const regexCount = totalCount - exactCount;

  return (
    <div className="space-y-3">
      <p className="text-sm text-surface-400">
        Additional WAD files to exclude from overlay building. Mods will not be able to modify these
        files. Use <span className="font-medium text-surface-200">Regex</span> to block many files
        with a single pattern - for example{" "}
        <code className="rounded bg-surface-800 px-1 py-0.5 font-mono text-xs text-surface-200">
          ^map\d+\.en_us\.wad\.client$
        </code>
        .
      </p>

      <Tabs.Root value={mode} onValueChange={(v) => setMode(v as Mode)}>
        <Tabs.List variant="pills" className="w-fit">
          <Tabs.Tab value="exact" variant="pills">
            Exact filename
          </Tabs.Tab>
          <Tabs.Tab value="regex" variant="pills">
            <RegexIcon className="mr-1.5 inline h-3.5 w-3.5" />
            Regex pattern
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="exact" className="mt-3">
          <ExactAddRow
            draft={draft}
            onDraftChange={setDraft}
            onSubmit={submitDraft}
            availableWads={availableWads ?? []}
            availableWadsLoading={availableWadsLoading}
            availableWadsError={availableWadsError}
            blockedExactValues={blockedExactValues}
          />
        </Tabs.Panel>

        <Tabs.Panel value="regex" className="mt-3">
          <RegexAddRow
            draft={draft}
            onDraftChange={setDraft}
            onSubmit={submitDraft}
            preview={regexPreview}
            availableWadsReady={!!availableWads}
          />
        </Tabs.Panel>
      </Tabs.Root>

      {totalCount > 0 && (
        <div className="flex items-center gap-2 pt-1">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-surface-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter entries..."
              className="h-8 w-full rounded-md border border-surface-600 bg-surface-800 pr-2 pl-8 text-sm text-surface-100 placeholder:text-surface-400 focus:border-accent-500 focus:ring-1 focus:ring-accent-500 focus:outline-none"
            />
          </div>
          <div className="w-36">
            <SelectField
              value={sortKey}
              onValueChange={(v) => v && setSortKey(v as BlocklistSortKey)}
              options={[
                { value: "nameAsc", label: "Name A→Z" },
                { value: "nameDesc", label: "Name Z→A" },
                { value: "kind", label: "Kind" },
              ]}
              triggerClassName="!py-1.5 !px-3 text-sm"
            />
          </div>
        </div>
      )}

      {totalCount === 0 && (
        <div className="rounded-md border border-dashed border-surface-700 bg-surface-900/50 px-3 py-6 text-center text-sm text-surface-400">
          No WAD files are blocked yet.
        </div>
      )}

      {totalCount > 0 && (
        <div className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
          {filteredSorted.length === 0 && (
            <div className="px-3 py-4 text-center text-sm text-surface-400">
              No entries match &quot;{search}&quot;.
            </div>
          )}
          {filteredSorted.map(({ entry, originalIndex }) => (
            <BlocklistRow
              key={`${entry.kind}:${entry.value}:${originalIndex}`}
              entry={entry}
              availableWads={availableWads}
              onRemove={() => removeAt(originalIndex)}
            />
          ))}
        </div>
      )}

      {totalCount > 0 && (
        <div className="flex items-center justify-between pt-1 text-xs text-surface-400">
          <span>
            {totalCount} entr{totalCount === 1 ? "y" : "ies"}
            {regexCount > 0 && (
              <>
                {" "}
                · {exactCount} exact, {regexCount} regex
              </>
            )}
          </span>
          {confirmingClear && (
            <div className="flex items-center gap-2">
              <span className="text-danger-text">Remove all {totalCount} entries?</span>
              <Button size="xs" variant="ghost" onClick={() => setConfirmingClear(false)}>
                Cancel
              </Button>
              <Button size="xs" variant="danger" onClick={clearAll}>
                Clear all
              </Button>
            </div>
          )}
          {!confirmingClear && (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setConfirmingClear(true)}
              className="text-surface-400 hover:text-danger-text"
            >
              <Trash2 className="h-3 w-3" />
              Clear all
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function ExactAddRow({
  draft,
  onDraftChange,
  onSubmit,
  availableWads,
  availableWadsLoading,
  availableWadsError,
  blockedExactValues,
}: {
  draft: string;
  onDraftChange: (v: string) => void;
  onSubmit: () => void;
  availableWads: string[];
  availableWadsLoading: boolean;
  availableWadsError: boolean;
  blockedExactValues: Set<string>;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const suggestions = useWadAutocomplete(draft, availableWads, blockedExactValues);
  useClickOutside(containerRef, () => setOpen(false), open);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      setOpen(false);
      onSubmit();
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const noWadsAvailable =
    !availableWadsLoading && !availableWadsError && availableWads.length === 0;

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div ref={containerRef} className="relative flex-1">
          <Field.Control
            type="text"
            value={draft}
            onChange={(e) => {
              onDraftChange(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. Aatrox.wad.client"
            className="w-full"
            autoComplete="off"
          />
          {open && suggestions.length > 0 && (
            <WadSuggestionList
              suggestions={suggestions}
              onSelect={(wad) => {
                onDraftChange(wad);
                setOpen(false);
              }}
            />
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={onSubmit} disabled={!draft.trim()}>
          <Plus className="h-4 w-4" />
          Add
        </Button>
      </div>
      {availableWadsError && (
        <p className="flex items-center gap-1.5 text-xs text-warning-text">
          <AlertCircle className="h-3 w-3" />
          Couldn&apos;t load WAD suggestions. Check your League path in General settings.
        </p>
      )}
      {noWadsAvailable && (
        <p className="text-xs text-surface-500">No WAD files were found under DATA.</p>
      )}
    </div>
  );
}

function WadSuggestionList({
  suggestions,
  onSelect,
}: {
  suggestions: string[];
  onSelect: (wad: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: suggestions.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => SUGGESTION_ROW_HEIGHT,
    overscan: 10,
    getItemKey: (index) => suggestions[index]!,
  });

  return (
    <div
      ref={scrollRef}
      className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-surface-600 bg-surface-700 py-1 shadow-xl"
    >
      <div
        role="presentation"
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const wad = suggestions[virtualRow.index]!;
          return (
            <button
              type="button"
              key={virtualRow.key}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(wad);
              }}
              className="absolute inset-x-0 flex cursor-pointer items-center px-3 text-left text-sm text-surface-200 hover:bg-surface-600"
              style={{
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
              title={wad}
            >
              <span className="min-w-0 truncate">{wad}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RegexAddRow({
  draft,
  onDraftChange,
  onSubmit,
  preview,
  availableWadsReady,
}: {
  draft: string;
  onDraftChange: (v: string) => void;
  onSubmit: () => void;
  preview: { valid: boolean; matchCount: number | null };
  availableWadsReady: boolean;
}) {
  const trimmed = draft.trim();
  const showError = !!trimmed && !preview.valid;
  const canAdd = !!trimmed && preview.valid;

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (canAdd) onSubmit();
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <Field.Control
          type="text"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g. ^map\d+\.en_us\.wad\.client$"
          className={`flex-1 font-mono text-sm ${showError ? "!border-danger focus:!border-danger focus:!ring-danger" : ""}`}
          autoComplete="off"
          spellCheck={false}
        />
        <Button variant="ghost" size="sm" onClick={onSubmit} disabled={!canAdd}>
          <Plus className="h-4 w-4" />
          Add
        </Button>
      </div>
      {match({
        showError,
        trimmed,
        valid: preview.valid,
        matchCount: preview.matchCount,
        availableWadsReady,
      })
        .with({ showError: true }, () => (
          <p className="flex items-center gap-1.5 text-xs text-danger-text">
            <AlertCircle className="h-3 w-3" />
            Invalid regex pattern.
          </p>
        ))
        .with({ trimmed: "" }, () => (
          <p className="text-xs text-surface-500">
            Case-insensitive. Matches each WAD filename individually.
          </p>
        ))
        .with({ valid: true, availableWadsReady: false }, () => (
          <p className="text-xs text-surface-500">Valid regex (preview unavailable).</p>
        ))
        .with({ valid: true, matchCount: P.number }, ({ matchCount: n }) => (
          <p className="text-xs text-surface-400">
            Valid · matches{" "}
            <span className="font-medium text-surface-200">
              {n} {n === 1 ? "file" : "files"}
            </span>
            .
          </p>
        ))
        .otherwise(() => null)}
    </div>
  );
}

function BlocklistRow({
  entry,
  availableWads,
  onRemove,
}: {
  entry: WadBlocklistEntry;
  availableWads: string[] | undefined;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const matches = useMemo(
    () =>
      entry.kind === "regex" && availableWads ? listRegexMatches(entry.value, availableWads) : null,
    [entry.kind, entry.value, availableWads],
  );
  const canExpand = matches !== null && matches.length > 0;

  return (
    <div className="rounded-md bg-surface-800">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <KindBadge kind={entry.kind} />
          <span
            className={`truncate text-sm text-surface-100 ${entry.kind === "regex" ? "font-mono" : ""}`}
            title={entry.value}
          >
            {entry.value}
          </span>
          {canExpand && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="flex shrink-0 cursor-pointer items-center gap-0.5 text-xs text-surface-500 hover:text-surface-300"
            >
              <ChevronRight
                className={`h-3 w-3 transition-transform ${expanded ? "rotate-90" : ""}`}
              />
              {matches.length} matched
            </button>
          )}
          {matches !== null && matches.length === 0 && (
            <span className="shrink-0 text-xs text-surface-500">· no matches</span>
          )}
        </div>
        <IconButton
          icon={<X className="h-3.5 w-3.5" />}
          variant="ghost"
          size="xs"
          compact
          onClick={onRemove}
          aria-label={`Remove ${entry.value}`}
        />
      </div>
      {expanded && canExpand && (
        <ul className="max-h-40 space-y-0.5 overflow-y-auto border-t border-surface-700 px-3 py-2">
          {matches.map((wad) => (
            <li key={wad} className="truncate font-mono text-xs text-surface-300" title={wad}>
              {wad}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function KindBadge({ kind }: { kind: WadBlocklistEntry["kind"] }) {
  const classes =
    kind === "exact" ? "bg-surface-700 text-surface-300" : "bg-accent-500/15 text-accent-300";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase ${classes}`}
    >
      {kind}
    </span>
  );
}

function exactValueSet(blocklist: WadBlocklistEntry[]): Set<string> {
  const set = new Set<string>();
  for (const entry of blocklist) {
    if (entry.kind === "exact") set.add(entry.value.toLowerCase());
  }
  return set;
}
