import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useContentVisible } from "@/hooks";
import type { AssetRef } from "@/lib/tauri";

import { useBinDocument } from "../../bin/documents/hooks/useBinDocument";
import { assetKey } from "../../preview/utils/assetRef";
import { usePreviewGeneration } from "../state/previewStills";
import { assignSlots, slotsEquals } from "../utils/previewSlots";
import {
  DOCKED,
  type ObjectPreviewJob,
  ObjectPreviewSlot,
  type PreviewDisplay,
} from "./ObjectPreviewSlot";

/** How many previews load and render at once. Each slot has a separate canvas. */
export const PREVIEW_CONCURRENCY = 2;

/** How long a bin stays loaded after its last preview, so the next object from it skips the parse. */
const UNLOAD_DELAY_MS = 10_000;

/** How many bins stay loaded for previews at once. */
const MAX_LOADED = 4;

/** What a grid asks the pool to render. */
export interface PreviewRequest {
  /** The played preview. It gets a slot before any still. */
  readonly live: { readonly job: ObjectPreviewJob; readonly display: PreviewDisplay } | null;
  /** The stills to render, in priority order. */
  readonly stills: readonly ObjectPreviewJob[];
  /** Whether a free slot may start a new still. False during a scroll. */
  readonly admit: boolean;
  /** Called when the large popover closes. */
  readonly onDismiss: () => void;
}

interface PreviewPool {
  readonly submit: (request: PreviewRequest | null) => void;
  /** The still keys the slots are rendering. */
  readonly running: ReadonlySet<string>;
}

const PreviewPoolContext = createContext<PreviewPool | null>(null);

/** The objects document's preview pool, and null outside one. */
export function usePreviewPool(): PreviewPool | null {
  return use(PreviewPoolContext);
}

interface ObjectPreviewPoolProps {
  /** Whether the canvases are mounted. True in the grid view with thumbnails on. */
  mounted: boolean;
  /** Whether the pool renders. False for a hidden document. */
  active: boolean;
  children: ReactNode;
}

/**
 * The renderer slots of one objects document, mounted above its grids.
 *
 * A folder change, a search keystroke or a hidden tab replaces the grid and keeps the
 * canvases and their compiled shader programs. An idle slot stops its frame loop and stays
 * mounted. The bins the slots read stay loaded for `UNLOAD_DELAY_MS` after their last job.
 */
export function ObjectPreviewPool({ mounted, active, children }: ObjectPreviewPoolProps) {
  const visible = useContentVisible();
  const foreground = useForeground();
  const generation = usePreviewGeneration();
  const [request, setRequest] = useState<PreviewRequest | null>(null);
  const [slots, setSlots] = useState<readonly (ObjectPreviewJob | null)[]>(() =>
    Array<ObjectPreviewJob | null>(PREVIEW_CONCURRENCY).fill(null),
  );
  const working = mounted && active && visible && foreground && request !== null;

  useLayoutEffect(() => {
    setSlots((previous) => {
      const next = working
        ? assignSlots(previous, request.live?.job ?? null, request.stills, request.admit)
        : previous.map(() => null);
      return slotsEquals(previous, next) ? previous : next;
    });
  }, [working, request]);

  const running = useMemo(
    () => new Set(slots.flatMap((job) => (job === null ? [] : [job.key]))),
    [slots],
  );
  const pool = useMemo(() => ({ submit: setRequest, running }), [running]);

  const latest = useRef(request);
  latest.current = request;
  const dismiss = useCallback(() => latest.current?.onDismiss(), []);

  const loaded = useLoadedBins(slots);

  return (
    <PreviewPoolContext value={pool}>
      {children}
      {mounted &&
        slots.map((job, slot) => (
          <ObjectPreviewSlot
            key={slot}
            job={job}
            display={
              job !== null && request?.live?.job.key === job.key ? request.live.display : DOCKED
            }
            generation={generation}
            onDismiss={dismiss}
          />
        ))}
      {loaded.map(({ key, asset, entry }) => (
        <BinLoader key={key} asset={asset} entry={entry} />
      ))}
    </PreviewPoolContext>
  );
}

/** Whether the window is visible, from `document.hidden`. */
function useForeground(): boolean {
  const [foreground, setForeground] = useState(() => !document.hidden);

  useEffect(() => {
    const changed = () => setForeground(!document.hidden);
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);

  return foreground;
}

interface LoadedBin {
  readonly key: string;
  readonly asset: AssetRef;
  readonly entry: string;
  readonly used: number;
}

/**
 * The bins the slots read, loaded while a job reads them and for `UNLOAD_DELAY_MS` after.
 *
 * The backend parses a bin only when no id has it open, so consecutive objects from one bin
 * share one parse.
 */
function useLoadedBins(slots: readonly (ObjectPreviewJob | null)[]): readonly LoadedBin[] {
  const [loaded, setLoaded] = useState<readonly LoadedBin[]>([]);

  useEffect(() => {
    const refresh = () =>
      setLoaded((previous) => {
        const now = Date.now();
        const byKey = new Map(previous.map((bin) => [bin.key, bin]));
        const busy = new Set<string>();
        for (const job of slots) {
          const declaration = job?.node.declarations[0];
          if (!job || !declaration) continue;

          const key = assetKey(declaration.asset);
          busy.add(key);
          byKey.set(key, {
            key,
            asset: declaration.asset,
            entry: byKey.get(key)?.entry ?? job.node.objectHash,
            used: now,
          });
        }

        const next = [...byKey.values()]
          .filter((bin) => busy.has(bin.key) || now - bin.used < UNLOAD_DELAY_MS)
          .sort((a, b) => b.used - a.used)
          .slice(0, MAX_LOADED);
        const unchanged =
          next.length === previous.length &&
          next.every(
            (bin, index) => bin.key === previous[index]?.key && bin.used === previous[index].used,
          );
        return unchanged ? previous : next;
      });

    refresh();
    const timer = window.setTimeout(refresh, UNLOAD_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [slots]);

  return loaded;
}

function BinLoader({ asset, entry }: { asset: AssetRef; entry: string }) {
  useBinDocument(asset, entry);
  return null;
}
