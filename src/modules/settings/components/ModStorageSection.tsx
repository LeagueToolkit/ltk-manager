import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, HardDrive } from "lucide-react";

import { Field, IconButton, SectionCard, Tooltip } from "@/components";
import type { Settings } from "@/lib/tauri";

interface ModStorageSectionProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
}

export function ModStorageSection({ settings, onSave }: ModStorageSectionProps) {
  async function handleBrowse() {
    try {
      const selected = await open({
        directory: true,
        title: "Select Mod Storage Location",
      });

      if (selected) {
        onSave({ ...settings, modStoragePath: selected as string });
      }
    } catch (error) {
      console.error("Failed to browse:", error);
    }
  }

  return (
    <SectionCard title="Mod Storage" icon={<HardDrive className="h-5 w-5" />}>
      <div className="space-y-3">
        <span className="block text-sm font-medium text-surface-400">Storage Location</span>
        <div className="flex gap-2">
          <Field.Control
            type="text"
            value={settings.modStoragePath || ""}
            readOnly
            placeholder="Default (app data directory)"
            className="flex-1"
          />
          <Tooltip content="Browse">
            <IconButton
              icon={<FolderOpen className="h-5 w-5" />}
              variant="outline"
              size="lg"
              onClick={handleBrowse}
            />
          </Tooltip>
        </div>
        <p className="text-sm text-surface-400">
          Choose where your installed mods will be stored. Leave empty to use the default location.
        </p>
      </div>
    </SectionCard>
  );
}
