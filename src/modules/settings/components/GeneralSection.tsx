import { useState } from "react";

import type { Settings } from "@/lib/tauri";
import { MigrationSection, MigrationWizardDialog } from "@/modules/migration";

import { LaunchSection } from "./LaunchSection";
import { LeaguePathSection } from "./LeaguePathSection";
import { MinimizeToTraySection } from "./MinimizeToTraySection";
import { ModStorageSection } from "./ModStorageSection";
import { TrustedDomainsSection } from "./TrustedDomainsSection";
import { WatcherSection } from "./WatcherSection";
import { WorkshopSection } from "./WorkshopSection";

interface GeneralSectionProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
}

export function GeneralSection({ settings, onSave }: GeneralSectionProps) {
  const [migrationOpen, setMigrationOpen] = useState(false);

  return (
    <div className="space-y-6">
      <LeaguePathSection settings={settings} onSave={onSave} />
      <LaunchSection settings={settings} onSave={onSave} />
      <MinimizeToTraySection settings={settings} onSave={onSave} />
      <TrustedDomainsSection settings={settings} onSave={onSave} />
      <WatcherSection settings={settings} onSave={onSave} />
      <ModStorageSection settings={settings} onSave={onSave} />
      <WorkshopSection settings={settings} onSave={onSave} />
      <MigrationSection onImport={() => setMigrationOpen(true)} />
      <MigrationWizardDialog open={migrationOpen} onClose={() => setMigrationOpen(false)} />
    </div>
  );
}
