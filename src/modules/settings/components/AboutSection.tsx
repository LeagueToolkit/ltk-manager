import { FileTextIcon, ScrollIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { Button, ExternalLink, SectionCard } from "@/components";
import { m, Marked } from "@/i18n";
import { type AppInfo, revealPath } from "@/lib/tauri";
import { UpdateCheckRow } from "@/modules/updater";

import { LicensesDialog } from "./LicensesDialog";

interface AboutSectionProps {
  appInfo: AppInfo | undefined;
}

export function AboutSection({ appInfo }: AboutSectionProps) {
  const [licensesOpen, setLicensesOpen] = useState(false);

  return (
    <SectionCard title={m.settings_about_title()}>
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-medium text-surface-100">{m.settings_about_app_name()}</h4>
            {appInfo && (
              <p className="text-sm text-surface-500">
                {m.settings_about_version_label({ version: appInfo.version })}
              </p>
            )}
          </div>
          {appInfo?.logFilePath && (
            <Button variant="outline" size="sm" onClick={() => revealPath(appInfo.logFilePath!)}>
              <FileTextIcon className="h-4 w-4" weight="bold" />
              {m.settings_about_open_log_action()}
            </Button>
          )}
        </div>
        <div className="mt-3">
          <UpdateCheckRow />
        </div>
        <p className="mt-3 text-sm text-surface-400">{m.settings_about_description()}</p>
        <p className="mt-2 text-sm text-surface-400">
          <Marked text={m.settings_about_meta_wiki_description()}>
            {(clause) => (
              <ExternalLink href="https://meta-wiki.leaguetoolkit.dev/">{clause}</ExternalLink>
            )}
          </Marked>
        </p>
        <div className="mt-4 flex items-center gap-4 border-t border-surface-600 pt-4">
          <ExternalLink href="https://github.com/LeagueToolkit/ltk-manager" className="text-sm">
            {m.settings_about_github_action()}
          </ExternalLink>
          <ExternalLink
            href="https://github.com/LeagueToolkit/ltk-manager/wiki"
            className="text-sm"
          >
            {m.settings_about_documentation_action()}
          </ExternalLink>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => setLicensesOpen(true)}
          >
            <ScrollIcon className="h-4 w-4" weight="bold" />
            {m.settings_about_licenses_action()}
          </Button>
        </div>
      </div>
      <LicensesDialog open={licensesOpen} onOpenChange={setLicensesOpen} />
    </SectionCard>
  );
}
