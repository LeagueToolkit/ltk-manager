import { getRouteApi } from "@tanstack/react-router";
import {
  Info,
  Keyboard,
  Layout,
  Loader2,
  Palette,
  Settings as SettingsIcon,
  ShieldAlert,
  Users,
} from "lucide-react";

import { Tabs } from "@/components";
import {
  AboutSection,
  AppearanceSection,
  AuthorProfilesSection,
  GeneralSection,
  HotkeySection,
  LayoutSection,
  PatchingSection,
  useAppInfo,
  useSaveSettings,
  useSettings,
} from "@/modules/settings";

const routeApi = getRouteApi("/settings");

export function Settings() {
  const { firstRun } = routeApi.useSearch();
  const { data: settings, isLoading } = useSettings();
  const { data: appInfo } = useAppInfo();
  const saveSettingsMutation = useSaveSettings();

  if (isLoading || !settings) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent-500" />
      </div>
    );
  }

  function saveSettings(newSettings: typeof settings) {
    saveSettingsMutation.mutate(newSettings!);
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-16 shrink-0 items-center border-b border-surface-600 bg-surface-800/50 px-6">
        <h2 className="text-xl font-semibold text-surface-100">Settings</h2>
      </header>

      <Tabs.Root defaultValue="general" className="flex min-h-0 flex-1 flex-row">
        <Tabs.List
          variant="pills"
          className="w-52 shrink-0 flex-col items-stretch rounded-none border-r border-surface-700/50 bg-surface-950/60 p-3"
        >
          <Tabs.Tab
            variant="pills"
            value="general"
            className="flex items-center gap-2.5 text-left data-active:bg-accent-500/15 data-active:text-accent-300"
          >
            <SettingsIcon className="h-4 w-4 shrink-0" />
            General
          </Tabs.Tab>
          <Tabs.Tab
            variant="pills"
            value="patching"
            className="flex items-center gap-2.5 text-left data-active:bg-accent-500/15 data-active:text-accent-300"
          >
            <ShieldAlert className="h-4 w-4 shrink-0" />
            Patching
          </Tabs.Tab>
          <Tabs.Tab
            variant="pills"
            value="hotkeys"
            className="flex items-center gap-2.5 text-left data-active:bg-accent-500/15 data-active:text-accent-300"
          >
            <Keyboard className="h-4 w-4 shrink-0" />
            Hotkeys
          </Tabs.Tab>
          <Tabs.Tab
            variant="pills"
            value="profiles"
            className="flex items-center gap-2.5 text-left data-active:bg-accent-500/15 data-active:text-accent-300"
          >
            <Users className="h-4 w-4 shrink-0" />
            Author Profiles
          </Tabs.Tab>
          <Tabs.Tab
            variant="pills"
            value="appearance"
            className="flex items-center gap-2.5 text-left data-active:bg-accent-500/15 data-active:text-accent-300"
          >
            <Palette className="h-4 w-4 shrink-0" />
            Appearance
          </Tabs.Tab>
          <Tabs.Tab
            variant="pills"
            value="layout"
            className="flex items-center gap-2.5 text-left data-active:bg-accent-500/15 data-active:text-accent-300"
          >
            <Layout className="h-4 w-4 shrink-0" />
            Layout
          </Tabs.Tab>
          <Tabs.Tab
            variant="pills"
            value="about"
            className="flex items-center gap-2.5 text-left data-active:bg-accent-500/15 data-active:text-accent-300"
          >
            <Info className="h-4 w-4 shrink-0" />
            About
          </Tabs.Tab>
        </Tabs.List>

        <div className="min-h-0 flex-1 overflow-auto">
          <Tabs.Panel value="general" className="mx-auto max-w-2xl space-y-8 p-6">
            {firstRun && !settings.leaguePath && (
              <div className="flex items-start gap-3 rounded-xl border border-accent-500/30 bg-accent-500/10 p-5">
                <Info className="mt-0.5 h-5 w-5 shrink-0 text-accent-400" />
                <div>
                  <h3 className="font-medium text-accent-300">Welcome to LTK Manager!</h3>
                  <p className="mt-1 text-sm text-surface-400">
                    To get started, please configure your League of Legends installation path below.
                    You can use auto-detection or browse to the folder manually.
                  </p>
                </div>
              </div>
            )}
            <GeneralSection settings={settings} onSave={saveSettings} />
          </Tabs.Panel>

          <Tabs.Panel value="patching" className="mx-auto max-w-2xl space-y-8 p-6">
            <PatchingSection settings={settings} onSave={saveSettings} />
          </Tabs.Panel>

          <Tabs.Panel value="hotkeys" className="mx-auto max-w-2xl p-6">
            <HotkeySection settings={settings} onSave={saveSettings} />
          </Tabs.Panel>

          <Tabs.Panel value="profiles" className="mx-auto max-w-2xl p-6">
            <AuthorProfilesSection settings={settings} onSave={saveSettings} />
          </Tabs.Panel>

          <Tabs.Panel value="appearance" className="mx-auto max-w-2xl p-6">
            <AppearanceSection settings={settings} onSave={saveSettings} />
          </Tabs.Panel>

          <Tabs.Panel value="layout" className="mx-auto max-w-2xl p-6">
            <LayoutSection />
          </Tabs.Panel>

          <Tabs.Panel value="about" className="mx-auto max-w-2xl p-6">
            <AboutSection appInfo={appInfo} />
          </Tabs.Panel>
        </div>
      </Tabs.Root>
    </div>
  );
}
