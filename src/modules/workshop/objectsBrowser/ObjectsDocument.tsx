import { useCallback, useMemo, useRef } from "react";
import { twMerge } from "tailwind-merge";

import { Button, EmptyState, Spinner } from "@/components";
import { errorSummary, m } from "@/i18n";
import type { ObjectFindResult } from "@/lib/tauri";
import { DocumentToolbar, type EditorDocumentProps } from "@/modules/editor";
import { useSearchObjects, useSetSearchObjects } from "@/stores";
import { hasErrorCode } from "@/utils/errors";

import { useProjectContentTree } from "../api/useProjectContentTree";
import { useProjectContext } from "../components/ProjectContext";
import { TreeSearchBox } from "../components/TreeSearchBox";
import type { ContentDocumentOf } from "../documents/contentDocument";
import { GameLoadingState, GameWadsErrorState } from "../gameBrowser/GameBrowserStates";
import { useWarmOnAbsent } from "../gameBrowser/useObjectIndex";
import {
  useExpandedObjectPrefixes,
  useObjectsReveal,
  useObjectsSearchPattern,
  useObjectsSearchRegex,
  useSetObjectsSearchPattern,
  useSetObjectsSearchRegex,
  useSettleObjectsReveal,
  useShutFindPrefixes,
  useToggleFindPrefix,
  useToggleObjectPrefix,
} from "../state";
import {
  ObjectIndexBuildingState,
  ObjectIndexFailedState,
  ObjectIndexUnnamedHint,
} from "./ObjectIndexStates";
import { ObjectsTree } from "./ObjectsTree";
import {
  buildFindTree,
  buildObjectTree,
  holdsOnlyUnnamed,
  type LayerDeclarations,
  layerDeclarationsOf,
  type ObjectTreeNode,
} from "./objectTree";
import { useObjectDir, useObjectDirs } from "./useObjectDir";
import { useObjectFind } from "./useObjectFind";
import { useOpenObjectNode } from "./useOpenObjectNode";

/**
 * The objects browser: every object of the install, folded into one tree over its paths.
 *
 * "Objects browser" in docs/ux/PROJECT_EDITOR.md. Empty, the toolbar's box browses
 * lazily, one prefix read as it opens. Typed into, the body swaps to the tree the
 * pattern leaves and back without losing where the browse had gotten to.
 */
export function ObjectsDocument({ active }: EditorDocumentProps<ContentDocumentOf<"objects">>) {
  const pattern = useObjectsSearchPattern();
  const bodyRef = useRef<HTMLDivElement>(null);

  const searching = pattern.length > 0;

  return (
    <div
      data-ui="ObjectsDocument"
      ref={bodyRef}
      className="flex min-h-0 flex-1 flex-col bg-surface-950"
    >
      <DocumentToolbar active={active}>
        <SearchField onCommit={() => focusRows(bodyRef.current)} />
        <ObjectsStats />
      </DocumentToolbar>

      {/* Hidden rather than unmounted. The browse tree's expanded prefixes survive a
          search and back. */}
      <div hidden={searching} className="flex min-h-0 flex-1 flex-col">
        <ObjectsIndexTree />
      </div>
      {searching && <FindResults />}
    </div>
  );
}

/* The browse tree stays mounted under `hidden` during a search. The visible tree is
   the one whose rows take focus. */
function focusRows(body: HTMLElement | null) {
  if (!body) return;

  const rows = body.querySelectorAll<HTMLElement>('[data-tree-rows] [data-treeitem-index="0"]');
  const first = [...rows].find((row) => row.offsetParent !== null);
  if (first) {
    first.focus();
    return;
  }
  const trees = body.querySelectorAll<HTMLElement>('[role="tree"]');
  [...trees].find((tree) => tree.offsetParent !== null)?.focus();
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
}

function SearchField({ onCommit }: SearchFieldProps) {
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

/** The project's declarations by hash, for the layer marks on the rows. */
function useLayerDeclarations(): LayerDeclarations {
  const project = useProjectContext();
  const { data: tree } = useProjectContentTree(project.path);
  return useMemo(() => layerDeclarationsOf(tree, project), [tree, project]);
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
  /* Opening the view warms the index whatever the Objects switch says. */
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

/**
 * The tree the pattern leaves: every matching object under its real prefixes.
 *
 * Everything starts expanded. The hits are what the pattern was typed to see.
 */
function FindResults() {
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
  const toggleFindPrefix = useToggleFindPrefix();
  const tree = useMemo(() => {
    if (data?.status !== "ready") return [];
    return buildFindTree(data.hits, data.total, layers, (path) => !shut.has(path));
  }, [data, layers, shut]);
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
        </div>
      )}
    </>
  );
}
