import {
  BooksIcon,
  DatabaseIcon,
  GearIcon,
  InfoIcon,
  KeyboardIcon,
  PaletteIcon,
  SpinnerGapIcon,
} from "@phosphor-icons/react";
import { getRouteApi } from "@tanstack/react-router";
import { type ReactNode } from "react";

import { LootIcon, PatcherIcon, Tabs } from "@/components";
import { MigrationPanel } from "@/modules/migration";
import {
  AboutSection,
  AppearanceSection,
  CacheSection,
  DEFAULT_SETTINGS_TAB,
  GeneralSection,
  HotkeySection,
  LibrarySection,
  PatchingSection,
  SettingFocusProvider,
  SETTINGS_TAB_LABELS,
  type SettingsTab,
  useAppInfo,
  useSaveSettings,
  useSettings,
  WorkshopSection,
} from "@/modules/settings";

const routeApi = getRouteApi("/settings");

const tabClass =
  "flex items-center gap-2.5 text-left text-base data-active:bg-accent-500/15 data-active:text-accent-300";

const TABS: { value: SettingsTab; icon: ReactNode }[] = [
  { value: "general", icon: <GearIcon className="h-5 w-5 shrink-0" /> },
  { value: "library", icon: <BooksIcon className="h-5 w-5 shrink-0" /> },
  { value: "workshop", icon: <LootIcon className="h-5 w-5 shrink-0" /> },
  { value: "patching", icon: <PatcherIcon className="h-5 w-5 shrink-0" /> },
  { value: "cache", icon: <DatabaseIcon className="h-5 w-5 shrink-0" /> },
  { value: "hotkeys", icon: <KeyboardIcon className="h-5 w-5 shrink-0" /> },
  { value: "appearance", icon: <PaletteIcon className="h-5 w-5 shrink-0" /> },
  { value: "about", icon: <InfoIcon className="h-5 w-5 shrink-0" /> },
];

export function Settings() {
  const { firstRun, tab } = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const { data: settings, isLoading } = useSettings();
  const { data: appInfo } = useAppInfo();
  const saveSettingsMutation = useSaveSettings();

  if (isLoading || !settings) {
    return (
      <div className="flex h-full items-center justify-center">
        <SpinnerGapIcon className="h-8 w-8 animate-spin text-accent-500" />
      </div>
    );
  }

  function saveSettings(newSettings: typeof settings) {
    saveSettingsMutation.mutate(newSettings!);
  }

  function selectTab(value: unknown) {
    /* Replace, because a tab is not a place a reader wants Back to walk through.
       Back leaves settings. */
    void navigate({ search: (prev) => ({ ...prev, tab: value as SettingsTab }), replace: true });
  }

  return (
    <div className="flex h-full flex-col">
      <Tabs.Root
        value={tab ?? DEFAULT_SETTINGS_TAB}
        onValueChange={selectTab}
        className="flex min-h-0 flex-1 flex-row"
      >
        <Tabs.List
          variant="pills"
          className="w-52 shrink-0 flex-col items-stretch rounded-none border-r border-surface-700/50 bg-surface-800/40 p-3"
        >
          {TABS.map((item) => (
            <Tabs.Tab key={item.value} variant="pills" value={item.value} className={tabClass}>
              {item.icon}
              {SETTINGS_TAB_LABELS[item.value]}
            </Tabs.Tab>
          ))}
        </Tabs.List>

        <div className="min-h-0 flex-1 overflow-auto">
          <SettingFocusProvider>
            <Tabs.Panel value="general" className="mx-auto max-w-5xl space-y-8 px-6 pt-4 pb-6">
              {firstRun && !settings.leaguePath && (
                <div className="flex items-start gap-3 rounded-xl border border-accent-500/30 bg-accent-500/10 p-5">
                  <InfoIcon className="mt-0.5 h-5 w-5 shrink-0 text-accent-400" />
                  <div>
                    <h3 className="font-medium text-accent-300">Welcome to LTK Manager!</h3>
                    <p className="mt-1 text-sm text-surface-400">
                      To get started, please configure your League of Legends installation path
                      below. You can use auto-detection or browse to the folder manually.
                    </p>
                  </div>
                </div>
              )}
              <GeneralSection
                settings={settings}
                onSave={saveSettings}
                migration={<MigrationPanel />}
              />
            </Tabs.Panel>

            <Tabs.Panel value="library" className="mx-auto max-w-5xl px-6 pt-4 pb-6">
              <LibrarySection settings={settings} onSave={saveSettings} />
            </Tabs.Panel>

            <Tabs.Panel value="workshop" className="mx-auto max-w-5xl px-6 pt-4 pb-6">
              <WorkshopSection settings={settings} onSave={saveSettings} />
            </Tabs.Panel>

            <Tabs.Panel value="patching" className="mx-auto max-w-5xl px-6 pt-4 pb-6">
              <PatchingSection settings={settings} onSave={saveSettings} />
            </Tabs.Panel>

            <Tabs.Panel value="cache" className="mx-auto max-w-5xl px-6 pt-4 pb-6">
              <CacheSection />
            </Tabs.Panel>

            <Tabs.Panel value="hotkeys" className="mx-auto max-w-5xl px-6 pt-4 pb-6">
              <HotkeySection settings={settings} onSave={saveSettings} />
            </Tabs.Panel>

            <Tabs.Panel value="appearance" className="mx-auto max-w-5xl px-6 pt-4 pb-6">
              <AppearanceSection settings={settings} onSave={saveSettings} />
            </Tabs.Panel>

            <Tabs.Panel value="about" className="mx-auto max-w-5xl px-6 pt-4 pb-6">
              <AboutSection appInfo={appInfo} />
            </Tabs.Panel>
          </SettingFocusProvider>
        </div>
      </Tabs.Root>
    </div>
  );
}
