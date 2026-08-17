import { PaletteIcon } from "@phosphor-icons/react";

import { SectionCard, Separator } from "@/components";
import type { Settings } from "@/lib/tauri";

import { SettingRow } from "../SettingRow";
import { AccentColorPicker } from "./AccentColorPicker";
import { BackdropImagePicker } from "./BackdropImagePicker";
import { CornerStylePicker } from "./CornerStylePicker";
import { ReduceMotionPicker } from "./ReduceMotionPicker";
import { ThemePicker } from "./ThemePicker";
import { ZoomLevelPicker } from "./ZoomLevelPicker";

interface AppearanceSectionProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
}

export function AppearanceSection({ settings, onSave }: AppearanceSectionProps) {
  return (
    <SectionCard
      title="Appearance"
      icon={<PaletteIcon className="h-5 w-5" />}
      description="Options for how the app looks"
    >
      <div className="flex flex-col gap-3">
        <SettingRow
          kind="action"
          title="Theme"
          control={<ThemePicker settings={settings} onSave={onSave} />}
        />

        <SettingRow
          kind="action"
          title="Accent color"
          hint="The last swatch opens a hue slider for a colour of your own."
          control={<AccentColorPicker settings={settings} onSave={onSave} />}
        />

        <SettingRow
          kind="action"
          title="Corners"
          description="How rounded every panel, button and card is."
          control={<CornerStylePicker />}
        />

        <SettingRow
          kind="action"
          title="Zoom level"
          description="Scales the whole interface."
          control={<ZoomLevelPicker />}
        />

        <SettingRow
          kind="action"
          title="Reduce motion"
          hint="System follows your OS preference. On disables animations, off always animates."
          control={<ReduceMotionPicker />}
        />

        <Separator className="my-0" />

        <BackdropImagePicker settings={settings} onSave={onSave} />
      </div>
    </SectionCard>
  );
}
