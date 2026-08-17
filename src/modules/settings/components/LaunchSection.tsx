import type { ReactNode } from "react";

import { LeagueIcon, RadioGroup, SectionCard, Switch } from "@/components";
import type { LaunchMode, Settings } from "@/lib/tauri";

interface LaunchSectionProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
}

function ExperimentalChip() {
  return (
    <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] font-medium tracking-wide text-warning-text uppercase">
      Experimental
    </span>
  );
}

const LAUNCH_MODES: {
  value: LaunchMode;
  title: string;
  description: string;
  badge?: ReactNode;
}[] = [
  {
    value: "classic",
    title: "Classic",
    description: "Play only starts the patcher. Start League however you normally do.",
  },
  {
    value: "modern",
    title: "Modern",
    description:
      "Play starts the patcher and then League. One button for the whole thing, driven through the Riot Client.",
    badge: <ExperimentalChip />,
  },
];

export function LaunchSection({ settings, onSave }: LaunchSectionProps) {
  return (
    <SectionCard title="Launching League" icon={<LeagueIcon className="h-5 w-5" />}>
      <div className="space-y-4">
        <div className="space-y-2">
          <div>
            <span className="block text-sm font-medium text-surface-200">Play button</span>
            <span className="block text-sm text-surface-400">
              Whichever you pick, the other action stays on the button&apos;s menu.
            </span>
          </div>
          <RadioGroup.Root
            value={settings.launchMode}
            onValueChange={(value: unknown) =>
              onSave({ ...settings, launchMode: value as LaunchMode })
            }
          >
            <RadioGroup.Options>
              {LAUNCH_MODES.map((mode) => (
                <RadioGroup.Card
                  key={mode.value}
                  value={mode.value}
                  title={mode.title}
                  description={mode.description}
                  badge={mode.badge}
                />
              ))}
            </RadioGroup.Options>
          </RadioGroup.Root>
        </div>

        <label className="flex items-center justify-between gap-4">
          <div>
            <span className="block text-sm font-medium text-surface-200">
              Hide the Riot Client once the game starts
            </span>
            <span className="block text-sm text-surface-400">
              Only the window is hidden. League needs the Riot Client for the whole session, so it
              keeps running in the system tray, and it stays there when you close League. Click the
              tray icon whenever you want it back.
            </span>
          </div>
          <Switch
            checked={settings.hideRiotClientOnLaunch}
            onCheckedChange={(checked) => onSave({ ...settings, hideRiotClientOnLaunch: checked })}
          />
        </label>
      </div>
    </SectionCard>
  );
}
