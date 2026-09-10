import { DownloadSimpleIcon, StackPlusIcon } from "@phosphor-icons/react";
import { useCallback, useMemo, useRef, useState } from "react";

import { type BreadcrumbItem, Button, EmptyState } from "@/components";
import { m } from "@/i18n";
import type { AppError, AssetRef, GameWadSummary } from "@/lib/tauri";
import { DocumentToolbar, type EditorDocumentProps } from "@/modules/editor";
import {
  useExplorerSort,
  useExplorerThumbnails,
  useExplorerTileSize,
  useExplorerView,
} from "@/stores";
import { formatBytes } from "@/utils";

import type { ContentDocumentOf } from "../documents/contentDocument";
import {
  CrumbSiblings,
  crumbsOf,
  ExplorerBar,
  ExplorerDetails,
  type ExplorerFileItem,
  ExplorerGrid,
  type ExplorerItem,
  ExplorerSearchBox,
  fileItemOf,
  filesUnderPath,
  filterItems,
  filterTree,
  itemsOf,
  listingsOf,
  selectedOfItem,
  selectedOfNode,
  selectionSubject,
  selectionTargets,
  sortItems,
  sortTree,
  useExplorerKeys,
  useExplorerNav,
  useExplorerSelectionApi,
} from "../explorer";
import {
  useExplorerFilter,
  useExplorerScope,
  useSetExplorerFilter,
  useSetExplorerScope,
  useShutWadDirs,
  useToggleWadDir,
} from "../state";
import { archiveTarget, entryTarget } from "./extractTargets";
import { GameLoadingState, GameWadsErrorState, UnknownHashHint } from "./GameBrowserStates";
import {
  buildSourceTree,
  flattenSourceTree,
  hasOnlyUnknownPaths,
  type SourceDirListing,
  type SourceDirNode,
  type SourceEntry,
  type SourceFileNode,
  type SourceTreeNode,
  UNKNOWN_DIR,
  wadBasename,
} from "./sourceIndex";
import { SourceTree } from "./SourceTree";
import { SourceTreeContextMenu } from "./SourceTreeContextMenu";
import { type ExtractHow, useExtractActions } from "./useExtractActions";
import { useGameWadEntries } from "./useGameWadEntries";
import { useGameWads } from "./useGameWads";
import { useSourcePreview } from "./useSourcePreview";

/** One archive's explorer, kept apart from the whole install's and from another archive's. */
function explorerIdOf(wadName: string): string {
  return `game-wad:${wadName}`;
}

/** One game archive's files, without the archive level the tab already names. */
export function GameWadDocument({
  document,
  active,
}: EditorDocumentProps<ContentDocumentOf<"game-wad">>) {
  const wadName = document.wadName;
  const explorerId = explorerIdOf(wadName);

  const wads = useGameWads();
  const summary = findArchive(wads.data, wadName);

  const entriesQuery = useGameWadEntries(summary?.name ?? null);
  const entries = entriesQuery.data;
  const error = wads.error ?? entriesQuery.error;

  /* The whole chunk table arrives at once, so every directory of the archive is
     already known and a listing costs no read. */
  const listings = useMemo(() => listingsOf(entries ?? []), [entries]);

  const nav = useExplorerNav(explorerId, document.id);
  const [typing, setTyping] = useState(false);
  const boxRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = useExplorerKeys({
    onUp: nav.goUp,
    onType: () => setTyping(true),
    boxRef,
  });

  return (
    <div
      data-ui="GameWadDocument"
      className="flex min-h-0 flex-1 flex-col bg-surface-950"
      onKeyDown={handleKeyDown}
    >
      <DocumentToolbar active={active}>
        <ArchiveBar
          explorerId={explorerId}
          summary={summary}
          listings={listings}
          nav={nav}
          typing={typing}
          onTypingChange={setTyping}
          boxRef={boxRef}
        />
      </DocumentToolbar>
      <ArchiveBody
        explorerId={explorerId}
        wadName={wadName}
        summary={summary}
        entries={entries}
        listings={listings}
        pending={wads.isPending || entriesQuery.isPending}
        error={error}
        nav={nav}
      />
    </div>
  );
}

