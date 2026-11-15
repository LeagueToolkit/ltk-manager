import { FileTextIcon, InfoIcon, LifebuoyIcon, ScrollIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { Button, ExternalLink, SectionCard } from "@/components";
import { m, Marked } from "@/i18n";
import { type AppInfo, revealPath } from "@/lib/tauri";
import { UpdateCheckRow } from "@/modules/updater";
import { openGetHelp } from "@/stores";

import { LicensesDialog } from "./LicensesDialog";

interface AboutSectionProps {
  appInfo: AppInfo | undefined;
}

export function AboutSection({ appInfo }: AboutSectionProps) {
  const [licensesOpen, setLicensesOpen] = useState(false);

  return (
    <SectionCard title={m.settings_about_title()} icon={<InfoIcon className="size-5" />}>
      <div>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h4 className="font-medium text-surface-100">{m.settings_about_app_name()}</h4>
            {appInfo && (
              <p className="text-sm text-surface-400 select-text">
                {m.settings_about_version_label({ version: appInfo.version })}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <UpdateCheckRow />
            <Button variant="outline" onClick={() => openGetHelp()}>
              <LifebuoyIcon className="size-4" weight="bold" />
              {m.common_get_help_action()}
            </Button>
            {appInfo?.logFilePath && (
              <Button variant="outline" onClick={() => revealPath(appInfo.logFilePath!)}>
                <FileTextIcon className="size-4" weight="bold" />
                {m.settings_about_open_log_action()}
              </Button>
            )}
          </div>
        </div>
        <p className="mt-4 text-sm text-surface-400">{m.settings_about_description()}</p>
        <p className="mt-2 text-sm text-surface-400">
          <Marked text={m.settings_about_meta_wiki_description()}>
            {(clause) => (
              <ExternalLink href="https://meta-wiki.leaguetoolkit.dev/">{clause}</ExternalLink>
            )}
          </Marked>
        </p>
        <div className="mt-4 flex items-center gap-4 border-t border-surface-700/40 pt-4">
          <ExternalLink href="https://github.com/LeagueToolkit/ltk-manager" className="text-sm">
            {m.settings_about_github_action()}
          </ExternalLink>
          <ExternalLink
            href="https://github.com/LeagueToolkit/ltk-manager/wiki"
            className="text-sm"
          >
            {m.settings_about_documentation_action()}
          </ExternalLink>
          <Button variant="ghost" className="ml-auto" onClick={() => setLicensesOpen(true)}>
            <ScrollIcon className="size-4" weight="bold" />
            {m.settings_about_licenses_action()}
          </Button>
        </div>
      </div>
      <LicensesDialog open={licensesOpen} onOpenChange={setLicensesOpen} />
    </SectionCard>
  );
}
