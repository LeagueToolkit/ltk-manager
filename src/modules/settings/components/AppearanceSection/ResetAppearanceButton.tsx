import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react";

import { Button } from "@/components";
import type { Settings } from "@/lib/tauri";
import { useIsAppearanceDefault, useResetAppearance } from "@/stores";

import { LTK_PRESET } from "../../api";

interface ResetAppearanceButtonProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
}

/** Puts every Appearance row back to what a fresh install shows. */
export function ResetAppearanceButton({ settings, onSave }: ResetAppearanceButtonProps) {
  const resetAppearance = useResetAppearance();
  const displayIsDefault = useIsAppearanceDefault();

  // An unset preset is the brand, matching the fallback in useTheme.
  const settingsAreDefault =
    settings.theme === "system" &&
    (settings.accentColor?.preset ?? LTK_PRESET) === LTK_PRESET &&
    settings.accentColor?.customHue == null &&
    settings.backdropImage == null;

  function handleReset() {
    onSave({
      ...settings,
      theme: "system",
      accentColor: { preset: null, customHue: null },
      backdropImage: null,
      backdropBlur: null,
    });
    resetAppearance();
  }

  return (
    <Button
      variant="outline"
      size="sm"
      left={<ArrowCounterClockwiseIcon weight="bold" className="h-4 w-4" />}
      onClick={handleReset}
      disabled={displayIsDefault && settingsAreDefault}
    >
      Reset to default
    </Button>
  );
}
