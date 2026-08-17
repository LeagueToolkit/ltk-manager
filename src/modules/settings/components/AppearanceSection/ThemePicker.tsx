import { SegmentedControl } from "@/components";
import type { Settings } from "@/lib/tauri";

type Theme = "system" | "dark" | "light";

const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

interface ThemePickerProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
}

export function ThemePicker({ settings, onSave }: ThemePickerProps) {
  return (
    <SegmentedControl
      options={THEMES}
      value={(settings.theme ?? "system") as Theme}
      onChange={(theme) => onSave({ ...settings, theme })}
    />
  );
}
