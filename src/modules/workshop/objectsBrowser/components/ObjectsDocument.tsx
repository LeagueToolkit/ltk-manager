import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { type RefObject, useCallback, useEffect, useMemo, useRef } from "react";

import { Button, EmptyState, Spinner } from "@/components";
import { errorSummary, m } from "@/i18n";
import type { ObjectFindResult } from "@/lib/tauri";
import { DocumentToolbar, type EditorDocumentProps, useFindBox } from "@/modules/editor";
import { useSearchObjects, useSetSearchObjects } from "@/stores";
import { twMerge } from "@/utils";
import { hasErrorCode } from "@/utils/errors";

import type { ContentDocumentOf } from "../../documents/utils/contentDocument";
import {
  GameLoadingState,
  GameWadsErrorState,
} from "../../gameBrowser/components/GameBrowserStates";
import { TreeSearchBox } from "../../shared/components/TreeSearchBox";
import { focusRows } from "../../shared/utils/focusRows";
import {
  useExpandedObjectPrefixes,
  useObjectsDisplay,
  useSetObjectsDisplay,
  useSetObjectsView,
  useObjectsReveal,
  useObjectsSearchPattern,
  useObjectsSearchRegex,
  useSetObjectsSearchPattern,
  useSetObjectsSearchRegex,
  useSettleObjectsReveal,
  useSelectObjectNode,
  useShutFindPrefixes,
  useToggleFindPrefix,
  useToggleObjectPrefix,
} from "../../state";
import { useObjectDir, useObjectDirs } from "../api/useObjectDir";
import { useObjectFind } from "../api/useObjectFind";
import { useWarmOnAbsent } from "../api/useObjectIndex";
import { useLayerDeclarations } from "../hooks/useLayerDeclarations";
import { useOpenObjectNode } from "../hooks/useOpenObjectNode";
import { retryPreviews, useFailedInView } from "../state/previewStills";
import {
  buildFindTree,
  ancestorPrefixes,
  buildObjectTree,
  holdsOnlyUnnamed,
  flattenObjectTree,
  type ObjectTreeNode,
} from "../utils/objectTree";
import {
  ObjectIndexBuildingState,
  ObjectIndexFailedState,
  ObjectIndexUnnamedHint,
} from "./ObjectIndexStates";
import { ObjectPreviewPool } from "./ObjectPreviewPool";
import { ObjectsGrid } from "./ObjectsGrid";
import { ObjectsIndexGrid } from "./ObjectsIndexGrid";
import { ObjectsTree } from "./ObjectsTree";
import { ObjectsViewControls } from "./ObjectsViewControls";

/** The object tree and grid, per "Objects browser" in docs/ux/PROJECT_EDITOR.md. */
export function ObjectsDocument({
  document,
  active,
}: EditorDocumentProps<ContentDocumentOf<"objects">>) {
  const pattern = useObjectsSearchPattern();
  const bodyRef = useRef<HTMLDivElement>(null);
  const boxRef = useFindBox(document.id);
  const { view, thumbnails, location, tileSize } = useObjectsDisplay();
  const setDisplay = useSetObjectsDisplay();
  const setView = useSetObjectsView();
  const setPattern = useSetObjectsSearchPattern();
  const reveal = useObjectsReveal();
  const selectNode = useSelectObjectNode();
  /* Selects the folder the grid opens, so a switch to Tree reveals it. */
  const goTo = (path: string) => {
    setDisplay({ location: path });
    selectNode({ id: path, type: "prefix" });
  };
  const descend = (path: string) => {
    setPattern("");
    goTo(path);
  };
  const up = () => goTo(location.split("/").slice(0, -1).join("/"));

  useEffect(() => {
    if (reveal !== null && view === "grid") {
      setDisplay({ location: ancestorPrefixes(reveal.path).at(-1) ?? "" });
    }
  }, [reveal, view, setDisplay]);

  const searching = pattern.length > 0;

  return (
    <div
      data-ui="ObjectsDocument"
      ref={bodyRef}
      className="relative flex min-h-0 flex-1 flex-col bg-surface-950"
    >
      <DocumentToolbar active={active}>
        <SearchField onCommit={() => focusRows(bodyRef.current)} boxRef={boxRef} />
        {view === "tree" && <ObjectsStats />}
        {view === "grid" && thumbnails && <RetryPreviews />}
        <ObjectsViewControls
          view={view}
          onViewChange={setView}
          thumbnails={thumbnails}
          onThumbnailsChange={(thumbnails) => setDisplay({ thumbnails })}
          size={tileSize}
          onSizeChange={(tileSize) => setDisplay({ tileSize })}
        />
      </DocumentToolbar>

      <ObjectPreviewPool mounted={view === "grid" && thumbnails} active={active}>
        {/* Hidden rather than unmounted. The browse tree's expanded prefixes survive a
            search and back. */}
        {view === "tree" && (
          <div hidden={searching} className="flex min-h-0 flex-1 flex-col">
            <ObjectsIndexTree />
          </div>
        )}
        {view === "grid" && !searching && (
          <>
            <SwitchOffHint />
            <ObjectsIndexGrid
              prefix={location}
              size={tileSize}
              thumbnails={thumbnails}
              onDescend={descend}
              onUp={up}
              canGoUp={location.length > 0}
            />
          </>
        )}
        {searching && (
          <FindResults
            grid={view === "grid"}
            size={tileSize}
            thumbnails={thumbnails}
            onDescend={descend}
            onUp={up}
          />
        )}
      </ObjectPreviewPool>
    </div>
  );
}

