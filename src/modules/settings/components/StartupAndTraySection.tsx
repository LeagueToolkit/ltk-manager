import { MonitorIcon } from "@phosphor-icons/react";

import { SectionCard, SegmentedControl, Switch } from "@/components";
import { m } from "@/i18n";
import type { OpenOn, Settings } from "@/lib/tauri";
import { discardDownload } from "@/modules/updater";

import { SettingGroup } from "./SettingGroup";
import { SettingRow } from "./SettingRow";

const OPEN_ON_OPTIONS: { value: OpenOn; label: string }[] = [
  { value: "home", label: "Home" },
  { value: "mods", label: "Mods" },
  { value: "workshop", label: "Workshop" },
];

interface StartupAndTraySectionProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
}

export function StartupAndTraySection({ settings, onSave }: StartupAndTraySectionProps) {
  const saveAutoDownload = (checked: boolean) => {
    onSave({ ...settings, autoDownloadUpdates: checked });
    if (!checked) void discardDownload();
  };

  return (
    <SectionCard title="Startup and tray" icon={<MonitorIcon className="h-5 w-5" />}>
      <SettingGroup id="general.startup" title="Startup">
        <SettingRow
          setting="autoRun"
          description="Automatically launch LTK Manager when you start your computer."
          control={
            <Switch
              checked={settings.autoRun}
              onCheckedChange={(checked) => onSave({ ...settings, autoRun: checked })}
            />
          }
        />

        <SettingRow
          setting="startInTrayUnlessUpdate"
          dependent
          hidden={!settings.autoRun}
          description="Stay hidden in the tray on autostart, and show the window when a new update is ready."
          control={
            <Switch
              checked={settings.startInTrayUnlessUpdate}
              onCheckedChange={(checked) =>
                onSave({ ...settings, startInTrayUnlessUpdate: checked })
              }
            />
          }
        />

        <SettingRow
          setting="alwaysStartPatcher"
          description="Starts your last active profile every time the app launches."
          control={
            <Switch
              checked={settings.alwaysStartPatcher}
              onCheckedChange={(checked) => onSave({ ...settings, alwaysStartPatcher: checked })}
            />
          }
        />

        <SettingRow
          kind="action"
          setting="openOn"
          control={
            <SegmentedControl
              options={OPEN_ON_OPTIONS}
              value={settings.openOn}
              onChange={(openOn) => onSave({ ...settings, openOn })}
            />
          }
        />
      </SettingGroup>

      <SettingGroup id="general.tray" title="Tray">
        <SettingRow
          setting="minimizeToTray"
          description="Minimizing hides the window to the tray instead of the taskbar. Click the tray icon to restore it."
          control={
            <Switch
              checked={settings.minimizeToTray}
              onCheckedChange={(checked) => onSave({ ...settings, minimizeToTray: checked })}
            />
          }
        />

        <SettingRow
          setting="startInTray"
          description="The app starts hidden in the tray. Click the tray icon to open it."
          control={
            <Switch
              checked={settings.startInTray}
              onCheckedChange={(checked) => onSave({ ...settings, startInTray: checked })}
            />
          }
        />
      </SettingGroup>

      <SettingGroup id="general.updates" title={m.settings_updates_title()}>
        <SettingRow
          setting="autoDownloadUpdates"
          description={m.settings_updates_auto_download_description()}
          control={
            <Switch checked={settings.autoDownloadUpdates} onCheckedChange={saveAutoDownload} />
          }
        />
      </SettingGroup>
    </SectionCard>
  );
}
