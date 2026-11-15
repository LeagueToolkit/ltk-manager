import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useState } from "react";

import { useToast } from "@/components";
import { m } from "@/i18n";
import { api, type BinDocumentId, type UiFontChoice } from "@/lib/tauri";

import { faceFileEdits, fontFaceEdit } from "../engine/edit/fontEdits";
import { useAtlasEdit } from "../state/atlasEdit";
import { useModFolder } from "./useModFolder";

export interface FontFaceImport {
  readonly busy: boolean;
  /** Pick a font file and make the font `font` draw with it, modelled on the face `from`. */
  readonly run: (font: UiFontChoice, from: UiFontChoice) => Promise<void>;
}

/**
 * A face made from a font file the author picks, per "Fonts" in docs/plans/atlas-ui-editor.md:
 * the file copied into the layer `document` writes to, a copy of the face `from` declared with
 * every locale drawing that file, and the font switched to the copy.
 */
export function useFontFaceImport(document: BinDocumentId | null): FontFaceImport {
  const edit = useAtlasEdit();
  const folder = useModFolder();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (font: UiFontChoice, from: UiFontChoice) => {
      if (edit === null || document === null) return;

      const picked = await open({
        multiple: false,
        filters: [{ name: m.workshop_bin_atlas_font_file_filter(), extensions: ["ttf", "otf"] }],
      });
      if (typeof picked !== "string") return;

      setBusy(true);
      try {
        const file = await api.bin.atlasImportFontFile(document, picked);
        if (!file.ok) {
          toast.failure(m.workshop_bin_atlas_font_import_failed(), file.error);
          return;
        }

        const stem = file.value.slice(file.value.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
        const face = await edit.create(
          `${folder}Fonts/Faces/${stem}`,
          from.project
            ? { type: "clone", source: from.entry }
            : { type: "copy", source: from.entry },
        );
        if (face === null) return;

        await edit.apply([
          ...faceFileEdits(face, from.locales, file.value),
          fontFaceEdit(font.entry, face),
        ]);
      } finally {
        setBusy(false);
      }
    },
    [edit, document, folder, toast],
  );

  return { busy, run };
}
