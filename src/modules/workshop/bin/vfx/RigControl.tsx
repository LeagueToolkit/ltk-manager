import {
  CaretDownIcon,
  DiceFiveIcon,
  type Icon,
  MapPinSimpleIcon,
  RocketLaunchIcon,
  SparkleIcon,
  SpiralIcon,
} from "@phosphor-icons/react";

import {
  Button,
  IconButton,
  Popover,
  SegmentedControl,
  Slider,
  Switch,
  Tooltip,
} from "@/components";
import { m } from "@/i18n";
import { CHAMPION_HEIGHT } from "@/modules/viewport";

import {
  distance,
  flightPath,
  type Motion,
  RIG_PRESETS,
  type RigModel,
  type RigPreset,
} from "./rig";
import { useVfxRun } from "./run";

/** What each slider spans, in the engine's own units and seconds. */
const RANGE = {
  distance: { least: CHAMPION_HEIGHT, most: CHAMPION_HEIGHT * 20, step: CHAMPION_HEIGHT / 4 },
  speed: { least: CHAMPION_HEIGHT / 2, most: CHAMPION_HEIGHT * 25, step: CHAMPION_HEIGHT / 4 },
  radius: { least: CHAMPION_HEIGHT / 4, most: CHAMPION_HEIGHT * 8, step: CHAMPION_HEIGHT / 8 },
  period: { least: 0.25, most: 12, step: 0.25 },
  stop: { least: 0.25, most: 30, step: 0.25 },
  height: { least: 0, most: CHAMPION_HEIGHT * 3, step: CHAMPION_HEIGHT / 20 },
} as const;

/** Where the stop lands when it is switched on, which a slider then moves. */
const FIRST_STOP = 2;

const PRESET_LABEL: Record<RigPreset, () => string> = {
  still: m.workshop_bin_preview_rig_still_label,
  burst: m.workshop_bin_preview_rig_burst_label,
  missile: m.workshop_bin_preview_rig_missile_label,
  trail: m.workshop_bin_preview_rig_trail_label,
};

/** A glyph of each preset's motion: a place held, a burst out of one, a flight, a circuit. */
const PRESET_ICON: Record<RigPreset, Icon> = {
  still: MapPinSimpleIcon,
  burst: SparkleIcon,
  missile: RocketLaunchIcon,
  trail: SpiralIcon,
};

/**
 * The rig the preview drives the system on, off a pill in the viewport's own controls.
 *
 * The preset picks a motion and a lifecycle together, the sliders under it tune the one
 * the preset chose, and the seed is beside them because a rig and a seed are the two
 * halves of what a run is, "The viewer" in docs/ux/BIN_EDITOR.md.
 */
