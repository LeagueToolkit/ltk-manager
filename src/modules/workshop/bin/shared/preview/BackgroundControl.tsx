import { PaintBucketIcon } from "@phosphor-icons/react";

import { ColorPicker } from "@/components";
import { m } from "@/i18n";
import { useSceneColors } from "@/modules/viewport";
import { usePreviewBackground, useSetPreviewDisplay } from "@/stores";
import { colorHex, parseColorHex, type RgbColor } from "@/utils";

import { PreviewPopover } from "./PreviewPopover";

const BLACK: RgbColor = [0, 0, 0];

/** The color the viewport clears to, which starts from the theme's own. */
export function BackgroundControl() {
  const background = usePreviewBackground();
  const setDisplay = useSetPreviewDisplay();
  const { backdrop } = useSceneColors();
  const label = m.workshop_bin_preview_background_label();

  return (
    <PreviewPopover
      data-ui="BackgroundControl"
      label={label}
      description={m.workshop_bin_preview_background_description()}
      icon={<PaintBucketIcon />}
      customized={background !== null}
      onReset={() => setDisplay({ previewBackground: null })}
      resetLabel={m.workshop_bin_preview_background_reset_action()}
    >
      <ColorPicker
        label={label}
        value={parseColorHex(background ?? backdrop.getHexString()) ?? BLACK}
        onValueChange={(color) => setDisplay({ previewBackground: colorHex(color) })}
      />
    </PreviewPopover>
  );
}
