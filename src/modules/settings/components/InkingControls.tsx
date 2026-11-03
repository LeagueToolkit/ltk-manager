import { Button, ColorPicker, Popover, Slider } from "@/components";
import type { Rgb8 } from "@/lib/tauri";

import { colorToRgb8, rgb8ToColor } from "../builtinMods";
import { useDebouncedSlider } from "./AppearanceSection/useDebouncedSlider";
import { SettingRow } from "./SettingRow";
export interface ColorSwatchProps {
  label: string;
  value: Rgb8;
  onCommit: (next: Rgb8) => void;
}

/** A stored color as a swatch button that opens a picker, written on every change. */
export function ColorSwatch({ label, value, onCommit }: ColorSwatchProps) {
  return (
    <Popover.Root>
      <Popover.Trigger
        render={
          <Button
            variant="outline"
            size="sm"
            aria-label={label}
            left={
              <span
                className="size-4 rounded-sm border border-surface-veil-strong"
                style={{ backgroundColor: value }}
              />
            }
            className="font-mono text-code"
          >
            {value.toUpperCase()}
          </Button>
        }
      />
      <Popover.Content
        side="left"
        align="center"
        sideOffset={12}
        aria-label={label}
        className="w-60 p-3"
      >
        <ColorPicker
          value={rgb8ToColor(value)}
          label={label}
          onValueChange={(next) => onCommit(colorToRgb8(next))}
        />
      </Popover.Content>
    </Popover.Root>
  );
}

export interface InkingSliderRowProps {
  setting:
    | "builtinMods.characterInking.width"
    | "builtinMods.characterInking.opacity"
    | "builtinMods.characterInking.cameraDistance"
    | "builtinMods.characterInking.deathFade";
  value: number;
  min: number;
  max: number;
  step?: number;
  hint?: string;
  hidden?: boolean;
  readout: (value: number) => string;
  onSave: (value: number) => void;
}

/** One numeric inking setting as a slider with its value read out, saved after the drag settles. */
export function InkingSliderRow({
  setting,
  value,
  min,
  max,
  step = 1,
  hint,
  hidden = false,
  readout,
  onSave,
}: InkingSliderRowProps) {
  const [local, setLocal] = useDebouncedSlider(value, onSave);

  return (
    <SettingRow
      setting={setting}
      dependent
      hidden={hidden}
      hint={hint}
      control={
        <div className="flex w-64 items-center gap-3">
          <Slider
            value={local}
            min={min}
            max={max}
            step={step}
            onValueChange={setLocal}
            className="flex-1"
          />
          <span className="w-12 text-right font-mono text-sm text-surface-300 tabular-nums">
            {readout(local)}
          </span>
        </div>
      }
    />
  );
}