/* Case-insensitive, and by basename as a fallback, because the WADs list opens
   a layer's archive by its file name alone. */
function findArchive(
  wads: readonly GameWadSummary[] | undefined,
  wadName: string,
): GameWadSummary | undefined {
  if (!wads) return undefined;
  const lower = wadName.toLowerCase();
  return (
    wads.find((wad) => wad.name.toLowerCase() === lower) ??
    wads.find((wad) => wadBasename(wad.name).toLowerCase() === lower)
  );
}

interface ArchiveBarProps {
  explorerId: string;
  summary: GameWadSummary | undefined;
  listings: ReadonlyMap<string, SourceDirListing>;
  nav: ReturnType<typeof useExplorerNav>;
  typing: boolean;
  onTypingChange: (typing: boolean) => void;
  boxRef: React.RefObject<HTMLInputElement | null>;
}

function ArchiveBar({
  explorerId,
  summary,
  listings,
  nav,
  typing,
  onTypingChange,
  boxRef,
}: ArchiveBarProps) {
  const view = useExplorerView();
  const scope = useExplorerScope(explorerId);
  const setScope = useSetExplorerScope();
  const filter = useExplorerFilter(explorerId);
  const setFilter = useSetExplorerFilter();
  const selection = useExplorerSelectionApi(explorerId, NO_ORDER);

  const label = summary ? wadBasename(summary.name) : m.workshop_archive_source_label();

  const useChildDirs = useCallback((path: string) => listings.get(path)?.dirs ?? [], [listings]);
  const useCompletions = useCallback(
    (directory: string) => listings.get(directory)?.dirs.map((dir) => dir.path) ?? [],
    [listings],
  );

  const renderSiblings = useCallback(
    (crumb: BreadcrumbItem) => (
      <CrumbSiblings path={crumb.id} onNavigate={nav.goTo} useChildDirs={useChildDirs} />
    ),
    [nav.goTo, useChildDirs],
  );

  return (
    <ExplorerBar
      crumbs={crumbsOf(label, nav.location)}
      onNavigate={nav.goTo}
      onUp={nav.goUp}
      atRoot={nav.atRoot}
      renderSiblings={renderSiblings}
      useCompletions={useCompletions}
      typing={typing}
      onTypingChange={onTypingChange}
      location={nav.location}
      view={view}
      filter={filter}
      onFilterChange={(next) => setFilter(explorerId, next)}
      box={
        <ExplorerSearchBox
          value={filter.text}
          onChange={(text) => setFilter(explorerId, { ...filter, text })}
          scope={scope}
          onScopeChange={(next) => setScope(explorerId, next)}
          wholeLabel={m.workshop_explorer_scope_archive_label()}
          inputRef={boxRef}
        />
      }
      selection={selection.summary}
      onClearSelection={selection.clear}
      actions={
        <>
          <ArchiveStats summary={summary} />
          <ArchiveActions summary={summary} />
        </>
      }
    />
  );
}

/* The bar reads the selection's totals and never its order, so it asks for none. */
const NO_ORDER: never[] = [];

function ArchiveStats({ summary }: { summary: GameWadSummary | undefined }) {
  const { data: entries } = useGameWadEntries(summary?.name ?? null);
  if (!summary) return null;

  const size = formatBytes(Number(summary.sizeBytes));
  if (!entries) {
    return <span className="shrink-0 text-xs text-surface-400 select-none">{size}</span>;
  }

  return (
    <span className="shrink-0 text-xs text-surface-400 select-none">
      {m.workshop_archive_files_label({ count: entries.length })}
      {" · "}
      {size}
    </span>
  );
}

/* The scoped browser's routes to the whole archive, which its rows cannot
   carry: the archive level is the tab, so no row stands for it. */
