import { DotsThreeVerticalIcon, FolderOpenIcon, WheelchairIcon } from "@phosphor-icons/react";
import { open } from "@tauri-apps/plugin-shell";
import { useState } from "react";

import { Menu, Tooltip, useToast } from "@/components";
import { m } from "@/i18n";
import { api, type AppInfo, unwrap } from "@/lib/tauri";
import { useLatestIncidentToken } from "@/modules/diagnostics";
import { twMerge } from "@/utils";

import { cellActive, cellBase, cellInactive } from "./cells";

function buildBugReportUrl(appInfo: AppInfo | undefined, diagnosticToken: string | null): string {
  const params = new URLSearchParams({ template: "bug_report.yml" });
  if (appInfo) {
    params.set("version", appInfo.version);
    params.set("os", `${appInfo.os} ${appInfo.arch}`);
  }
  if (diagnosticToken) params.set("diagnostic", diagnosticToken);

  return `https://github.com/LeagueToolkit/ltk-manager/issues/new?${params.toString()}`;
}

interface AppMenuProps {
  appInfo?: AppInfo;
}

/** The titlebar actions that report no state of their own, behind one cell. */
export function AppMenu({ appInfo }: AppMenuProps) {
  const diagnosticToken = useLatestIncidentToken();
  const toast = useToast();
  const [isOpen, setIsOpen] = useState(false);

  async function handleOpenStorageDirectory() {
    try {
      const result = await api.getStorageDirectory();
      const path = unwrap(result);
      await api.revealInExplorer(path);
    } catch (error: unknown) {
      toast.error(
        m.shell_menu_storage_error_title(),
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return (
    <Menu.Root open={isOpen} onOpenChange={setIsOpen}>
      <Tooltip content={m.shell_menu_label()}>
        <Menu.Trigger
          aria-label={m.shell_menu_label()}
          data-ui="TitleBar:appMenu"
          className={twMerge(cellBase, isOpen ? cellActive : cellInactive)}
        >
          <DotsThreeVerticalIcon weight="bold" className="h-4 w-4" />
        </Menu.Trigger>
      </Tooltip>

      <Menu.Portal>
        <Menu.Positioner sideOffset={0}>
          <Menu.Popup className="min-w-52">
            <Menu.Item
              icon={<FolderOpenIcon className="h-4 w-4" />}
              onClick={handleOpenStorageDirectory}
            >
              {m.shell_menu_storage_action()}
            </Menu.Item>

            <Menu.Separator />

            <Menu.Item
              icon={<WheelchairIcon weight="bold" className="h-4 w-4" />}
              onClick={() => open(buildBugReportUrl(appInfo, diagnosticToken))}
            >
              {m.shell_menu_bug_report_action()}
            </Menu.Item>
            <Menu.Item
              icon={<DiscordIcon className="h-4 w-4" />}
              onClick={() => open("https://discord.gg/yhzDVRyQex")}
            >
              {m.shell_menu_discord_action()}
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z" />
    </svg>
  );
}
