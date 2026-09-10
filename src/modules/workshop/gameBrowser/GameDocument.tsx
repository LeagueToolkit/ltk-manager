import { ArrowsClockwiseIcon, FilesIcon } from "@phosphor-icons/react";
import { useCallback, useMemo, useRef, useState } from "react";

import { type BreadcrumbItem, EmptyState, IconButton, Spinner, Tooltip } from "@/components";
import { m } from "@/i18n";
import type { AssetRef, GameFindResult } from "@/lib/tauri";
import { DocumentToolbar, type EditorDocumentProps } from "@/modules/editor";
import {
  useExplorerSort,
  useExplorerThumbnails,
  useExplorerTileSize,
  useExplorerView,
} from "@/stores";
import { twMerge } from "@/utils";

import { type ContentDocumentOf, gameWadsDocument } from "../documents/contentDocument";
import {
  CrumbSiblings,
  crumbsOf,
  ExplorerBar,
  ExplorerDetails,
  type ExplorerFileItem,
  ExplorerGrid,
  type ExplorerItem,
  ExplorerSearchBox,
  filterItems,
  filterTree,
  itemsOf,
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
  useExpandedGameDirs,
  useExplorerFilter,
  useExplorerScope,
  useGameSearchPattern,
  useGameSearchRegex,
  useOpenDocument,
  useSetExplorerFilter,
  useSetExplorerScope,
  useSetGameSearchPattern,
  useSetGameSearchRegex,
  useToggleGameDir,
} from "../state";
import { indexDirTarget } from "./extractTargets";
import { GameLoadingState, GameWadsErrorState, UnknownHashHint } from "./GameBrowserStates";
import { GameFindResults } from "./GameFindResults";
import {
  buildIndexTree,
  flattenSourceTree,
  holdsOnlyUnknown,
  type SourceDirNode,
  type SourceFileNode,
  type SourceTreeNode,
  UNKNOWN_DIR,
} from "./sourceIndex";
import { SourceTree } from "./SourceTree";
import { SourceTreeContextMenu } from "./SourceTreeContextMenu";
import { type ExtractHow, useExtractActions } from "./useExtractActions";
import { useGameFind } from "./useGameFind";
import { useGameDir, useGameDirs, useGameIndex, useRefreshGameIndex } from "./useGameIndex";
import { useGameSearchRevealTarget } from "./useGameSearchReveal";
import { useSourcePreview } from "./useSourcePreview";

/** What the whole install's explorer keeps its location and selection under. */
const EXPLORER_ID = "game";

/**
 * The root game browser: every archive of the installed game, folded into one
 * explorer.
 *
 * A tree reads the shape of the install and a grid reads the art in it, and
 * both draw the same location and the same selection. The bar's box reads the
 * open directory or the whole install, which its scope control says.
 */
export function GameDocument({ document, active }: EditorDocumentProps<ContentDocumentOf<"game">>) {
  const nav = useExplorerNav(EXPLORER_ID, document.id);
  const [typing, setTyping] = useState(false);
  const boxRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = useExplorerKeys({
    onUp: nav.goUp,
    onType: () => setTyping(true),
    boxRef,
  });

  return (
    <div
      data-ui="GameDocument"
      className="flex min-h-0 flex-1 flex-col bg-surface-950"
      onKeyDown={handleKeyDown}
    >
      <DocumentToolbar active={active}>
        <GameExplorerBar nav={nav} typing={typing} onTypingChange={setTyping} boxRef={boxRef} />
      </DocumentToolbar>
      <GameBody location={nav.location} onNavigate={nav.goTo} onUp={nav.goUp} />
    </div>
  );
}

interface GameExplorerBarProps {
  nav: ReturnType<typeof useExplorerNav>;
  typing: boolean;
  onTypingChange: (typing: boolean) => void;
  boxRef: React.RefObject<HTMLInputElement | null>;
}

function GameExplorerBar({ nav, typing, onTypingChange, boxRef }: GameExplorerBarProps) {
  const view = useExplorerView();
  const filter = useExplorerFilter(EXPLORER_ID);
  const setFilter = useSetExplorerFilter();
  const selection = useExplorerSelectionApi(EXPLORER_ID, NO_ORDER);

  const renderSiblings = useCallback(
    (crumb: BreadcrumbItem) => (
      <CrumbSiblings path={crumb.id} onNavigate={nav.goTo} useChildDirs={useIndexChildDirs} />
    ),
    [nav.goTo],
  );

  return (
    <ExplorerBar
      crumbs={crumbsOf(m.workshop_game_source_label(), nav.location)}
      onNavigate={nav.goTo}
      onUp={nav.goUp}
      atRoot={nav.atRoot}
      renderSiblings={renderSiblings}
      useCompletions={useIndexCompletions}
      typing={typing}
      onTypingChange={onTypingChange}
      location={nav.location}
      view={view}
      filter={filter}
      onFilterChange={(next) => setFilter(EXPLORER_ID, next)}
      box={<SearchField boxRef={boxRef} />}
      selection={selection.summary}
      onClearSelection={selection.clear}
      actions={
        <>
          <GameStats />
          <ArchivesAction />
          <RebuildAction />
        </>
      }
    />
  );
}

