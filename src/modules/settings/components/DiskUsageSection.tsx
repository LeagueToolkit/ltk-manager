import { HardDrivesIcon } from "@phosphor-icons/react";

import {
  AlertBox,
  Button,
  Grid,
  SectionCard,
  Spinner,
  Stack,
  useConfirm,
  useToast,
} from "@/components";
import { describeError, errorSummary, m } from "@/i18n";
import type { AreaUsage, DataArea } from "@/lib/tauri";
import { formatBytes } from "@/utils";

import { useClearDataArea, useDataUsage } from "../api";

/** The label, the size and the action of each area. */
const AREA_COLUMNS = "minmax(0, 1fr) max-content max-content";

const AREA_LABELS: Record<DataArea, () => string> = {
  mods: m.settings_disk_mods_label,
  overlayBuilds: m.settings_disk_overlay_builds_label,
  modPreviews: m.settings_disk_mod_previews_label,
  shaders: m.settings_disk_shaders_label,
  leftovers: m.settings_disk_leftovers_label,
  webviewCache: m.settings_disk_webview_cache_label,
};

/**
 * The disk usage of each area of the manager's data, with a clear action on each cache.
 *
 * Overlay builds ask for confirmation, because the next patcher start rebuilds them. The webview
 * cache clears on the next start. See "Disk usage" in docs/ux/SETTINGS.md.
 */
export function DiskUsageSection() {
  const { data: usage, error } = useDataUsage();

  return (
    <SectionCard
      title={m.settings_disk_title()}
      icon={<HardDrivesIcon className="size-5" />}
      description={m.settings_disk_description()}
    >
      {error && (
        <AlertBox tone="danger" title={m.settings_disk_load_failed_title()}>
          {errorSummary(error)}
        </AlertBox>
      )}
      {!usage && !error && <Spinner />}
      {usage && (
        <Stack gap={3}>
          <p className="truncate font-mono text-xs text-surface-400 select-text">
            {usage.location}
          </p>
          <Grid columns={AREA_COLUMNS} gap={3} align="center">
            {usage.areas.map((entry) => (
              <AreaRow
                key={entry.area}
                usage={entry}
                clearPending={entry.area === "webviewCache" && usage.webviewClearPending}
              />
            ))}
          </Grid>
        </Stack>
      )}
    </SectionCard>
  );
}

function AreaRow({ usage, clearPending }: { usage: AreaUsage; clearPending: boolean }) {
  const label = AREA_LABELS[usage.area]();

  return (
    <>
      <span className="text-sm text-surface-200 select-none">{label}</span>
      <span className="text-right text-sm text-surface-400 tabular-nums">
        {formatBytes(usage.bytes)}
      </span>
      <AreaAction area={usage.area} label={label} bytes={usage.bytes} clearPending={clearPending} />
    </>
  );
}

interface AreaActionProps {
  area: DataArea;
  label: string;
  bytes: number;
  clearPending: boolean;
}

function AreaAction({ area, label, bytes, clearPending }: AreaActionProps) {
  const clear = useClearDataArea();
  const confirm = useConfirm();
  const toast = useToast();

  /* The height of the `xs` button in the other rows, so every row keeps one height. */
  if (area === "mods") return <span className="h-6" />;
  if (clearPending) {
    return (
      <span className="text-xs text-surface-400 select-none">
        {m.settings_disk_clear_pending_label()}
      </span>
    );
  }

  async function run() {
    if (area === "overlayBuilds") {
      const accepted = await confirm({
        title: m.settings_disk_overlay_confirm_title(),
        heading: m.settings_disk_overlay_confirm_heading(),
        description: m.settings_disk_overlay_confirm_description(),
        confirmLabel: m.settings_disk_clear_action(),
        tone: "warning",
      });
      if (!accepted) return;
    }

    clear.mutate(area, {
      onSuccess: () => {
        if (area !== "webviewCache") toast.success(m.settings_disk_cleared_title({ area: label }));
      },
      onError: (error) => {
        const { description, detail } = describeError(error);
        toast.failure(m.settings_disk_clear_failed_title({ area: label }), error, {
          description: description ?? detail,
        });
      },
    });
  }

  const action =
    area === "webviewCache"
      ? m.settings_disk_clear_on_restart_action()
      : m.settings_disk_clear_action();

  return (
    <Button
      size="xs"
      variant="outline"
      loading={clear.isPending}
      disabled={bytes === 0}
      onClick={() => void run()}
    >
      {action}
    </Button>
  );
}
