import {
  ArrowsClockwiseIcon,
  CaretDownIcon,
  CheckIcon,
  CubeIcon,
  CylinderIcon,
  FrameCornersIcon,
  GridFourIcon,
  type Icon,
  SphereIcon,
  SquareIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { NoColorSpace } from "three";

import { Button, IconButton, Menu, Tooltip } from "@/components";
import { m } from "@/i18n";
import type { BinDocumentId, MaterialProgram } from "@/lib/tauri";
import {
  FitCamera,
  MaterialSubject,
  PREVIEW_BOUNDS,
  PREVIEW_SHAPES,
  type PreviewShape,
  programTextureAssets,
  programWith,
  useAssetTextures,
  Viewport,
} from "@/modules/viewport";
import {
  usePreviewAntiAliasing,
  usePreviewCamera,
  usePreviewGround,
  usePreviewMaterialShape,
  usePreviewTurntable,
  useSetPreviewDisplay,
} from "@/stores";

import { CameraMenu } from "../../vfx/preview/components/CameraMenu";
import { Notice } from "../../vfx/preview/components/Notice";
import { ViewToggle } from "../../vfx/preview/components/ViewToggle";
import { Passes } from "../../vfx/rendering/components/Passes";
import { materialQueries } from "../api/materialQueries";
import { useHeldValue } from "../state/heldValue";

/** The shaders decode their own texels, so a program's textures upload as stored. */
const RAW_TEXTURES = { colorSpace: NoColorSpace } as const;

const ORIGIN: [number, number, number] = [0, 0, 0];

const NO_PROGRAMS: readonly MaterialProgram[] = [];

const SHAPE_LABEL: Record<PreviewShape, () => string> = {
  sphere: m.workshop_bin_material_shape_sphere_label,
  cube: m.workshop_bin_material_shape_cube_label,
  plane: m.workshop_bin_material_shape_plane_label,
  cylinder: m.workshop_bin_material_shape_cylinder_label,
};

const SHAPE_ICON: Record<PreviewShape, Icon> = {
  sphere: SphereIcon,
  cube: CubeIcon,
  plane: SquareIcon,
  cylinder: CylinderIcon,
};

export interface MaterialViewportProps {
  document: BinDocumentId;
  entry: string | null;
}

/**
 * The material's first translated pass on a preview shape, under the stage and camera a
 * character stands in. "The material shell" in docs/ux/BIN_EDITOR.md.
 *
 * The read is the open document's, so an edit reaches the preview once it lands.
 */
export default function MaterialViewport({ document, entry }: MaterialViewportProps) {
  const query = useQuery(materialQueries.program(document, entry));
  const program = query.data ?? null;
  const programs = useMemo(() => (program === null ? NO_PROGRAMS : [program]), [program]);
  const assets = useMemo(() => programTextureAssets(programs), [programs]);
  const textures = useAssetTextures(assets, RAW_TEXTURES);
  const drawn = useMemo(() => programWith(program, textures), [program, textures]);

  const shape = usePreviewMaterialShape();
  const turntable = usePreviewTurntable();
  const held = useHeldValue();
  const camera = usePreviewCamera();
  const antiAliasing = usePreviewAntiAliasing();
  const ground = usePreviewGround();
  const setDisplay = useSetPreviewDisplay();
  const [fitToken, setFitToken] = useState(0);

  if (query.error !== null) {
    return <Notice text={m.workshop_bin_material_preview_failed_empty()} />;
  }
  if (query.data === undefined) {
    return <Notice text={m.workshop_bin_material_preview_loading_label()} />;
  }
  if (program === null) {
    return <Notice text={m.workshop_bin_material_preview_failed_empty()} />;
  }

  return (
    <div data-ui="MaterialViewport" className="relative min-h-0 flex-1">
      <Viewport
        antiAliasing={antiAliasing}
        stage={ground}
        textured={false}
        camera={camera}
        onCameraStand={(preset) => setDisplay({ previewCamera: preset })}
      >
        <FitCamera bounds={PREVIEW_BOUNDS} ground={ORIGIN} token={fitToken} />
        <Passes warps={false} softens={false} />
        <MaterialSubject
          program={drawn}
          skinned={program.kind === "skinnedMesh"}
          shape={shape}
          turntable={turntable}
          held={held}
        />
      </Viewport>

      <div
        data-ui="MaterialViewport:controls"
        /* DS-GLASS, DS-RADIUS, DS-VEIL. The descendant selector outranks each button's own size. */
        className="absolute top-2 right-2 flex items-center gap-0.5 rounded-md border border-surface-veil bg-scrim p-1 shadow-md backdrop-blur-sm [&_button]:text-meta"
      >
        <ShapeMenu
          shape={shape}
          onPick={(picked) => setDisplay({ previewMaterialShape: picked })}
        />
        <ViewToggle
          label={m.workshop_bin_material_preview_turntable_label()}
          active={turntable}
          icon={<ArrowsClockwiseIcon weight="bold" className="h-4 w-4" />}
          onClick={() => setDisplay({ previewTurntable: !turntable })}
        />
        <ViewToggle
          label={m.workshop_bin_preview_stage_label()}
          active={ground}
          icon={<GridFourIcon weight="bold" className="h-4 w-4" />}
          onClick={() => setDisplay({ previewGround: !ground })}
        />
        <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-surface-veil" />
        <CameraMenu />
        <Tooltip content={m.workshop_bin_material_fit_action()}>
          <IconButton
            variant="ghost"
            size="xs"
            compact
            aria-label={m.workshop_bin_material_fit_action()}
            icon={<FrameCornersIcon weight="bold" className="h-4 w-4" />}
            onClick={() => setFitToken((token) => token + 1)}
          />
        </Tooltip>
      </div>
    </div>
  );
}

/** Which shape the material draws on, named on a pill over a menu of the four. */
function ShapeMenu({
  shape,
  onPick,
}: {
  shape: PreviewShape;
  onPick: (shape: PreviewShape) => void;
}) {
  const Shown = SHAPE_ICON[shape];

  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button
            variant="ghost"
            size="xs"
            compact
            aria-label={m.workshop_bin_material_shape_label()}
            left={<Shown weight="bold" className="h-4 w-4" />}
            right={<CaretDownIcon weight="bold" className="h-3 w-3" />}
          >
            {SHAPE_LABEL[shape]()}
          </Button>
        }
      />
      <Menu.Portal>
        <Menu.Positioner align="end">
          <Menu.Popup data-ui="MaterialViewport:shapes" className="w-36">
            {PREVIEW_SHAPES.map((each) => (
              <Menu.Item
                key={each}
                icon={each === shape && <CheckIcon weight="bold" className="h-4 w-4" />}
                onClick={() => onPick(each)}
              >
                {SHAPE_LABEL[each]()}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
