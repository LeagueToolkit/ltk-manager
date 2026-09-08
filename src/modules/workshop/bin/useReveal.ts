import { useCallback, useEffect, useRef, useState } from "react";

import type { BinRow } from "@/lib/tauri";

import { ancestorKeys, isUnder, rowKey } from "./binRows";

/** A row the tree is asked to expand, focus and scroll to. A new token scrolls again. */
export interface TreeReveal {
  readonly key: string;
  readonly token: number;
}

/** The row a reveal landed on, until a reader moves. */
export interface Revealed {
  readonly focused: string | null;
  readonly clearFocus: () => void;
}

/**
 * The row a reveal opens down to, focuses and scrolls to.
 *
 * Every level above the row opens, so a nested key is on screen once each of them has
 * answered, and the scroll waits for the line to exist. A request for a row this tree
 * does not hold is left alone.
 */
export function useReveal(
  reveal: TreeReveal | null,
  roots: readonly BinRow[],
  expand: (keys: Iterable<string>) => void,
  scrollToKey: (key: string) => boolean,
): Revealed {
  const [focused, setFocused] = useState<string | null>(null);
  const [scrollTo, setScrollTo] = useState<TreeReveal | null>(null);

  useEffect(() => {
    if (reveal === null) return;
    const ancestors = ancestorKeys(reveal.key).filter((key) =>
      roots.some((row) => isUnder(rowKey(row), key)),
    );
    if (ancestors.length === 0) return;
    expand(ancestors);
    setFocused(reveal.key);
    setScrollTo(reveal);
  }, [reveal, roots, expand]);

  /* Keyed on the request's token. A second request for the same row scrolls again. */
  const scrolledToken = useRef<number | null>(null);
  useEffect(() => {
    if (scrollTo === null || scrolledToken.current === scrollTo.token) return;
    if (scrollToKey(scrollTo.key)) scrolledToken.current = scrollTo.token;
  }, [scrollTo, scrollToKey]);

  const clearFocus = useCallback(() => setFocused(null), []);

  return { focused, clearFocus };
}
