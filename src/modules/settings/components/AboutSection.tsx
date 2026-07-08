import { FileText, ScrollText } from "lucide-react";
import { useState } from "react";

import { Button, ExternalLink, SectionCard } from "@/components";
import { api, type AppInfo } from "@/lib/tauri";

import { LicensesDialog } from "./LicensesDialog";

interface AboutSectionProps {
  appInfo: AppInfo | undefined;
}

export function AboutSection({ appInfo }: AboutSectionProps) {
  const [licensesOpen, setLicensesOpen] = useState(false);

  return (
    <SectionCard title="About">
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-medium text-surface-100">LTK Manager</h4>
            {appInfo && <p className="text-sm text-surface-500">Version {appInfo.version}</p>}
          </div>
          {appInfo?.logFilePath && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => api.revealInExplorer(appInfo.logFilePath!)}
            >
              <FileText className="h-4 w-4" />
              Open Log File
            </Button>
          )}
        </div>
        <p className="mt-3 text-sm text-surface-400">
          LTK Manager is part of the LeagueToolkit project. It provides a graphical interface for
          managing League of Legends mods using the modpkg format.
        </p>
        <div className="mt-4 flex items-center gap-4 border-t border-surface-600 pt-4">
          <ExternalLink href="https://github.com/LeagueToolkit/ltk-manager" className="text-sm">
            View on GitHub
          </ExternalLink>
          <ExternalLink
            href="https://github.com/LeagueToolkit/ltk-manager/wiki"
            className="text-sm"
          >
            Documentation
          </ExternalLink>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => setLicensesOpen(true)}
          >
            <ScrollText className="h-4 w-4" />
            Third-Party Licenses
          </Button>
        </div>
      </div>
      <LicensesDialog open={licensesOpen} onOpenChange={setLicensesOpen} />
    </SectionCard>
  );
}
