import type { ReactNode } from "react";

import type { Settings } from "@/lib/tauri";

import { LeagueSection } from "./LeagueSection";
import { StartupAndTraySection } from "./StartupAndTraySection";

interface GeneralSectionProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
  /* A slot rather than an import: settings sits under migration in the module
     order, so naming it here would close a cycle. */
  migration?: ReactNode;
}

export function GeneralSection({ settings, onSave, migration }: GeneralSectionProps) {
  return (
    <div className="flex flex-col gap-6">
      <LeagueSection settings={settings} onSave={onSave} />
      <StartupAndTraySection settings={settings} onSave={onSave} />
      {migration}
    </div>
  );
}
