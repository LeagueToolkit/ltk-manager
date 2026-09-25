import { useMemo } from "react";

import { errorSummary } from "@/i18n";
import type { GameSearchHit } from "@/lib/tauri";
import { useSearchGame } from "@/stores";

import { fileKindFromPath, useGameSearch, wadBasename } from "../../gameBrowser";
import { describeFileKind } from "../../shared/utils/fileKindIcon";
import { paletteSource } from "../utils/sources";
import type { PaletteGroup, RankedRow } from "../utils/types";

/**
 * The group the installed game contributes, or null when it contributes none.
 *
 * The backend ranks these, so they arrive with their bands and marked runs
 * already decided and this only dresses them as rows. Both scorers obey one
 * rule, which `ranking.fixture.json` pins from either side.
 */
export function useGameRows(term: string, enabled: boolean): PaletteGroup | null {
  const setting = useSearchGame();
  const wanted = enabled && setting;

  const { data, isFetching, error } = useGameSearch(term, wanted);

  return useMemo(() => {
    if (!wanted || term.length === 0) return null;

    const label = paletteSource("game").label;

    /* Said rather than swallowed. Every way this source can fail - no League
       path, an install it cannot read, a backend that never answered - looks
       from here like a query that matched nothing, and a group that quietly
       does not appear is the one thing a user cannot debug. */
    if (error) return group(label, [noticeRow("game:error", errorSummary(error))]);

    /* Pending rather than absent, so the group draws placeholders while the
       first query of a session pays for the index over every archive. */
    if (!data) return { ...group(label, []), pending: isFetching };

    /* A scan a later one overtook holds part of an answer. The newer query is
       what the box is showing by now, so this one draws nothing. */
    if (data.superseded) return null;

    /* An install whose chunk names never resolved answers every path with
       nothing, which is indistinguishable from an install that holds no match.
       Say which, because the fix is a sync and not a different query. */
    if (data.unnamed) return group(label, [noticeRow("game:unnamed", UNNAMED)]);
    if (data.hits.length === 0) return null;

    /* `data` is the previous query's answer until the next one lands, which is
       what keeps this group from emptying and refilling at every keystroke.
       Pending is what says so, and the rows dim rather than vanish. */
    return {
      source: "game",
      label,
      rows: data.hits.map(toRow),
      total: data.total,
      pending: isFetching,
    };
  }, [data, error, isFetching, term, wanted]);
}

const UNNAMED = "No chunk names yet — sync the hashtables in Settings";

function group(label: string, rows: readonly RankedRow[]): PaletteGroup {
  return { source: "game", label, rows, total: 0 };
}

function toRow(hit: GameSearchHit): RankedRow {
  const descriptor = describeFileKind(fileKindFromPath(hit.name));
  const Glyph = descriptor.icon;

  return {
    row: {
      id: `game:${hit.wad}:${hit.pathHash}`,
      source: "game",
      name: hit.name,
      path: hit.path,
      trailing: wadBasename(hit.wad),
      icon: (
        <span style={{ color: `var(${descriptor.tintToken})` }}>
          <Glyph className="h-4 w-4" strokeWidth={1.75} />
        </span>
      ),
      target: {
        kind: "gameChunk",
        wad: hit.wad,
        pathHash: hit.pathHash,
        path: hit.path.length > 0 ? `${hit.path}/${hit.name}` : hit.name,
      },
    },
    /* The backend's own verdict, carried through so this group can be ordered
       against the ones the frontend ranked. Re-deriving either here would only
       invite the two scorers to disagree. */
    band: hit.band,
    score: hit.score ?? 0,
    nameRanges: hit.nameRanges,
    pathRanges: hit.pathRanges,
  };
}

/**
 * A row that reports rather than opens: what the group is waiting for, or why
 * it has nothing.
 *
 * The first scan of a session pays for the index over every archive, so the
 * group says so rather than reading as though the install held no match.
 * Disabled, so the arrows step over it and `Enter` never reaches its target.
 */
function noticeRow(id: string, text: string): RankedRow {
  return {
    /* Ranked last of anything, so a group that is only reporting never sorts
       above one that actually matched. */
    band: Number.MAX_SAFE_INTEGER,
    score: 0,
    row: {
      id,
      source: "game",
      name: text,
      path: "",
      disabled: true,
      icon: null,
      target: { kind: "prefix", prefix: "" },
    },
    nameRanges: [],
    pathRanges: [],
  };
}
