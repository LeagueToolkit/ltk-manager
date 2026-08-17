import { BooksIcon } from "@phosphor-icons/react";

import { PathField, SectionCard, Separator, Switch } from "@/components";
import type { Settings } from "@/lib/tauri";

import { ExperimentalChip } from "./ExperimentalChip";
import { SettingRow } from "./SettingRow";
import { TrustedDomainsEditor } from "./TrustedDomainsEditor";

interface LibrarySectionProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
}

export function LibrarySection({ settings, onSave }: LibrarySectionProps) {
  return (
    <SectionCard
      title="Library"
      icon={<BooksIcon className="h-5 w-5" />}
      description="Options for your mod library"
    >
      <div className="flex flex-col gap-3">
        <PathField
          pick="directory"
          label="Storage Location"
          value={settings.modStoragePath}
          onSelect={(path) => onSave({ ...settings, modStoragePath: path })}
          placeholder="Default (app data directory)"
          dialogTitle="Select Mod Storage Location"
          description="Leave empty for the app data directory."
        />

        <Separator className="my-0" />

        <SettingRow
          title="Automatically categorize mods"
          description="Champions, maps and tags get read from each mod's files."
          hint="They are offered as suggested categories and as library filters. Turn this off to rely only on the categories you set yourself."
          control={
            <Switch
              checked={settings.autoCategorizationEnabled}
              onCheckedChange={(checked) =>
                onSave({ ...settings, autoCategorizationEnabled: checked })
              }
            />
          }
        />

        <SettingRow
          title={
            <>
              Watch for external changes
              <ExperimentalChip />
            </>
          }
          description="Mods added or removed outside the app show up in the library."
          hint="Filesystem notifications vary across platforms and antivirus software, so watching can miss an update or fire falsely. Requires a restart to take effect."
          control={
            <Switch
              checked={settings.watcherEnabled}
              onCheckedChange={(checked) => onSave({ ...settings, watcherEnabled: checked })}
            />
          }
        />

        <Separator className="my-0" />

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-surface-200">Trusted mod providers</span>
          <TrustedDomainsEditor settings={settings} onSave={onSave} />
        </div>
      </div>
    </SectionCard>
  );
}
