import { useState } from "react";

import type { Settings } from "@/lib/tauri";
import { MigrationSection, MigrationWizardDialog } from "@/modules/migration";

import { LeagueSection } from "./LeagueSection";
import { MinimizeToTraySection } from "./MinimizeToTraySection";
import { SettingsGrid } from "./SettingsGrid";

interface GeneralSectionProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
}

export function GeneralSection({ settings, onSave }: GeneralSectionProps) {
  const [migrationOpen, setMigrationOpen] = useState(false);

  return (
    <SettingsGrid>
      <LeagueSection settings={settings} onSave={onSave} className="lg:col-span-2" />
      <MinimizeToTraySection settings={settings} onSave={onSave} />
      <MigrationSection onImport={() => setMigrationOpen(true)} />
      <MigrationWizardDialog open={migrationOpen} onClose={() => setMigrationOpen(false)} />
    </SettingsGrid>
  );
}
