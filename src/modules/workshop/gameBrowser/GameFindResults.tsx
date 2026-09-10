import { useCallback, useMemo } from "react";

import { EmptyState } from "@/components";
import { errorSummary } from "@/i18n";
import { m } from "@/i18n";
import type { GameFindHit } from "@/lib/tauri";
import { twMerge } from "@/utils";
import { hasErrorCode } from "@/utils/errors";

import {
  useGameSearchPattern,
  useGameSearchRegex,
  useShutFindDirs,
  useToggleFindDir,
} from "../state";
import { GameLoadingState, GameWadsErrorState, UnknownHashHint } from "./GameBrowserStates";
import {
  buildSourceTree,
  flattenSourceTree,
  type SourceDirNode,
  type SourceEntry,
} from "./sourceIndex";
import { SourceTree } from "./SourceTree";
import { useGameFind } from "./useGameFind";
import { useSourcePreview } from "./useSourcePreview";

/**
 * The tree the pattern leaves: every matching file under its real directories.
 *
 * The hits arrive flat and in tree order, and `buildSourceTree` folds them back
 * into directories, so the filtered view reads exactly like the browse tree it
 * stands in for. Everything starts expanded, because the hits are what the
 * pattern was typed to see. The selection stays out of it: this is an answer to
 * one question rather than a place, and the copy it feeds is taken where the
 * files live.
 */
export function GameFindResults() {
  const pattern = useGameSearchPattern();
  const regex = useGameSearchRegex();
  const { data, error, isFetching } = useGameFind(pattern, regex);
  const openFile = useSourcePreview();

  /* The parse error belongs under the box, because the fix is the next
     keystroke. Every other failure replaces the tree, because the fix is not. */
  const patternError = error && hasErrorCode(error, "VALIDATION_FAILED") ? error : null;

  const shut = useShutFindDirs();
  const toggleFindDir = useToggleFindDir();
  const tree = useMemo(() => buildSourceTree((data?.hits ?? []).map(toSourceEntry)), [data]);
  const isExpanded = useCallback((node: SourceDirNode) => !shut.has(node.id), [shut]);
  const rows = useMemo(() => flattenSourceTree(tree, isExpanded), [tree, isExpanded]);
  const handleToggle = useCallback(
    (node: SourceDirNode) => toggleFindDir(node.id),
    [toggleFindDir],
  );

  if (error && !patternError) return <GameWadsErrorState error={error} />;
  if (!data && !patternError) return <GameLoadingState />;

  return (
    <>
      {patternError && (
        <p className="shrink-0 border-b border-surface-700/50 px-3 pb-1.5 font-mono text-xs whitespace-pre-wrap text-danger-text">
          {errorSummary(patternError)}
        </p>
      )}
      {data && data.unnamed && <UnknownHashHint />}
      {data && data.hits.length === 0 && (
        <EmptyState
          size="sm"
          title={m.workshop_game_no_match_title()}
          description={m.workshop_game_no_match_description()}
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
          <SourceTree
            rows={rows}
            ariaLabel={m.workshop_game_results_tree_label()}
            isExpanded={isExpanded}
            onToggle={handleToggle}
            onOpen={openFile}
            /* Per pattern, so a fresh search opens at its first hit rather than
               where the last one was read to. */
            scrollKey={`game-find:${regex ? "re" : "text"}:${pattern}`}
          />
        </div>
      )}
    </>
  );
}

function toSourceEntry(hit: GameFindHit): SourceEntry {
  return {
    pathHash: hit.pathHash,
    path: hit.path,
    sizeBytes: Number(hit.sizeBytes),
    wad: hit.wad,
    nameRanges: hit.nameRanges,
  };
}
