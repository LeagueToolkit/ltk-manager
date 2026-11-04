import { ArrowLineUpIcon } from "@phosphor-icons/react";

import { Inline, StepperField, Switch } from "@/components";
import { m } from "@/i18n";
import { usePreviewNavGridCutoff, useSetPreviewDisplay } from "@/stores";

import { PreviewPopover } from "../../shared/preview/PreviewPopover";
import { NAV_CUTOFF_DEFAULT } from "../utils/navGuide";

/** What one press of an arrow moves the cutoff by, in world units. */
const CUTOFF_STEP = 25;

/**
 * The navgrid guide's height cutoff, off a button in the viewport's controls: a switch, and the
 * height while the switch is on. Per "The shell" in docs/plans/navgrid-guides.md.
 */
export function NavCutoffControl() {
  const cutoff = usePreviewNavGridCutoff();
  const setDisplay = useSetPreviewDisplay();
  const label = m.workshop_bin_map_navgrid_cutoff_label();
  const heightLabel = m.workshop_bin_map_navgrid_cutoff_height_label();

  return (
    <PreviewPopover
      label={label}
      description={m.workshop_bin_map_navgrid_cutoff_description()}
      icon={<ArrowLineUpIcon />}
      customized={cutoff !== null}
      onReset={() => setDisplay({ previewNavGridCutoff: null })}
      resetLabel={m.workshop_bin_map_navgrid_cutoff_reset_action()}
      data-ui="NavCutoffControl"
    >
      <Inline gap={2} justify="between">
        <span className="text-xs text-surface-300">{label}</span>
        <Switch
          aria-label={label}
          checked={cutoff !== null}
          onCheckedChange={(on) =>
            setDisplay({ previewNavGridCutoff: on ? NAV_CUTOFF_DEFAULT : null })
          }
        />
      </Inline>
      {cutoff !== null && (
        <Inline gap={2} justify="between">
          <span className="text-xs text-surface-300">{heightLabel}</span>
          <StepperField
            value={cutoff}
            min={0}
            step={CUTOFF_STEP}
            onValueChange={(next) => setDisplay({ previewNavGridCutoff: next })}
            aria-label={heightLabel}
            className="w-24"
          />
        </Inline>
      )}
    </PreviewPopover>
  );
}
