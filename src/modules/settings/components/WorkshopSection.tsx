import type { Settings } from "@/lib/tauri";

import { AuthorProfilesSection } from "./AuthorProfilesSection";
import { SettingsGrid } from "./SettingsGrid";
import { WorkshopPathSection } from "./WorkshopPathSection";

interface WorkshopSectionProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
}

export function WorkshopSection({ settings, onSave }: WorkshopSectionProps) {
  return (
    <SettingsGrid>
      <WorkshopPathSection settings={settings} onSave={onSave} />
      <AuthorProfilesSection settings={settings} onSave={onSave} />
    </SettingsGrid>
  );
}