/** A retry button with the count of failed previews on screen. */
function RetryPreviews() {
  const failed = useFailedInView();
  if (failed === 0) return null;

  return (
    <Button
      size="xs"
      compact
      variant="ghost"
      left={<ArrowClockwiseIcon weight="bold" className="size-3.5" />}
      onClick={() => retryPreviews()}
    >
      {m.workshop_objects_preview_retry_action({ count: failed })}
    </Button>
  );
}

/** How many objects the install declares, from the root's answer. */
function ObjectsStats() {
  const { data } = useObjectDir("");
  const searching = useObjectsSearchPattern().length > 0;
  if (data?.status !== "ready" || searching) return null;

  const count = data.prefixes.reduce((sum, prefix) => sum + prefix.count, 0) + data.objects.length;
  return (
    <span className="text-xs text-surface-400 select-none">
      {m.workshop_objects_count_label({ count })}
    </span>
  );
}

interface SearchFieldProps {
  onCommit: () => void;
  /** The box a find reaches. */
  boxRef: RefObject<HTMLInputElement | null>;
}

function SearchField({ onCommit, boxRef }: SearchFieldProps) {
  const pattern = useObjectsSearchPattern();
  const regex = useObjectsSearchRegex();
  const onPatternChange = useSetObjectsSearchPattern();
  const onRegexChange = useSetObjectsSearchRegex();

  const { data, error, isFetching } = useObjectFind(pattern, regex);
  const counted = pattern.length > 0 && data?.status === "ready" && data.total > 0 && !error;

  return (
    <TreeSearchBox
      value={pattern}
      onChange={onPatternChange}
      regex={regex}
      onRegexChange={onRegexChange}
      label={m.workshop_objects_search_placeholder()}
      regexLabel={m.workshop_objects_search_regex_placeholder()}
      regexToggleLabel={m.workshop_objects_regex_action()}
      clearLabel={m.workshop_objects_clear_search_action()}
      onCommit={onCommit}
      inputRef={boxRef}
    >
      {counted && (
        <span className="shrink-0 text-[0.6875rem] text-surface-400 tabular-nums select-none">
          {countText(data)}
        </span>
      )}
      {isFetching && <Spinner size="sm" className="h-3 w-3 shrink-0" />}
    </TreeSearchBox>
  );
}

function countText(result: ObjectFindResult): string {
  if (result.hits.length < result.total) {
    return m.workshop_objects_matches_capped_label({
      shown: result.hits.length.toLocaleString(),
      total: result.total.toLocaleString(),
    });
  }
  return m.workshop_objects_matches_label({ count: result.total });
}

/** The index this view warmed goes at the end of the session. The band offers to keep it. */
function SwitchOffHint() {
  const on = useSearchObjects();
  const setOn = useSetSearchObjects();
  if (on) return null;
  return (
    <p className="flex shrink-0 items-center gap-2 border-b border-surface-700/50 px-3 py-1 text-xs text-surface-400 select-none">
      <span className="min-w-0 flex-1 truncate">{m.workshop_objects_index_off_label()}</span>
      <Button variant="ghost" size="xs" onClick={() => setOn(true)}>
        {m.workshop_objects_keep_on_action()}
      </Button>
    </p>
  );
}

