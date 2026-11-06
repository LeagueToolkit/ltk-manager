import { FilmStripIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";

import { Badge, SectionCard, Spinner } from "@/components";
import { m } from "@/i18n";

import { settingsQueries } from "../api";
import { SettingGroup } from "./SettingGroup";

/** A card reporting whether FFmpeg is available to decode video loading screens. */
export function FfmpegCard() {
  const { data: installed = false, isPending } = useQuery(settingsQueries.ffmpeg());

  return (
    <SectionCard
      title={m.settings_integrations_ffmpeg_title()}
      icon={<FilmStripIcon className="size-5" />}
      description={m.settings_integrations_ffmpeg_description()}
    >
      <SettingGroup id="integrations.ffmpeg" title={m.settings_integrations_ffmpeg_status_title()}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-row text-surface-200">
              {installed
                ? m.settings_integrations_ffmpeg_available_title()
                : m.settings_integrations_ffmpeg_missing_title()}
            </span>
            <span className="text-meta text-surface-400">
              {installed
                ? m.settings_integrations_ffmpeg_available_description()
                : m.settings_integrations_ffmpeg_missing_description()}
            </span>
          </div>
          <div>
            {isPending ? (
              <Spinner />
            ) : installed ? (
              <Badge tone="success">{m.settings_integrations_installed_label()}</Badge>
            ) : (
              <Badge tone="neutral">{m.settings_integrations_ffmpeg_missing_label()}</Badge>
            )}
          </div>
        </div>
      </SettingGroup>
    </SectionCard>
  );
}
