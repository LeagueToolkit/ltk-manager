import { Palette } from "lucide-react";

import { SectionCard } from "@/components";
import type { Settings } from "@/lib/tauri";

import { AccentColorPicker } from "./AccentColorPicker";
import { BackdropImagePicker } from "./BackdropImagePicker";
import { DensityPicker } from "./DensityPicker";
import { ReduceMotionPicker } from "./ReduceMotionPicker";
import { ThemePicker } from "./ThemePicker";

interface AppearanceSectionProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
}

export function AppearanceSection({ settings, onSave }: AppearanceSectionProps) {
  return (
    <SectionCard title="Appearance" icon={<Palette className="h-5 w-5" />}>
      <div className="space-y-6">
        <ThemePicker settings={settings} onSave={onSave} />
        <AccentColorPicker settings={settings} onSave={onSave} />
        <BackdropImagePicker settings={settings} onSave={onSave} />
        <DensityPicker />
        <ReduceMotionPicker />
      </div>
    </SectionCard>
  );
}