/* The bar reads the selection's totals and never its order, so it asks for none.
   The views hold the order, because it is what they draw. */
const NO_ORDER: never[] = [];

interface GameBodyProps {
  location: string;
  onNavigate: (path: string) => void;
  onUp: () => void;
}

function GameBody({ location, onNavigate, onUp }: GameBodyProps) {
  const view = useExplorerView();
  const scope = useExplorerScope(EXPLORER_ID);
  const pattern = useGameSearchPattern();

  if (scope === "whole" && pattern.length > 0) return <GameFindResults />;
  if (view !== "tree")
    return <GameIndexItems view={view} location={location} onDescend={onNavigate} onUp={onUp} />;
  return <GameIndexTree />;
}

function GameStats() {
  const { data } = useGameIndex();
  if (!data) return null;

  return (
    <span className="shrink-0 text-xs text-surface-400 select-none">
      {m.workshop_game_files_label({
        count: data.files,
        formatted: data.files.toLocaleString(),
      })}
      {" · "}
      {m.workshop_game_archives_label({
        count: data.archives,
        formatted: data.archives.toLocaleString(),
      })}
    </span>
  );
}

/* The tree folds the archives away, so the one route left to a single archive
   is the list this opens. */
function ArchivesAction() {
  const openDocument = useOpenDocument();

  return (
    <Tooltip content={m.workshop_game_wads_label()}>
      <IconButton
        icon={<FilesIcon className="h-4 w-4" />}
        variant="ghost"
        size="xs"
        compact
        onClick={() => openDocument(gameWadsDocument())}
        aria-label={m.workshop_game_wads_action()}
      />
    </Tooltip>
  );
}

/* The index is a snapshot of the install taken once a session, so a game patch
   needs a way to say so. */
function RebuildAction() {
  const rebuild = useRefreshGameIndex();

  return (
    <Tooltip content={m.workshop_game_rebuild_label()}>
      <IconButton
        icon={
          <ArrowsClockwiseIcon
            className={twMerge("h-4 w-4", rebuild.isPending && "animate-spin")}
          />
        }
        variant="ghost"
        size="xs"
        compact
        onClick={() => rebuild.mutate()}
        disabled={rebuild.isPending}
        aria-label={m.workshop_game_rebuild_action()}
      />
    </Tooltip>
  );
}

/** The child directories of one path, for a crumb's caret. */
function useIndexChildDirs(path: string) {
  const { data } = useGameDir(path);
  return data?.dirs ?? null;
}

/** The directories under one path, for the typed path's completion. */
function useIndexCompletions(directory: string): readonly string[] {
  const { data } = useGameDir(directory);
  return useMemo(() => data?.dirs.map((dir) => dir.path) ?? [], [data]);
}

interface SearchFieldProps {
  boxRef: React.RefObject<HTMLInputElement | null>;
}

/**
 * The one box, reading whatever the scope says.
 *
 * Whole game runs the index's own find, which ranks across every archive. This
 * folder narrows the rows already on screen, which costs no read at all.
 */
function SearchField({ boxRef }: SearchFieldProps) {
  const scope = useExplorerScope(EXPLORER_ID);
  const setScope = useSetExplorerScope();
  const filter = useExplorerFilter(EXPLORER_ID);
  const setFilter = useSetExplorerFilter();
  const pattern = useGameSearchPattern();
  const regex = useGameSearchRegex();
  const onPatternChange = useSetGameSearchPattern();
  const onRegexChange = useSetGameSearchRegex();

  const { data, error, isFetching } = useGameFind(pattern, regex);
  const counted = scope === "whole" && pattern.length > 0 && data && data.total > 0 && !error;

  useGameSearchRevealTarget(boxRef);

  const value = scope === "whole" ? pattern : filter.text;
  const onChange = (next: string) => {
    if (scope === "whole") onPatternChange(next);
    else setFilter(EXPLORER_ID, { ...filter, text: next });
  };

  return (
    <ExplorerSearchBox
      value={value}
      onChange={onChange}
      scope={scope}
      onScopeChange={(next) => setScope(EXPLORER_ID, next)}
      wholeLabel={m.workshop_explorer_scope_game_label()}
      /* The index is what a regex is worth writing against. A filter over the
         rows on screen matches a substring and nothing more. */
      regex={scope === "whole" ? { on: regex, onChange: onRegexChange } : undefined}
      inputRef={boxRef}
    >
      {counted && (
        <span className="shrink-0 text-[0.6875rem] text-surface-400 tabular-nums select-none">
          <MatchCount result={data} />
        </span>
      )}
      {scope === "whole" && isFetching && <Spinner size="sm" className="h-3 w-3 shrink-0" />}
    </ExplorerSearchBox>
  );
}

