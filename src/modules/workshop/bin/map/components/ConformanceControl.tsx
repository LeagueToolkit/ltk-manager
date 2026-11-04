import { MountainsIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { Button, Count, Inline, OVERLINE, Spinner, Stack, StepperField } from "@/components";
import { useDebouncedValue } from "@/hooks";
import { errorSummary, m } from "@/i18n";
import type { ConformanceArea, ConformanceKind } from "@/lib/tauri";
import { type BackdropSource, sampledHeightAt } from "@/modules/viewport";
import {
  PREVIEW_DISPLAY_DEFAULTS,
  usePreviewConformanceThreshold,
  useSetPreviewDisplay,
} from "@/stores";

import { PreviewPopover } from "../../shared/preview/PreviewPopover";
import { mapQueries } from "../api/mapQueries";
import type { NavGridView } from "../hooks/useNavGrid";
import { useMapScene } from "../state/mapScene";
import { conformanceRequest } from "../utils/conformance";

/** How long the threshold stays unchanged before the check runs again, in milliseconds. */
const THRESHOLD_SETTLE_MS = 400;

/** What one press of an arrow moves the threshold by, in world units. */
const THRESHOLD_STEP = 5;

const DEFAULT_THRESHOLD = PREVIEW_DISPLAY_DEFAULTS.previewConformanceThreshold;

const KIND_LABEL: Record<ConformanceKind, () => string> = {
  offGround: m.workshop_bin_map_conformance_off_ground_label,
  uncovered: m.workshop_bin_map_conformance_uncovered_label,
};

export interface ConformanceControlProps {
  /** The backdrop that the viewport draws, whose document and map the check reads. */
  readonly source: BackdropSource | null;
  /** The navigation grid of the shown map state, and null until it arrives. */
  readonly navGrid: NavGridView | null;
}

/**
 * The Conformance view mode's threshold and the areas that fail the `map_conformance` check,
 * off a button in the viewport's controls. Per "Problems" in section 6 of
 * docs/plans/navgrid-guides.md.
 *
 * The check runs while the panel is open, once the threshold stays unchanged for
 * `THRESHOLD_SETTLE_MS`. A press on an area frames its center at the navigation grid height.
 */
export function ConformanceControl({ source, navGrid }: ConformanceControlProps) {
  const threshold = usePreviewConformanceThreshold();
  const setDisplay = useSetPreviewDisplay();
  const label = m.workshop_bin_map_conformance_threshold_label();

  return (
    <PreviewPopover
      label={m.workshop_bin_map_conformance_label()}
      description={m.workshop_bin_map_conformance_description()}
      icon={<MountainsIcon />}
      customized={threshold !== DEFAULT_THRESHOLD}
      onReset={() => setDisplay({ previewConformanceThreshold: DEFAULT_THRESHOLD })}
      resetLabel={m.workshop_bin_map_conformance_reset_action()}
      data-ui="ConformanceControl"
    >
      <Inline gap={2} justify="between">
        <span className="text-xs text-surface-300">{label}</span>
        <StepperField
          value={threshold}
          min={0}
          step={THRESHOLD_STEP}
          onValueChange={(next) => setDisplay({ previewConformanceThreshold: next })}
          aria-label={label}
          className="w-24"
        />
      </Inline>
      <ConformanceAreas source={source} navGrid={navGrid} threshold={threshold} />
    </PreviewPopover>
  );
}

interface ConformanceAreasProps extends ConformanceControlProps {
  readonly threshold: number;
}

/** The failing areas of the check, with its loading, failed and empty states. */
function ConformanceAreas({ source, navGrid, threshold }: ConformanceAreasProps) {
  const { backdrop, geometryDocument, focusOn } = useMapScene();
  const settled = useDebouncedValue(threshold, THRESHOLD_SETTLE_MS);
  const request = useMemo(
    () =>
      source === null || navGrid === null
        ? null
        : conformanceRequest({
            document: source.document,
            map: source.map,
            grid: navGrid.source,
            overlays: navGrid.active,
            visibility: backdrop.visibility,
            threshold: settled,
            geometry: geometryDocument,
          }),
    [source, navGrid, backdrop.visibility, settled, geometryDocument],
  );
  const { data: areas, error, isFetching } = useQuery(mapQueries.conformance(request));

  if (error !== null) {
    return <p className="text-meta text-danger-text select-text">{errorSummary(error)}</p>;
  }

  if (areas === undefined) {
    return (
      <Inline gap={1.5}>
        <Spinner size={14} />
        <span className="text-meta text-surface-400">
          {m.workshop_bin_map_conformance_loading_label()}
        </span>
      </Inline>
    );
  }

  if (areas.length === 0) {
    return (
      <p className="text-meta text-surface-400">{m.workshop_bin_map_conformance_areas_empty()}</p>
    );
  }

  const frame = (area: ConformanceArea, index: number) => {
    const [x, z] = area.center;
    if (x === null || z === null) return;

    const y = navGrid === null ? 0 : (sampledHeightAt(navGrid.grid, x, z) ?? 0);
    focusOn({ id: `conformance:${index}`, position: [x, y, z] });
  };

  return (
    <Stack gap={1}>
      <Inline gap={1.5}>
        <span className={OVERLINE}>{m.workshop_bin_map_conformance_areas_label()}</span>
        <Count>{areas.length}</Count>
        {isFetching && <Spinner size={12} />}
      </Inline>
      <div
        data-ui="ConformanceControl:areas"
        className="-mx-1.5 max-h-64 overflow-y-auto scrollbar-md"
      >
        {areas.map((area, index) => (
          <Button
            key={`${area.kind}:${area.center.join(":")}:${area.cells}`}
            variant="ghost"
            size="xs"
            className="w-full justify-between"
            onClick={() => frame(area, index)}
          >
            <span className="truncate">{KIND_LABEL[area.kind]()}</span>
            <AreaDetail area={area} />
          </Button>
        ))}
      </div>
    </Stack>
  );
}

/** The cell count of an area, and its largest height difference where it has one. */
function AreaDetail({ area }: { area: ConformanceArea }) {
  const delta = area.kind === "offGround" ? area.maxDelta : null;
  const rounded = delta === null ? null : Math.round(delta);

  return (
    <Inline gap={2}>
      {rounded !== null && (
        <span className="font-mono text-meta text-surface-300 tabular-nums">
          {m.workshop_bin_map_conformance_area_delta_label({
            value: rounded > 0 ? `+${rounded}` : `${rounded}`,
          })}
        </span>
      )}
      <span className="font-mono text-meta text-surface-400 tabular-nums">
        {m.workshop_bin_map_conformance_area_cells_label({ count: area.cells })}
      </span>
    </Inline>
  );
}
