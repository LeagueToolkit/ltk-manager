import { BooksIcon } from "@phosphor-icons/react";

import { PathField, SectionCard, Switch } from "@/components";
import type { Settings } from "@/lib/tauri";

import { ExperimentalChip } from "./ExperimentalChip";
import { SettingGroup } from "./SettingGroup";
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
      <SettingGroup id="library.storage" title="Storage">
        <SettingRow
          kind="action"
          layout="stacked"
          setting="modStoragePath"
          description="Leave empty for the app data directory."
          control={
            <PathField
              pick="directory"
              aria-label="Storage location"
              value={settings.modStoragePath}
              onSelect={(path) => onSave({ ...settings, modStoragePath: path })}
              placeholder="Default (app data directory)"
              dialogTitle="Select Mod Storage Location"
            />
          }
        />

        <SettingRow
          setting="retainModArchives"
          description="A mod keeps the .fantome it was installed from, beside its own folder."
          hint="Applies to mods installed from here on, so turning it off frees nothing already on disk. The archive is also what lets a mod be unpacked or repacked from its card later. Modpkg archives are always kept - the overlay reads their content straight out of the archive."
          control={
            <Switch
              checked={settings.retainModArchives}
              onCheckedChange={(checked) => onSave({ ...settings, retainModArchives: checked })}
            />
          }
        />
      </SettingGroup>

      <SettingGroup id="library.cataloguing" title="Cataloguing">
        <SettingRow
          setting="autoCategorizationEnabled"
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
          setting="watcherEnabled"
          badge={<ExperimentalChip />}
          description="Mods added or removed outside the app show up in the library."
          hint="Filesystem notifications vary across platforms and antivirus software, so watching can miss an update or fire falsely. Requires a restart to take effect."
          control={
            <Switch
              checked={settings.watcherEnabled}
              onCheckedChange={(checked) => onSave({ ...settings, watcherEnabled: checked })}
            />
          }
        />
      </SettingGroup>

      <SettingGroup id="library.installing" title="Installing">
        <SettingRow
          kind="action"
          layout="stacked"
          setting="trustedDomains"
          description="One-click links only install from these domains. Remove all of them to allow any source."
          control={<TrustedDomainsEditor settings={settings} onSave={onSave} />}
        />
      </SettingGroup>
    </SectionCard>
  );
}
