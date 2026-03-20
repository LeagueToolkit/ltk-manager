import { Eye } from "lucide-react";

import { AlertBox, SectionCard, Switch } from "@/components";
import type { Settings } from "@/lib/tauri";

interface WatcherSectionProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
}

export function WatcherSection({ settings, onSave }: WatcherSectionProps) {
  return (
    <SectionCard title="Library Watcher" icon={<Eye className="h-5 w-5" />}>
      <div className="space-y-3">
        <AlertBox variant="warning" title="Experimental feature">
          The library watcher may behave unexpectedly on some system configurations. File system
          notifications can vary across platforms and antivirus software, which may cause false
          triggers or missed updates.
        </AlertBox>
        <label className="flex items-center justify-between gap-4">
          <div>
            <span className="block text-sm font-medium text-surface-200">
              Watch for external changes
            </span>
            <span className="block text-sm text-surface-400">
              Automatically detect when mod files are added or removed outside the app and update
              the library. Requires a restart to take effect.
            </span>
          </div>
          <Switch
            checked={settings.watcherEnabled}
            onCheckedChange={(checked) => onSave({ ...settings, watcherEnabled: checked })}
          />
        </label>
      </div>
    </SectionCard>
  );
}
