import { useLayoutEffect } from "react";

/**
 * How long a value outlives its last holder.
 *
 * A tab replacing another unmounts the old view in the same commit that mounts the new
 * one, so a value released there is held again a few milliseconds later.
 */
const RELEASE_GRACE_MS = 15_000;

interface Entry<V> {
  readonly value: V;
  holders: number;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Values shared by every view asking for one key, disposed once none has held it for a while.
 *
 * A render reads the value with `get`, and an effect holds it with `hold`, so a render
 * React throws away holds nothing and its value lapses after the grace period.
 */
export interface RetainedCache<K, V> {
  /** The value under `key`, created by `create` on the first ask. */
  readonly get: (key: K, create: () => V) => V;
  /** Hold `key`'s value until the returned release runs. */
  readonly hold: (key: K) => () => void;
  /** The value under `key` where one is cached, created by nothing. */
  readonly peek: (key: K) => V | undefined;
}

export function createRetainedCache<K, V>(dispose: (value: V) => void): RetainedCache<K, V> {
  const entries = new Map<K, Entry<V>>();

  const lapse = (key: K, entry: Entry<V>) => {
    entry.timer = setTimeout(() => {
      entries.delete(key);
      dispose(entry.value);
    }, RELEASE_GRACE_MS);
  };

  return {
    get: (key, create) => {
      const held = entries.get(key);
      if (held !== undefined) return held.value;

      const entry: Entry<V> = { value: create(), holders: 0, timer: null };
      entries.set(key, entry);
      lapse(key, entry);
      return entry.value;
    },

    hold: (key) => {
      const entry = entries.get(key);
      if (entry === undefined) return () => {};

      entry.holders += 1;
      if (entry.timer !== null) {
        clearTimeout(entry.timer);
        entry.timer = null;
      }

      let released = false;
      return () => {
        if (released) return;
        released = true;
        entry.holders -= 1;
        if (entry.holders === 0) lapse(key, entry);
      };
    },

    peek: (key) => entries.get(key)?.value,
  };
}

/** `key`'s value in `cache`, held for as long as the caller is mounted on that key. */
export function useRetained<K, V>(cache: RetainedCache<K, V>, key: K, create: () => V): V {
  const value = cache.get(key, create);
  useLayoutEffect(() => cache.hold(key), [cache, key]);
  return value;
}