function ObjectsIndexTree() {
  const expanded = useExpandedObjectPrefixes();
  const toggle = useToggleObjectPrefix();
  const open = useOpenObjectNode();
  const layers = useLayerDeclarations();

  const root = useObjectDir("");
  const retry = useWarmOnAbsent(root.data?.status);

  const expandedPaths = useMemo(() => [...expanded].sort(), [expanded]);
  const listings = useObjectDirs(expandedPaths);

  const tree = useMemo(() => {
    if (root.data?.status !== "ready") return [];
    const all = new Map(listings);
    all.set("", root.data);
    return buildObjectTree(all, (path) => expanded.has(path), layers);
  }, [root.data, listings, expanded, layers]);

  const isExpanded = useCallback((node: ObjectTreeNode) => expanded.has(node.id), [expanded]);
  const handleToggle = useCallback((node: ObjectTreeNode) => toggle(node.id), [toggle]);

  const reveal = useObjectsReveal();
  const settle = useSettleObjectsReveal();

  if (root.isPending) return <GameLoadingState />;
  if (root.isError) return <GameWadsErrorState error={root.error} />;
  if (root.data.status === "failed") {
    return <ObjectIndexFailedState error={root.data.error} onRetry={retry} />;
  }
  if (root.data.status !== "ready") {
    return (
      <>
        <SwitchOffHint />
        <ObjectIndexBuildingState />
      </>
    );
  }
  if (root.data.prefixes.length === 0 && root.data.objects.length === 0) {
    return (
      <>
        <SwitchOffHint />
        <EmptyState
          size="sm"
          title={m.workshop_objects_none_title()}
          description={m.workshop_objects_none_description()}
        />
      </>
    );
  }

  return (
    <>
      <SwitchOffHint />
      {holdsOnlyUnnamed(root.data) && <ObjectIndexUnnamedHint />}
      <ObjectsTree
        nodes={tree}
        ariaLabel={m.workshop_objects_title()}
        isExpanded={isExpanded}
        onToggle={handleToggle}
        onOpen={open}
        scrollKey="objects-index"
        reveal={reveal}
        onRevealed={settle}
      />
    </>
  );
}

/** Matching objects as an expanded tree or a flat grid. */
function FindResults({
  grid = false,
  size = 128,
  thumbnails = false,
  onDescend = () => {},
  onUp = () => {},
}: {
  grid?: boolean;
  size?: number;
  thumbnails?: boolean;
  onDescend?: (path: string) => void;
  onUp?: () => void;
}) {
  const pattern = useObjectsSearchPattern();
  const regex = useObjectsSearchRegex();
  const { data, error, isFetching } = useObjectFind(pattern, regex);
  const open = useOpenObjectNode();
  const layers = useLayerDeclarations();
  const retry = useWarmOnAbsent(data?.status);

  /* The parse error belongs under the box. Its fix is the next keystroke. Every other
     failure replaces the tree. */
  const patternError = error && hasErrorCode(error, "VALIDATION_FAILED") ? error : null;

  const shut = useShutFindPrefixes();
  const reveal = useObjectsReveal();
  const settle = useSettleObjectsReveal();
  const toggleFindPrefix = useToggleFindPrefix();
  const tree = useMemo(() => {
    if (data?.status !== "ready") return [];
    return buildFindTree(data.hits, data.total, layers, (path) => grid || !shut.has(path));
  }, [data, layers, shut, grid]);
  const tiles = useMemo(
    () =>
      flattenObjectTree(tree, () => true)
        .map(({ node }) => node)
        .filter((node) => node.type === "object"),
    [tree],
  );
  const isExpanded = useCallback((node: ObjectTreeNode) => !shut.has(node.id), [shut]);
  const handleToggle = useCallback(
    (node: ObjectTreeNode) => toggleFindPrefix(node.id),
    [toggleFindPrefix],
  );

  if (error && !patternError) return <GameWadsErrorState error={error} />;
  if (!data && !patternError) return <GameLoadingState />;
  if (data?.status === "failed") {
    return <ObjectIndexFailedState error={data.error} onRetry={retry} />;
  }
  if (data && data.status !== "ready") return <ObjectIndexBuildingState />;

  return (
    <>
      {patternError && (
        <p className="shrink-0 border-b border-surface-700/50 px-3 pb-1.5 font-mono text-xs whitespace-pre-wrap text-danger-text">
          {errorSummary(patternError)}
        </p>
      )}
      {data && data.unnamed && <ObjectIndexUnnamedHint />}
      {data && data.hits.length === 0 && (
        <EmptyState
          size="sm"
          title={m.workshop_objects_no_match_title()}
          description={m.workshop_objects_no_match_description()}
        />
      )}
      {data && data.hits.length > 0 && (
        <div
          className={twMerge(
            "flex min-h-0 flex-1 flex-col transition-opacity",
            /* Still the answer to the last pattern, dimmed rather than blanked. */
            isFetching && "opacity-50",
          )}
        >
          {grid && (
            <ObjectsGrid
              key={`grid:${regex}:${pattern}`}
              reveal={reveal}
              onRevealed={settle}
              nodes={tiles}
              size={size}
              thumbnails={thumbnails}
              onDescend={onDescend}
              onUp={onUp}
            />
          )}
          {!grid && (
            <ObjectsTree
              nodes={tree}
              ariaLabel={m.workshop_objects_title()}
              isExpanded={isExpanded}
              onToggle={handleToggle}
              onOpen={open}
              /* Per pattern. A fresh search opens at its first hit rather than where the
               last one was read to. */
              scrollKey={`objects-find:${regex ? "re" : "text"}:${pattern}`}
            />
          )}
        </div>
      )}
    </>
  );
}
