import { PaletteIcon } from "@phosphor-icons/react";

import { SectionCard } from "@/components";
import { shortcutOf } from "@/modules/keys";
import { useRotateAppMark } from "@/stores";

import { SettingGroup } from "../SettingGroup";
import { SettingRow } from "../SettingRow";
import { SettingScope } from "../SettingScope";
import { AccentColorPicker } from "./AccentColorPicker";
import { BackdropImagePicker } from "./BackdropImagePicker";
import { CornerStylePicker } from "./CornerStylePicker";
import { CodeFontPicker, InterfaceFontPicker } from "./FontPicker";
import { ReduceMotionPicker } from "./ReduceMotionPicker";
import { ResetAppearanceButton } from "./ResetAppearanceButton";
import { ScrollbarSizePicker } from "./ScrollbarSizePicker";
import { ScrollModePicker } from "./ScrollModePicker";
import { SurfaceTintPicker } from "./SurfaceTintPicker";
import { ThemePicker } from "./ThemePicker";
import { ZoomLevelPicker } from "./ZoomLevelPicker";

function MarkRotator() {
  const rotateAppMark = useRotateAppMark();

  return (
    <span
      className="group/rotator absolute right-0 bottom-0 size-5 p-1"
      onClick={rotateAppMark}
      aria-hidden
    >
      <span className="block size-full rounded-md transition duration-200 group-hover/rotator:bg-surface-veil group-hover/rotator:shadow-[0_0_10px] group-hover/rotator:shadow-accent-400/60 group-active/rotator:bg-surface-veil-strong" />
    </span>
  );
}

export function AppearanceSection() {
  return (
    <SettingScope>
      <SectionCard
        title="Appearance"
        icon={<PaletteIcon className="size-5" />}
        description="Options for how the app looks"
        action={<ResetAppearanceButton />}
        panelClassName="relative"
      >
        <SettingGroup id="appearance.color" title="Color">
          <SettingRow kind="action" setting="theme" control={<ThemePicker />} />

          <SettingRow
            kind="action"
            setting="accentColor"
            hint="The last swatch opens a hue slider for a color of your own."
            control={<AccentColorPicker />}
          />

          <SettingRow
            kind="action"
            setting="display.surfaceTint"
            description="How much of the accent color carries into panels and backgrounds."
            hint="At 0% every surface is a neutral grey and only the accent itself holds color."
            controlClassName="w-72 shrink"
            control={<SurfaceTintPicker />}
          />
        </SettingGroup>

        <SettingGroup id="appearance.shape-and-scale" title="Shape and scale">
          <SettingRow
            kind="action"
            setting="display.cornerStyle"
            description="How rounded every panel, button and card is."
            control={<CornerStylePicker />}
          />

          <SettingRow
            kind="action"
            setting="display.zoomLevel"
            description="Scales the whole interface."
            hint={`Click the percentage to type an exact level. ${shortcutOf("app.zoomIn")} and ${shortcutOf("app.zoomOut")} step the zoom from anywhere, and ${shortcutOf("app.zoomReset")} returns to 100%.`}
            controlClassName="w-72 shrink"
            control={<ZoomLevelPicker />}
          />
        </SettingGroup>

        <SettingGroup id="appearance.text" title="Text">
          <SettingRow kind="action" setting="display.sansFont" control={<InterfaceFontPicker />} />

          <SettingRow
            kind="action"
            setting="display.monoFont"
            hint="Each face is measured against the interface font so the two sit level."
            control={<CodeFontPicker />}
          />
        </SettingGroup>

        <SettingGroup id="appearance.motion" title="Motion">
          <SettingRow
            kind="action"
            setting="display.reduceMotion"
            hint="System follows your OS preference. On disables animations, off always animates."
            control={<ReduceMotionPicker />}
          />

          <SettingRow
            kind="action"
            setting="display.scrollMode"
            hint="Spring rubber-bands when a list is pushed past its end."
            control={<ScrollModePicker />}
          />

          <SettingRow
            kind="action"
            setting="display.scrollbarSize"
            description="How thick every scrollbar draws."
            control={<ScrollbarSizePicker />}
          />
        </SettingGroup>

        <SettingGroup id="appearance.backdrop" title="Backdrop">
          <BackdropImagePicker />
        </SettingGroup>

        <MarkRotator />
      </SectionCard>
    </SettingScope>
  );
}
