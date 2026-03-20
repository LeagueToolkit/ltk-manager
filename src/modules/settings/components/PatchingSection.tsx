import { Wrench } from "lucide-react";

import { SectionCard, Switch } from "@/components";
import type { Settings } from "@/lib/tauri";

interface PatchingSectionProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
}

export function PatchingSection({ settings, onSave }: PatchingSectionProps) {
  return (
    <SectionCard title="Patching" icon={<Wrench className="h-5 w-5" />}>
      <div className="space-y-3">
        <label className="flex items-center justify-between gap-4">
          <div>
            <span className="block text-sm font-medium text-surface-200">Patch TFT files</span>
            <span className="block text-sm text-surface-400">
              Apply mods to Teamfight Tactics game files (Map22.wad.client). Disable this if you
              only play Summoner&apos;s Rift.
            </span>
          </div>
          <Switch
            checked={settings.patchTft}
            onCheckedChange={(checked) => onSave({ ...settings, patchTft: checked })}
          />
        </label>
      </div>
    </SectionCard>
  );
}
