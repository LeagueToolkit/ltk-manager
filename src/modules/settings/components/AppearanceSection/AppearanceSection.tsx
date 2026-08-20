import { PaletteIcon } from "@phosphor-icons/react";

import { SectionCard, Separator } from "@/components";
import type { Settings } from "@/lib/tauri";

import { SettingRow } from "../SettingRow";
import { AccentColorPicker } from "./AccentColorPicker";
import { BackdropImagePicker } from "./BackdropImagePicker";
import { CornerStylePicker } from "./CornerStylePicker";
import { ReduceMotionPicker } from "./ReduceMotionPicker";
import { ResetAppearanceButton } from "./ResetAppearanceButton";
import { ScrollbarSizePicker } from "./ScrollbarSizePicker";
import { ScrollModePicker } from "./ScrollModePicker";
import { SurfaceTintPicker } from "./SurfaceTintPicker";
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
      action={<ResetAppearanceButton settings={settings} onSave={onSave} />}
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
          hint="The last swatch opens a hue slider for a color of your own."
          control={<AccentColorPicker settings={settings} onSave={onSave} />}
        />

        <SettingRow
          kind="action"
          title="Surface tint"
          description="How much of the accent color carries into panels and backgrounds."
          hint="At 0% every surface is a neutral grey and only the accent itself holds color."
          controlClassName="w-72 shrink"
          control={<SurfaceTintPicker />}
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

        <SettingRow
          kind="action"
          title="Scrolling"
          hint="Spring rubber-bands when a list is pushed past its end."
          control={<ScrollModePicker />}
        />

        <SettingRow
          kind="action"
          title="Scrollbars"
          description="How thick every scrollbar draws."
          control={<ScrollbarSizePicker />}
        />

        <Separator className="my-0" />

        <BackdropImagePicker settings={settings} onSave={onSave} />
      </div>
    </SectionCard>
  );
}
