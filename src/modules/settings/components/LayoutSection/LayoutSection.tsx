import { Layout } from "lucide-react";

import { SectionCard, Switch } from "@/components";
import type { UiPreferences } from "@/stores";
import { useSetUiPreference, useUiPreferences } from "@/stores";

interface ToggleRowProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function ToggleRow({ label, description, checked, onChange }: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-surface-200">{label}</span>
        <span className="text-xs text-surface-400">{description}</span>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} size="sm" />
    </div>
  );
}

const TITLE_BAR_ITEMS: { key: keyof UiPreferences; label: string; description: string }[] = [
  { key: "showDiscordButton", label: "Discord button", description: "Link to the Discord server" },
  {
    key: "showBugReportButton",
    label: "Bug report button",
    description: "Link to open a GitHub issue",
  },
  {
    key: "showStorageButton",
    label: "Storage button",
    description: "Opens the mod storage directory",
  },
  {
    key: "showNotificationBell",
    label: "Notification bell",
    description: "Shows in-app notification history",
  },
  {
    key: "showDiagnosticsLink",
    label: "Diagnostics link",
    description: "Link to the diagnostics page",
  },
];

const LIBRARY_ITEMS: { key: keyof UiPreferences; label: string; description: string }[] = [
  { key: "showSortDropdown", label: "Sort dropdown", description: "Change mod sort order" },
  { key: "showFilterPopover", label: "Filter button", description: "Filter mods by tags" },
  {
    key: "showViewToggle",
    label: "View toggle",
    description: "Switch between grid and list view",
  },
];

export function LayoutSection() {
  const uiPrefs = useUiPreferences();
  const setUiPreference = useSetUiPreference();

  return (
    <SectionCard title="Layout" icon={<Layout className="h-5 w-5" />}>
      <div className="space-y-6">
        <div className="flex flex-col gap-3">
          <span className="text-sm font-medium text-surface-200">Title Bar</span>
          <div className="flex flex-col gap-4 rounded-lg bg-surface-800 px-4 py-4">
            {TITLE_BAR_ITEMS.map(({ key, label, description }) => (
              <ToggleRow
                key={key}
                label={label}
                description={description}
                checked={uiPrefs[key]}
                onChange={(v) => setUiPreference(key, v)}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <span className="text-sm font-medium text-surface-200">Library</span>
          <div className="flex flex-col gap-4 rounded-lg bg-surface-800 px-4 py-4">
            {LIBRARY_ITEMS.map(({ key, label, description }) => (
              <ToggleRow
                key={key}
                label={label}
                description={description}
                checked={uiPrefs[key]}
                onChange={(v) => setUiPreference(key, v)}
              />
            ))}
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