function ArchiveActions({ summary }: { summary: GameWadSummary | undefined }) {
  const { run, lastFolder, layerLabel, busy } = useExtractActions();
  if (!summary) return null;

  const targets = [archiveTarget(summary.name)];
  const subject = wadBasename(summary.name);

  return (
    <div className="flex shrink-0 items-center gap-1">
      {layerLabel && (
        <Button
          variant="ghost"
          size="xs"
          left={<StackPlusIcon className="h-4 w-4" />}
          disabled={busy}
          onClick={() => run("copy", targets, subject)}
        >
          {m.workshop_archive_copy_action({ layer: layerLabel })}
        </Button>
      )}
      {lastFolder && (
        <Button
          variant="ghost"
          size="xs"
          left={<DownloadSimpleIcon className="h-4 w-4" />}
          disabled={busy}
          onClick={() => run("quick", targets, subject)}
        >
          {m.workshop_archive_extract_quick_action({ folder: lastFolder })}
        </Button>
      )}
      <Button
        variant="ghost"
        size="xs"
        left={<DownloadSimpleIcon className="h-4 w-4" />}
        onClick={() => run("dialog", targets, subject)}
      >
        {m.workshop_archive_extract_action()}
      </Button>
    </div>
  );
}

interface ArchiveBodyProps {
  explorerId: string;
  wadName: string;
  summary: GameWadSummary | undefined;
  entries: readonly SourceEntry[] | undefined;
  listings: ReadonlyMap<string, SourceDirListing>;
  pending: boolean;
  error: AppError | null;
  nav: ReturnType<typeof useExplorerNav>;
}

function ArchiveBody(props: ArchiveBodyProps) {
  const view = useExplorerView();

  if (props.error) return <GameWadsErrorState error={props.error} />;
  if (props.pending) return <GameLoadingState />;
  if (!props.summary) {
    return (
      <EmptyState
        size="sm"
        title={m.workshop_archive_missing_title()}
        description={m.workshop_archive_missing_description({ wad: props.wadName })}
      />
    );
  }

  return (
    <>
      {props.entries && hasOnlyUnknownPaths(props.entries) && <UnknownHashHint />}
      {view !== "tree" && <ArchiveItems view={view} {...props} />}
      {view === "tree" && <ArchiveTree {...props} />}
    </>
  );
}

function ArchiveTree({ explorerId, wadName, summary, entries, listings }: ArchiveBodyProps) {
  const openFile = useSourcePreview();
  const shutDirs = useShutWadDirs(wadName);
  const toggleWadDir = useToggleWadDir();
  const filter = useExplorerFilter(explorerId);
  const sort = useExplorerSort();

  const tree = useMemo(() => {
    const built = buildSourceTree(entries ?? []);
    /* The archive holds every entry, so the box narrows the whole tree here
       whatever the scope says. The scope is a grid question: a tree draws the
       depth a flat list of hits cannot. */
    const narrowed = filterTree(built, filter.text);
    return sortTree(narrowed, sort);
  }, [entries, filter.text, sort]);

  const isExpanded = useCallback((node: SourceDirNode) => !shutDirs.has(node.id), [shutDirs]);
  const rows = useMemo(() => flattenSourceTree(tree, isExpanded), [tree, isExpanded]);
  const order = useMemo(
    () => rows.map((row) => selectedOfNode(row.node)).filter(isPresent),
    [rows],
  );
  const selection = useExplorerSelectionApi(explorerId, order);

  const handleToggle = useCallback(
    (node: SourceDirNode) => toggleWadDir(wadName, node.id),
    [toggleWadDir, wadName],
  );

  const dirTargetsAt = useCallback(
    (path: string) => filesUnderPath(listings, path).map(entryTarget),
    [listings],
  );
  const targets = useCallback(
    () => selectionTargets(selection.selection, dirTargetsAt),
    [selection.selection, dirTargetsAt],
  );

  return (
    <SourceTree
      rows={rows}
      ariaLabel={m.workshop_archive_tree_label({ archive: summary?.name ?? wadName })}
      isExpanded={isExpanded}
      onToggle={handleToggle}
      onOpen={openFile}
      selection={selection}
      selectionTargets={targets}
      scrollKey={`game-wad:${wadName}`}
    />
  );
}

