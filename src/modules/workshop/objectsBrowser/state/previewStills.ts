import { useEffect, useState } from "react";
import { create } from "zustand";

import { onBinSaved } from "../../bin/documents/state/binSaves";

/** The result of one object's preview: a still, nothing to draw, or a failure that a retry clears. */
export type PreviewOutcome =
  | { readonly kind: "image"; readonly src: string }
  | { readonly kind: "empty" }
  | { readonly kind: "failed" };

export const EMPTY_OUTCOME: PreviewOutcome = Object.freeze({ kind: "empty" });
export const FAILED_OUTCOME: PreviewOutcome = Object.freeze({ kind: "failed" });

/** Outcomes kept per session. Past this count, the oldest outcome no grid shows is removed. */
export const STILL_CAPACITY = 512;

interface PreviewStillsStore {
  /** Outcomes by still key, oldest first. */
  outcomes: ReadonlyMap<string, PreviewOutcome>;
  /** Incremented by each retry, so a slot starts a new request for a retried key. */
  generation: number;
  /** The keys each mounted grid shows. Eviction skips them. */
  pins: ReadonlyMap<symbol, ReadonlySet<string>>;
}

const usePreviewStillsStore = create<PreviewStillsStore>()(() => ({
  outcomes: new Map(),
  generation: 0,
  pins: new Map(),
}));

/**
 * The key of one object's still.
 *
 * `scope` contains the other render inputs: the project whose declarations apply and the canvas
 * ground colour. A save of an asset removes its stills by the `previewKey` prefix.
 */
export function stillKey(previewKey: string, scope: string): string {
  return `${previewKey}|${scope}`;
}

function pinned(pins: PreviewStillsStore["pins"], key: string): boolean {
  for (const keys of pins.values()) {
    if (keys.has(key)) return true;
  }
  return false;
}

/**
 * Store the outcome of `key`'s preview.
 *
 * A still is never replaced. A failure is replaced by any other outcome. Past the capacity,
 * the oldest outcome no grid shows is removed.
 */
export function savePreviewOutcome(key: string, outcome: PreviewOutcome) {
  usePreviewStillsStore.setState((store) => {
    const current = store.outcomes.get(key);
    if (current !== undefined && (current.kind !== "failed" || outcome.kind === "failed")) {
      return store;
    }

    const outcomes = new Map(store.outcomes);
    outcomes.set(key, outcome);
    for (const old of outcomes.keys()) {
      if (outcomes.size <= STILL_CAPACITY) break;
      if (!pinned(store.pins, old)) outcomes.delete(old);
    }

    return { outcomes };
  });
}

/** Forget failed outcomes, all of them or those of `keys`, so their tiles render again. */
export function retryPreviews(keys?: readonly string[]) {
  usePreviewStillsStore.setState((store) => {
    const outcomes = new Map(store.outcomes);
    for (const [key, outcome] of store.outcomes) {
      if (outcome.kind === "failed" && (keys === undefined || keys.includes(key))) {
        outcomes.delete(key);
      }
    }

    return { outcomes, generation: store.generation + 1 };
  });
}

/** Forget every outcome of `asset`, whose bytes a save changed. */
function dropAsset(asset: string) {
  const prefix = `${asset}:`;
  usePreviewStillsStore.setState((store) => {
    const outcomes = new Map([...store.outcomes].filter(([key]) => !key.startsWith(prefix)));
    return outcomes.size === store.outcomes.size ? store : { outcomes };
  });
}

onBinSaved(dropAsset);

export const usePreviewOutcomes = () => usePreviewStillsStore((s) => s.outcomes);
export const usePreviewGeneration = () => usePreviewStillsStore((s) => s.generation);

/** How many of the outcomes a grid shows are failures. */
export const useFailedInView = () =>
  usePreviewStillsStore((store) => {
    let count = 0;
    for (const [key, outcome] of store.outcomes) {
      if (outcome.kind === "failed" && pinned(store.pins, key)) count += 1;
    }
    return count;
  });

/** Protect `keys` from eviction while the caller is mounted. */
export function usePinnedPreviews(keys: ReadonlySet<string>) {
  const [owner] = useState(() => Symbol("grid"));

  useEffect(() => {
    usePreviewStillsStore.setState((store) => ({ pins: new Map(store.pins).set(owner, keys) }));
  }, [owner, keys]);

  useEffect(
    () => () =>
      usePreviewStillsStore.setState((store) => {
        const pins = new Map(store.pins);
        pins.delete(owner);
        return { pins };
      }),
    [owner],
  );
}

/** Empty the store between tests. */
export function resetPreviewStills() {
  usePreviewStillsStore.setState({ outcomes: new Map(), generation: 0, pins: new Map() });
}
