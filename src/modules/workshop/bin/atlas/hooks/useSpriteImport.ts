import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useState } from "react";

import { useToast } from "@/components";
import { m } from "@/i18n";
import { api, type BinDocumentId, type SheetSpec } from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

import { uiKeys } from "../api/uiQueries";
import { sheetNameOf, sheetSpriteEdits } from "../engine/edit/spriteEdits";
import type { View } from "../engine/model/view";
import { useAtlasEdit } from "../state/atlasEdit";

const SHEET_KEY = "atlas-sheet";

export interface SpriteImport {
  /** Whether an import lands anywhere: the view's scene bin or variant is open and takes edits. */
  readonly available: boolean;
  readonly importing: boolean;
  /** The project's sheet for the view, null where it has none yet. */
  readonly sheet: SheetSpec | null;
  /**
   * Pick a PNG and put it in place of the sprite. On a game `page` an image the sprite's size is
   * pasted over it in a copy of the page the project ships, and the elements keep pointing at it.
   * Any other image goes on the view's sheet, and every element of `elements` points at it.
   * `replace` is the sheet sprite the image stands in for, which keeps its rect where the sizes
   * agree.
   */
  readonly run: (
    elements: readonly string[],
    replace: string | null,
    page: SpritePage | null,
  ) => Promise<void>;
}

/** A sprite of a game texture: the texture's path and the sprite's rect on it. */
export interface SpritePage {
  readonly path: string;
  readonly uv: readonly [number, number, number, number];
}

/** The game page a sprite at `uv` of the texture `path` sits on, none on the project's own sheet. */
export function pageOf(
  path: string,
  uv: readonly [number, number, number, number],
  sheet: SheetSpec | null,
): SpritePage | null {
  if (sheet !== null && path.toLowerCase() === sheet.path.toLowerCase()) return null;
  return { path, uv };
}

/**
 * Importing images onto the sheet the project owns for a view, per section 5 of
 * docs/plans/atlas-ui-editor.md. The page lands through the document edits go to, the variant
 * where one is drawn, and the repoint is one undo step there.
 */
export function useSpriteImport(view: View | null): SpriteImport {
  const edit = useAtlasEdit();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [importing, setImporting] = useState(false);
  const document = edit?.variant ?? edit?.scene ?? null;
  const name = view === null ? null : sheetNameOf(view);
  const available = document !== null && name !== null && edit?.editable === true;

  const sheet = useQuery(sheetQuery(document, name));

  const run = useCallback(
    async (elements: readonly string[], replace: string | null, page: SpritePage | null) => {
      if (!available || edit === null || document === null || name === null) return;

      const file = await open({
        multiple: false,
        filters: [{ name: m.workshop_bin_atlas_sprites_png_filter(), extensions: ["png"] }],
      });
      if (typeof file !== "string") return;

      setImporting(true);
      try {
        if (page !== null) {
          const patched = await api.bin.atlasPatchSprite(document, page.path, page.uv, file);
          if (!patched.ok) {
            toast.failure(m.workshop_bin_atlas_sprites_import_failed(), patched.error);
            return;
          }
          if (patched.value !== null) {
            /* The first patch of a page turns its texture from the game's copy into the layer's. */
            await queryClient.invalidateQueries({ queryKey: uiKeys.views });
            return;
          }
        }

        const result = await api.bin.atlasImportSprite(document, name, file, replace);
        if (!result.ok) {
          toast.failure(m.workshop_bin_atlas_sprites_import_failed(), result.error);
          return;
        }

        queryClient.setQueryData(sheetQuery(document, name).queryKey, result.value.sheet);
        if (elements.length > 0) {
          await edit.apply(sheetSpriteEdits(elements, result.value.sheet, result.value.sprite));
        }
      } finally {
        setImporting(false);
      }
    },
    [available, edit, document, name, toast, queryClient],
  );

  return { available, importing, sheet: sheet.data ?? null, run };
}

/** The project's sheet for the view named `name`, read through `document`'s project. */
export function sheetQuery(document: BinDocumentId | null, name: string | null) {
  return queryOptions({
    queryKey: [SHEET_KEY, document, name] as const,
    queryFn: async () =>
      unwrapForQuery(await api.bin.atlasSheet(document as BinDocumentId, name ?? "")),
    enabled: document !== null && name !== null,
  });
}