/** What the find turned up, and how much of it the answer carries. */
function MatchCount({ result }: { result: GameFindResult }) {
  const formatted = result.total.toLocaleString();

  if (result.hits.length < result.total) {
    return m.workshop_game_matches_partial_label({
      count: result.total,
      formatted,
      shown: result.hits.length.toLocaleString(),
    });
  }

  return m.workshop_game_matches_label({ count: result.total, formatted });
}
function GameIndexTree() {
  const filter = useExplorerFilter(EXPLORER_ID);
  /* Opt-in, where the scoped browser opts out: a whole-game tree is too large
     to hold at once, so a directory is read when it is first opened. */
  const expanded = useExpandedGameDirs();
  const toggleDir = useToggleGameDir();
  const openFile = useSourcePreview();
  const sort = useExplorerSort();

  const root = useGameDir("");
  const expandedPaths = useMemo(() => [...expanded].sort(), [expanded]);
  const listings = useGameDirs(expandedPaths);

  const tree = useMemo(() => {
    if (!root.data) return [];
    const all = new Map(listings);
    all.set("", root.data);
    const built = buildIndexTree(all, (path) => expanded.has(path));
    /* What is read, and no more. A directory nobody opened holds no rows here,
       so this narrows the tree on screen rather than answering for the install
       - which is what the whole-game scope is for. */
    return sortTree(filterTree(built, filter.text), sort);
  }, [root.data, listings, expanded, filter.text, sort]);

  const isExpanded = useCallback((node: SourceDirNode) => expanded.has(node.id), [expanded]);
  const rows = useMemo(() => flattenSourceTree(tree, isExpanded), [tree, isExpanded]);
  const order = useMemo(
    () => rows.map((row) => selectedOfNode(row.node)).filter(isPresent),
    [rows],
  );
  const selection = useExplorerSelectionApi(EXPLORER_ID, order);

  const handleToggle = useCallback((node: SourceDirNode) => toggleDir(node.id), [toggleDir]);
  const targets = useCallback(
    () => selectionTargets(selection.selection, indexDirTargets),
    [selection.selection],
  );

  if (root.isPending) return <GameLoadingState />;
  if (root.isError) return <GameWadsErrorState error={root.error} />;
  if (root.data.dirs.length === 0 && root.data.files.length === 0) {
    return (
      <EmptyState
        size="sm"
        title={m.workshop_game_empty_title()}
        description={m.workshop_game_empty_description()}
      />
    );
  }

  return (
    <>
      {holdsOnlyUnknown(root.data) && <UnknownHashHint />}
      <SourceTree
        rows={rows}
        ariaLabel={m.workshop_game_files_tree_label()}
        isExpanded={isExpanded}
        onToggle={handleToggle}
        onOpen={openFile}
        /* A shut row here holds no children yet, so the backend expands it
           through the index rather than the tree walking what it has. */
        dirTargets={(node) => [indexDirTarget(node.path)]}
        selection={selection}
        selectionTargets={targets}
        scrollKey="game-index"
      />
    </>
  );
}

interface GameIndexItemsProps {
  /** Which of the two item views draws, both of which read one directory. */
  view: "grid" | "details";
  location: string;
  onDescend: (path: string) => void;
  onUp: () => void;
}

/* The grid and the details list differ in how a row draws and in nothing that
   reaches the source, so one component reads the directory for both. */
function GameIndexItems({ view, location, onDescend, onUp }: GameIndexItemsProps) {
  const here = useGameDir(location);
  const openFile = useSourcePreview();
  const filter = useExplorerFilter(EXPLORER_ID);
  const sort = useExplorerSort();
  const tileSize = useExplorerTileSize();
  const thumbnails = useExplorerThumbnails();

  const items = useMemo(() => {
    if (!here.data) return [];
    return sortItems(filterItems(itemsOf(here.data), filter), sort);
  }, [here.data, filter, sort]);

  const order = useMemo(() => items.map(selectedOfItem), [items]);
  const selection = useExplorerSelectionApi(EXPLORER_ID, order);

  const handleOpen = useCallback(
    (item: ExplorerFileItem) => openFile(fileNodeOf(item)),
    [openFile],
  );

  const { run } = useExtractActions();
  const runSelection = useCallback(
    (how: ExtractHow) =>
      run(how, selectionTargets(selection.selection, indexDirTargets), selectionSubject(selection)),
    [run, selection],
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

  if (here.isPending) return <GameLoadingState />;
  if (here.isError) return <GameWadsErrorState error={here.error} />;
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
    ariaLabel: m.workshop_game_files_tree_label(),
    onDescend,
    onOpen: handleOpen,
    onUp,
    assetOf: gameAsset,
    renderMenu,
    onRun: runSelection,
  };

  if (view === "details") return <ExplorerDetails {...shared} />;
  return <ExplorerGrid {...shared} size={tileSize} showFacts={tileSize >= 128} />;
}

/** A game chunk names the archive it came from, which is the route back to its bytes. */
function gameAsset(item: ExplorerItem): AssetRef | null {
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

const indexDirTargets = (path: string) => [indexDirTarget(path)];

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}
