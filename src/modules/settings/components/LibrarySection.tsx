import { Sparkles } from "lucide-react";

import { SectionCard, Switch } from "@/components";
import type { Settings } from "@/lib/tauri";

interface LibrarySectionProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
}

export function LibrarySection({ settings, onSave }: LibrarySectionProps) {
  return (
    <SectionCard title="Mod Categorization" icon={<Sparkles className="h-5 w-5" />}>
      <label className="flex items-center justify-between gap-4">
        <div>
          <span className="block text-sm font-medium text-surface-200">
            Automatically categorize mods
          </span>
          <span className="block text-sm text-surface-400">
            Detect champions, maps and content tags from each mod&apos;s files and surface them as
            suggested categories and library filters. Disable this to rely only on the categories
            you set yourself.
          </span>
        </div>
        <Switch
          checked={settings.autoCategorizationEnabled}
          onCheckedChange={(checked) => onSave({ ...settings, autoCategorizationEnabled: checked })}
        />
      </label>
    </SectionCard>
  );
}
