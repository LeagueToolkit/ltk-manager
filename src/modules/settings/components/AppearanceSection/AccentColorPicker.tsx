import { Popover, Tooltip } from "@/components";
import type { Settings } from "@/lib/tauri";

import { ACCENT_PRESETS, LTK_PRESET } from "../../api";
import { useDebouncedSlider } from "./useDebouncedSlider";

/** Hue the custom slider opens on when the brand preset is active. */
const BRAND_HUE = 223;

const HUE_WHEEL = `conic-gradient(
  hsl(0, 100%, 50%), hsl(60, 100%, 50%), hsl(120, 100%, 50%),
  hsl(180, 100%, 50%), hsl(240, 100%, 50%), hsl(300, 100%, 50%), hsl(360, 100%, 50%)
)`;

const HUE_RAMP = `linear-gradient(to right,
  hsl(0, 100%, 50%), hsl(60, 100%, 50%), hsl(120, 100%, 50%),
  hsl(180, 100%, 50%), hsl(240, 100%, 50%), hsl(300, 100%, 50%), hsl(360, 100%, 50%)
)`;

const ACCENT_PRESET_DISPLAY: { key: string; label: string; background: string }[] = [
  {
    key: LTK_PRESET,
    label: "LeagueToolkit",
    background: "linear-gradient(135deg, var(--ltk-blue), var(--ltk-violet))",
  },
  { key: "blue", label: "Blue", background: "hsl(207, 100%, 50%)" },
  { key: "purple", label: "Purple", background: "hsl(271, 100%, 50%)" },
  { key: "green", label: "Green", background: "hsl(122, 100%, 35%)" },
  { key: "orange", label: "Orange", background: "hsl(36, 100%, 50%)" },
  { key: "pink", label: "Pink", background: "hsl(340, 100%, 50%)" },
  { key: "red", label: "Red", background: "hsl(4, 100%, 50%)" },
  { key: "teal", label: "Teal", background: "hsl(174, 100%, 35%)" },
];

const swatchClass =
  "h-6 w-6 rounded-md transition-[filter] hover:brightness-125 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500";
const activeSwatchClass = "ring-2 ring-surface-400 ring-offset-2 ring-offset-surface-900";

interface AccentColorPickerProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
}

export function AccentColorPicker({ settings, onSave }: AccentColorPickerProps) {
  const isCustomHue = settings.accentColor?.customHue != null;
  const settingsHue = isCustomHue
    ? settings.accentColor.customHue!
    : settings.accentColor?.preset
      ? (ACCENT_PRESETS[settings.accentColor.preset] ?? BRAND_HUE)
      : BRAND_HUE;

  // An unset preset is the brand, matching the fallback in useTheme.
  const activePreset = isCustomHue ? null : (settings.accentColor?.preset ?? LTK_PRESET);

  const [localHue, handleHueChange] = useDebouncedSlider(settingsHue, (hue) => {
    onSave({ ...settings, accentColor: { preset: null, customHue: hue } });
  });

  function handlePresetClick(preset: string) {
    onSave({ ...settings, accentColor: { preset, customHue: null } });
  }

  return (
    <div className="flex items-center gap-1.5">
      {ACCENT_PRESET_DISPLAY.map(({ key, label, background }) => (
        <Tooltip key={key} content={label}>
          <button
            type="button"
            onClick={() => handlePresetClick(key)}
            aria-label={label}
            aria-pressed={activePreset === key}
            className={activePreset === key ? `${swatchClass} ${activeSwatchClass}` : swatchClass}
            style={{ background }}
          />
        </Tooltip>
      ))}

      <Popover.Root>
        <Popover.Trigger
          render={
            <button
              type="button"
              aria-label="Custom hue"
              aria-pressed={isCustomHue}
              className={isCustomHue ? `${swatchClass} ${activeSwatchClass}` : swatchClass}
              style={{ background: HUE_WHEEL }}
            />
          }
        />
        <Popover.Portal>
          <Popover.Positioner sideOffset={8}>
            <Popover.Popup className="w-60 p-3">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Popover.Title className="text-sm font-medium text-surface-100">
                    Custom hue
                  </Popover.Title>
                  <span className="font-mono text-xs text-surface-400">
                    {Math.round(localHue)}&deg;
                  </span>
                </div>
                <div className="relative">
                  <input
                    type="range"
                    min="0"
                    max="360"
                    value={localHue}
                    onChange={(e) => handleHueChange(Number(e.target.value))}
                    aria-label="Custom hue"
                    className="h-3 w-full cursor-pointer appearance-none rounded-full"
                    style={{ background: HUE_RAMP }}
                  />
                  <div
                    className="pointer-events-none absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-md border-2 border-brand-on shadow-md"
                    style={{
                      left: `calc(${(localHue / 360) * 100}% - 10px)`,
                      backgroundColor: `hsl(${localHue}, 100%, 50%)`,
                    }}
                  />
                </div>
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
