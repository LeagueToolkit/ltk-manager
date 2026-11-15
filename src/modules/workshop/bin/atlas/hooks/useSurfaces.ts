import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

import { useToast } from "@/components";
import { m } from "@/i18n";
import { api, type SheetSprite, type SurfaceSource } from "@/lib/tauri";

import { sheetNameOf, surfaceEdits } from "../engine/edit/spriteEdits";
import type { View } from "../engine/model/view";
import { useAtlasEdit } from "../state/atlasEdit";
import { sheetQuery } from "./useSpriteImport";

const NO_SURFACES: readonly SheetSprite[] = [];

export interface Surfaces {
  /** Whether a surface lands anywhere: the view's scene bin or variant is open and takes edits. */
  readonly available: boolean;
  readonly busy: boolean;
  /** The surfaces of the project's sheet for the view, the sprites carrying slice insets. */
  readonly surfaces: readonly SheetSprite[];
  /** Make a surface named `name` from `source`, and dress the elements of `elements` in it. */
  readonly make: (
    name: string,
    source: SurfaceSource,
    elements: readonly string[],
  ) => Promise<void>;
  /** Dress the elements of `elements` in `surface`, one undo step. */
  readonly apply: (elements: readonly string[], surface: SheetSprite) => Promise<void>;
}

/**
 * The surfaces of the sheet the project owns for a view, per section 5 of
 * docs/plans/atlas-ui-editor.md: styles made once from any image, their slice lines found in it,
 * which any element wears at its own size.
 */
export function useSurfaces(view: View | null): Surfaces {
  const edit = useAtlasEdit();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const document = edit?.variant ?? edit?.scene ?? null;
  const name = view === null ? null : sheetNameOf(view);
  const available = document !== null && name !== null && edit?.editable === true;

  const sheet = useQuery(sheetQuery(document, name)).data ?? null;
  const surfaces = useMemo(
    () => sheet?.sprites.filter((sprite) => sprite.slice !== null) ?? NO_SURFACES,
    [sheet],
  );

  const apply = useCallback(
    async (elements: readonly string[], surface: SheetSprite) => {
      if (!available || edit === null || sheet === null || elements.length === 0) return;
      await edit.apply(surfaceEdits(elements, sheet, surface));
    },
    [available, edit, sheet],
  );

  const make = useCallback(
    async (surfaceName: string, source: SurfaceSource, elements: readonly string[]) => {
      if (!available || edit === null || document === null || name === null) return;

      setBusy(true);
      try {
        const result = await api.bin.atlasMakeSurface(document, name, surfaceName, source);
        if (!result.ok) {
          toast.failure(m.workshop_bin_atlas_surface_failed(), result.error);
          return;
        }

        queryClient.setQueryData(sheetQuery(document, name).queryKey, result.value.sheet);
        if (elements.length > 0) {
          await edit.apply(surfaceEdits(elements, result.value.sheet, result.value.sprite));
        }
      } finally {
        setBusy(false);
      }
    },
    [available, edit, document, name, toast, queryClient],
  );

  return { available, busy, surfaces, make, apply };
}
