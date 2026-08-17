import { FolderOpenIcon } from "@phosphor-icons/react";

import { PathField, SectionCard } from "@/components";
import type { Settings } from "@/lib/tauri";

interface WorkshopPathSectionProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
}

export function WorkshopPathSection({ settings, onSave }: WorkshopPathSectionProps) {
  return (
    <SectionCard title="Project Storage" icon={<FolderOpenIcon className="h-5 w-5" />}>
      <PathField
        pick="directory"
        label="Workshop Directory"
        value={settings.workshopPath}
        onSelect={(path) => onSave({ ...settings, workshopPath: path })}
        placeholder="Not configured"
        dialogTitle="Select Workshop Directory"
        description="Choose where your mod projects will be stored for the Creator Workshop. This directory will contain all your project folders."
      />
    </SectionCard>
  );
}
