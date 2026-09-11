import { useFrame } from "@react-three/fiber";
import { useRef, useSyncExternalStore } from "react";

import { m } from "@/i18n";

import type { DrawnEmitter } from "./definitions";
import type { Driver } from "./driver";
import { liveParticles, livePools } from "./livePools";

/** What the corner reads of a run. */
export interface StatsSample {
  /** Simulated particles across the run's pools, a muted emitter's included. */
  readonly particles: number;
  readonly children: number;
  readonly frameMs: number;
}

/**
 * The sample the scene writes and the corner hears.
 *
 * The readout subscribes rather than being handed the sample, so catching it up redraws
 * the corner and not the scene above it.
 */
export interface StatsFeed {
  read(): StatsSample;
  write(sample: StatsSample): void;
  subscribe(listener: () => void): () => void;
}

const NO_STATS: StatsSample = { particles: 0, children: 0, frameMs: 0 };

/** How often the readout catches up with the scene, in seconds. */
const WINDOW = 0.25;

/** A feed standing at nothing, which a preview holds for as long as it draws one run. */
export function createStatsFeed(): StatsFeed {
  let held = NO_STATS;
  const listeners = new Set<() => void>();

  return {
    read: () => held,
    write(sample) {
      held = sample;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export interface StatsProbeProps {
  readonly driver: Driver;
  readonly drawn: readonly DrawnEmitter[];
  readonly feed: StatsFeed;
}

/**
 * The run's counts and the frame's time, written into `feed` four times a second.
 *
 * A tally walks every live child, so it is sampled rather than taken per frame, and the
 * milliseconds are the window's own mean rather than whatever one frame cost.
 */
export function StatsProbe({ driver, drawn, feed }: StatsProbeProps) {
  const since = useRef({ seconds: 0, frames: 0 });

  useFrame((_, delta) => {
    const held = since.current;
    held.seconds += delta;
    held.frames += 1;
    if (held.seconds < WINDOW) return;

    feed.write({
      particles: liveParticles(livePools(driver, drawn)),
      children: driver.liveChildren(),
      frameMs: (held.seconds / held.frames) * 1000,
    });
    held.seconds = 0;
    held.frames = 0;
  });

  return null;
}

/** The live counts and the frame's milliseconds, "The viewer" in docs/ux/BIN_EDITOR.md. */
export function Stats({ feed }: { feed: StatsFeed }) {
  const sample = useSyncExternalStore(feed.subscribe, feed.read);

  return (
    <div
      data-ui="Stats"
      /* DS-RADIUS */
      className="pointer-events-none absolute right-2 bottom-2 flex flex-col items-end gap-0.5 rounded-sm bg-surface-950/70 px-1.5 py-1 font-mono text-meta text-code text-surface-300 tabular-nums select-none"
    >
      <span>{m.workshop_bin_preview_stats_particles_label({ count: sample.particles })}</span>
      <span>{m.workshop_bin_preview_stats_children_label({ count: sample.children })}</span>
      <span>{m.workshop_bin_preview_stats_frame_label({ ms: sample.frameMs.toFixed(1) })}</span>
    </div>
  );
}
