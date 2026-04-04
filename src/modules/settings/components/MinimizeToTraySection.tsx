import { MonitorDown } from "lucide-react";

import { SectionCard, Switch } from "@/components";
import type { Settings } from "@/lib/tauri";

interface MinimizeToTraySectionProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
}

export function MinimizeToTraySection({ settings, onSave }: MinimizeToTraySectionProps) {
  return (
    <SectionCard title="System Tray & Autostart" icon={<MonitorDown className="h-5 w-5" />}>
      <div className="space-y-3">
        <label className="flex items-center justify-between gap-4">
          <div>
            <span className="block text-sm font-medium text-surface-200">
              Minimize to system tray
            </span>
            <span className="block text-sm text-surface-400">
              When enabled, clicking the minimize button will hide the application to the system
              tray instead of the taskbar. Click the tray icon to restore.
            </span>
          </div>
          <Switch
            checked={settings.minimizeToTray}
            onCheckedChange={(checked) => onSave({ ...settings, minimizeToTray: checked })}
          />
        </label>
        <label className="flex items-center justify-between gap-4">
          <div>
            <span className="block text-sm font-medium text-surface-200">
              Start minimized to tray
            </span>
            <span className="block text-sm text-surface-400">
              When enabled, the application will start hidden in the system tray. Click the tray
              icon to open.
            </span>
          </div>
          <Switch
            checked={settings.startInTray}
            onCheckedChange={(checked) => onSave({ ...settings, startInTray: checked })}
          />
        </label>
        <label className="flex items-center justify-between gap-4">
          <div>
            <span className="block text-sm font-medium text-surface-200">Auto Run</span>
            <span className="block text-sm text-surface-400">
              Automatically launch LTK Manager when you start your computer.
            </span>
          </div>
          <Switch
            checked={settings.autoRun}
            onCheckedChange={(checked) => onSave({ ...settings, autoRun: checked })}
          />
        </label>
        {settings.autoRun && (
          <label className="flex items-center justify-between gap-4 border-l-2 border-surface-700 pl-4">
            <div>
              <span className="block text-sm font-medium text-surface-200">
                Start in tray unless update available
              </span>
              <span className="block text-sm text-surface-400">
                Stay hidden in the tray on autostart — but show the window automatically if a new
                update is ready.
              </span>
            </div>
            <Switch
              checked={settings.startInTrayUnlessUpdate}
              onCheckedChange={(checked) =>
                onSave({ ...settings, startInTrayUnlessUpdate: checked })
              }
            />
          </label>
        )}
        <label className="flex items-center justify-between gap-4">
          <div>
            <span className="block text-sm font-medium text-surface-200">
              Always start patcher at launch
            </span>
            <span className="block text-sm text-surface-400">
              Automatically start patching mods every time the app launches, this starts last active
              profile.
            </span>
          </div>
          <Switch
            checked={settings.alwaysStartPatcher}
            onCheckedChange={(checked) => onSave({ ...settings, alwaysStartPatcher: checked })}
          />
        </label>
      </div>
    </SectionCard>
  );
}
