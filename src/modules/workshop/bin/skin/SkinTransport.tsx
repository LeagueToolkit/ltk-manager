import { useEffect, useState } from "react";

import { Select } from "@/components";
import { m } from "@/i18n";
import type { AnimationClip } from "@/lib/tauri";
import type { SceneClock } from "@/modules/viewport";

import { Playhead, Transport } from "../vfx/Transport";
import { foldedTime } from "./follow";
import { BIND_POSE } from "./skinScene";

/** How often the readout catches up with the clock, in milliseconds. */
const READOUT_MS = 100;

export interface SkinTransportProps {
  /** The scene's clock, which the scrub sets and the readout follows. */
  clock: SceneClock;
  /** Seconds one pass of the clip lasts, and zero for the bind pose. */
  duration: number;
  playing: boolean;
  /** What the frame's own seconds are multiplied by before the clock takes them. */
  speed: number;
  clips: readonly AnimationClip[];
  /** The clip posing the skin: a clip's hash, or `BIND_POSE`. */
  clip: string;
  onPlayingChange: (playing: boolean) => void;
  onSpeedChange: (speed: number) => void;
  onClipChange: (clip: string) => void;
}

/**
 * The transport under the skin, with the clip it poses.
 *
 * The readout is this bar's own state, so catching it up with the clock redraws the bar
 * and not the scene above it.
 */
export function SkinTransport({
  clock,
  duration,
  playing,
  speed,
  clips,
  clip,
  onPlayingChange,
  onSpeedChange,
  onClipChange,
}: SkinTransportProps) {
  const [readout, setReadout] = useState(() => clock.time);
  useEffect(() => {
    const timer = window.setInterval(() => setReadout(clock.time), READOUT_MS);
    return () => window.clearInterval(timer);
  }, [clock]);

  return (
    <Transport
      className="border-t border-surface-700/50"
      playing={playing}
      speed={speed}
      onPlayingChange={onPlayingChange}
      onSpeedChange={onSpeedChange}
      playhead={
        <Playhead
          time={foldedTime(readout, duration)}
          span={duration}
          onSeek={(time) => {
            clock.seek(time);
            setReadout(time);
          }}
        />
      }
      onRestart={() => {
        clock.restart();
        setReadout(0);
      }}
    >
      {clips.length > 0 && <ClipPicker clips={clips} value={clip} onValueChange={onClipChange} />}
    </Transport>
  );
}

interface ClipPickerProps {
  clips: readonly AnimationClip[];
  /** A clip's hash, or `BIND_POSE`. */
  value: string;
  onValueChange: (value: string) => void;
}

/** Which clip of the graph poses the skin, or none. */
function ClipPicker({ clips, value, onValueChange }: ClipPickerProps) {
  const nameOf = (held: string | null) =>
    held === BIND_POSE
      ? m.workshop_bin_mesh_preview_bind_label()
      : (clips.find((clip) => clip.hash === held)?.name ?? "");

  return (
    <Select.Root
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
    >
      <Select.Trigger
        aria-label={m.workshop_bin_mesh_preview_clip_label()}
        className="h-7 w-44 shrink-0 gap-1 px-2 text-meta"
      >
        <Select.Value className="truncate">{nameOf}</Select.Value>
        <Select.Icon />
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner>
          <Select.Popup>
            <Select.Item value={BIND_POSE}>{m.workshop_bin_mesh_preview_bind_label()}</Select.Item>
            {clips.map((clip) => (
              <Select.Item key={clip.hash} value={clip.hash}>
                {clip.name}
              </Select.Item>
            ))}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