export function RigControl() {
  const { rig: choice, setRig } = useVfxRun();
  const change = (rig: RigModel) => setRig({ preset: choice.preset, rig });
  const PresetIcon = PRESET_ICON[choice.preset];

  return (
    <Popover.Root>
      <Popover.Trigger
        render={
          <Button
            variant="ghost"
            size="xs"
            compact
            left={<PresetIcon weight="bold" className="h-4 w-4" />}
            right={<CaretDownIcon weight="bold" className="h-3 w-3" />}
            aria-label={m.workshop_bin_preview_rig_label()}
          >
            {PRESET_LABEL[choice.preset]()}
          </Button>
        }
      />

      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={8}>
          <Popover.Popup
            data-ui="RigControl"
            aria-label={m.workshop_bin_preview_rig_label()}
            className="w-72 p-3 select-none"
          >
            <Popover.Title className="text-xs font-medium tracking-wide text-surface-400 uppercase">
              {m.workshop_bin_preview_rig_label()}
            </Popover.Title>
            <Popover.Description className="mt-0.5 text-meta text-surface-400">
              {m.workshop_bin_preview_rig_description()}
            </Popover.Description>

            <SegmentedControl
              className="mt-3 w-full"
              size="xs"
              aria-label={m.workshop_bin_preview_rig_label()}
              value={choice.preset}
              onChange={(preset: RigPreset) => setRig({ preset, rig: RIG_PRESETS[preset] })}
              options={presetOptions()}
            />

            <div className="mt-3 flex flex-col gap-3">
              <Row
                label={m.workshop_bin_preview_rig_height_label()}
                reading={m.workshop_bin_preview_rig_units_label({
                  value: Math.round(choice.rig.height),
                })}
                value={choice.rig.height}
                range={RANGE.height}
                onValueChange={(height) => change({ ...choice.rig, height })}
              />

              <MotionRows
                motion={choice.rig.motion}
                onMotionChange={(motion) => change({ ...choice.rig, motion })}
              />

              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-surface-300">
                  {m.workshop_bin_preview_rig_loop_label()}
                </span>
                <Switch
                  aria-label={m.workshop_bin_preview_rig_loop_label()}
                  checked={choice.rig.life === "loop"}
                  onCheckedChange={(loop) =>
                    change({ ...choice.rig, life: loop ? "loop" : "once" })
                  }
                />
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-surface-300">
                  {m.workshop_bin_preview_rig_stop_label()}
                </span>
                <Switch
                  aria-label={m.workshop_bin_preview_rig_stop_label()}
                  checked={choice.rig.stopAt != null}
                  onCheckedChange={(stop) =>
                    change({ ...choice.rig, stopAt: stop ? FIRST_STOP : null })
                  }
                />
              </div>
              {choice.rig.stopAt != null && (
                <Row
                  label={m.workshop_bin_preview_rig_stop_after_label()}
                  reading={m.workshop_bin_preview_time_label({
                    seconds: choice.rig.stopAt.toFixed(2),
                  })}
                  value={choice.rig.stopAt}
                  range={RANGE.stop}
                  onValueChange={(stopAt) => change({ ...choice.rig, stopAt })}
                />
              )}

              <SeedRow />
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The stream every draw of the run comes out of, and the button that takes another. */
function SeedRow() {
  const { seed, reroll } = useVfxRun();

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-surface-300">{m.workshop_bin_preview_seed_label()}</span>
      <div className="flex items-center gap-1">
        <span className="font-mono text-meta text-code text-surface-400 tabular-nums">{seed}</span>
        <Tooltip content={m.workshop_bin_preview_seed_reroll_action()}>
          <IconButton
            variant="ghost"
            size="xs"
            compact
            aria-label={m.workshop_bin_preview_seed_reroll_action()}
            icon={<DiceFiveIcon weight="bold" className="h-4 w-4" />}
            onClick={reroll}
          />
        </Tooltip>
      </div>
    </div>
  );
}

/** The sliders the motion in hand carries, and none for one with no parameters. */
function MotionRows({
  motion,
  onMotionChange,
}: {
  motion: Motion;
  onMotionChange: (next: Motion) => void;
}) {
  if (motion.kind === "path") {
    const flown = distance(motion.from, motion.to);

    return (
      <>
        <Row
          label={m.workshop_bin_preview_rig_distance_label()}
          reading={m.workshop_bin_preview_rig_units_label({ value: Math.round(flown) })}
          value={flown}
          range={RANGE.distance}
          onValueChange={(distance) => onMotionChange(flightPath(distance, motion.speed))}
        />
        <Row
          label={m.workshop_bin_preview_rig_speed_label()}
          reading={m.workshop_bin_preview_rig_rate_label({ value: Math.round(motion.speed) })}
          value={motion.speed}
          range={RANGE.speed}
          onValueChange={(speed) => onMotionChange({ ...motion, speed })}
        />
      </>
    );
  }

  if (motion.kind === "orbit") {
    return (
      <>
        <Row
          label={m.workshop_bin_preview_rig_radius_label()}
          reading={m.workshop_bin_preview_rig_units_label({ value: Math.round(motion.radius) })}
          value={motion.radius}
          range={RANGE.radius}
          onValueChange={(radius) => onMotionChange({ ...motion, radius })}
        />
        <Row
          label={m.workshop_bin_preview_rig_period_label()}
          reading={m.workshop_bin_preview_time_label({ seconds: motion.period.toFixed(2) })}
          value={motion.period}
          range={RANGE.period}
          onValueChange={(period) => onMotionChange({ ...motion, period })}
        />
      </>
    );
  }

  return null;
}

/** One parameter: what it is called, where it stands, and the track that moves it. */
function Row({
  label,
  reading,
  value,
  range,
  onValueChange,
}: {
  label: string;
  reading: string;
  value: number;
  range: { least: number; most: number; step: number };
  onValueChange: (next: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-surface-300">{label}</span>
        <span className="font-mono text-meta text-code text-surface-400 tabular-nums">
          {reading}
        </span>
      </div>
      <Slider
        aria-label={label}
        value={value}
        min={range.least}
        max={range.most}
        step={range.step}
        onValueChange={onValueChange}
      />
    </div>
  );
}

/** The four presets as the track's own segments, in the order the picker reads them. */
function presetOptions() {
  const presets = Object.keys(RIG_PRESETS) as RigPreset[];
  return presets.map((preset) => ({ value: preset, label: PRESET_LABEL[preset]() }));
}