/* The grid and the details list differ in how a row draws and in nothing that
   reaches the archive, so one component reads the listing for both. */
function ArchiveItems({
  view,
  explorerId,
  listings,
  nav,
}: ArchiveBodyProps & { view: "grid" | "details" }) {
  const openFile = useSourcePreview();
  const filter = useExplorerFilter(explorerId);
  const scope = useExplorerScope(explorerId);
  const sort = useExplorerSort();
  const tileSize = useExplorerTileSize();
  const thumbnails = useExplorerThumbnails();

  const items = useMemo(() => {
    /* The archive holds every entry, so reading below the location costs no
       read and the whole scope is a flat list of what is under it. */
    if (scope === "whole" && filter.text.length > 0) {
      const under = filesUnderPath(listings, nav.location).map(fileItemOf);
      return sortItems(filterItems(under, filter), sort);
    }

    const listing = listings.get(nav.location);
    if (!listing) return [];
    return sortItems(filterItems(itemsOf(listing), filter), sort);
  }, [listings, nav.location, scope, filter, sort]);

  const order = useMemo(() => items.map(selectedOfItem), [items]);
  const selection = useExplorerSelectionApi(explorerId, order);

  const handleOpen = useCallback(
    (item: ExplorerFileItem) => openFile(fileNodeOf(item)),
    [openFile],
  );

  const dirTargetsAt = useCallback(
    (path: string) => filesUnderPath(listings, path).map(entryTarget),
    [listings],
  );
  const { run } = useExtractActions();
  const runSelection = useCallback(
    (how: ExtractHow) =>
      run(how, selectionTargets(selection.selection, dirTargetsAt), selectionSubject(selection)),
    [run, selection, dirTargetsAt],
  );

  const renderMenu = useCallback(
    (item: ExplorerItem | null) => (
      <SourceTreeContextMenu
        node={menuNodeOf(item)}
        onOpen={openFile}
        onRun={(_node, how) => runSelection(how)}
      />
    ),
    [openFile, runSelection],
  );

  if (items.length === 0) {
    return (
      <EmptyState
        size="sm"
        title={m.workshop_explorer_empty_title()}
        description={m.workshop_explorer_empty_description()}
      />
    );
  }

  const shared = {
    items,
    thumbnails,
    selection,
    ariaLabel: m.workshop_archive_grid_label(),
    onDescend: nav.goTo,
    onOpen: handleOpen,
    onUp: nav.goUp,
    assetOf: chunkAsset,
    renderMenu,
    onRun: runSelection,
  };

  if (view === "details") return <ExplorerDetails {...shared} />;
  return <ExplorerGrid {...shared} size={tileSize} showFacts={tileSize >= 128} />;
}

/** A chunk names the archive it came from, which is the route back to its bytes. */
function chunkAsset(item: ExplorerItem): AssetRef | null {
  if (item.kind === "dir") return null;
  return { kind: "gameChunk", wad: item.entry.wad, pathHash: item.entry.pathHash };
}

function fileNodeOf(item: ExplorerFileItem): SourceFileNode {
  return { type: "file", id: item.id, name: item.name, entry: item.entry };
}

/**
 * The tile the menu opened on, as the node that menu reads.
 *
 * A directory tile carries no children here, and the menu never walks any: it
 * offers the ways out, and those act on the selection the right click aimed.
 */
function menuNodeOf(item: ExplorerItem | null): SourceTreeNode | null {
  if (item === null) return null;
  if (item.kind === "file") return fileNodeOf(item);
  return {
    type: "dir",
    id: item.id,
    path: item.id,
    name: item.name,
    unknown: item.id === UNKNOWN_DIR,
    fileCount: item.fileCount,
    children: [],
  };
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}
