import { CameraIcon } from "@phosphor-icons/react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { format } from "date-fns/format";
import { type RefObject, useState } from "react";

import { IconButton, reportUnhandledFailure, useToast } from "@/components";
import { m } from "@/i18n";
import { revealPath } from "@/lib/tauri";
import type { CaptureFrame } from "@/modules/viewport";

/**
 * The button that saves the viewport's current frame as a PNG.
 *
 * The frame is read before the save dialog opens, so that the image shows the frame of the click.
 */
export function CaptureButton({ capture }: { capture: RefObject<CaptureFrame | null> }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  async function saveFrame(): Promise<void> {
    const image = await capture.current?.();
    if (!image) throw new Error(m.workshop_bin_preview_capture_empty_error());

    const path = await save({
      defaultPath: `viewport-${format(new Date(), "yyyyMMdd-HHmmss")}.png`,
      filters: [{ name: m.workshop_bin_preview_capture_filter_label(), extensions: ["png"] }],
    });
    if (path === null) return;

    await writeFile(path, new Uint8Array(await image.arrayBuffer()));
    toast.toast({
      type: "success",
      title: m.workshop_bin_preview_capture_saved_title(),
      description: path,
      action: {
        label: m.workshop_bin_preview_capture_reveal_action(),
        onClick: () => revealPath(path),
      },
    });
  }

  return (
    <IconButton
      icon={<CameraIcon />}
      disabled={saving}
      label={m.workshop_bin_preview_capture_label()}
      onClick={() => {
        setSaving(true);
        saveFrame()
          .catch((error: unknown) =>
            reportUnhandledFailure(error, m.workshop_bin_preview_capture_failed_title()),
          )
          .finally(() => setSaving(false));
      }}
    />
  );
}
