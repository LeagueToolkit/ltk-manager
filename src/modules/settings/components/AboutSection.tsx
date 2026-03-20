import { FileText } from "lucide-react";

import { Button, SectionCard } from "@/components";
import { api, type AppInfo } from "@/lib/tauri";

interface AboutSectionProps {
  appInfo: AppInfo | undefined;
}

export function AboutSection({ appInfo }: AboutSectionProps) {
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
        <div className="mt-4 flex gap-4 border-t border-surface-600 pt-4">
          <a
            href="https://github.com/LeagueToolkit/ltk-manager"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-accent-400 transition-colors hover:text-accent-300"
          >
            View on GitHub →
          </a>
          <a
            href="https://github.com/LeagueToolkit/ltk-manager/wiki"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-accent-400 transition-colors hover:text-accent-300"
          >
            Documentation →
          </a>
        </div>
      </div>
    </SectionCard>
  );
}
