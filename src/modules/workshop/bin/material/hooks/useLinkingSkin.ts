import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { BinDocumentId } from "@/lib/tauri";

import { nameHash } from "../../shared/utils/binHash";
import { skinQueries } from "../../skin/api/skinQueries";
import { materialReads } from "../../skin/utils/skinScene";
import { materialQueries } from "../api/materialQueries";

/** The classes a skin object is declared as, which the skin layout draws. */
const SKIN_CLASSES: ReadonlySet<string> = new Set([
  nameHash("SkinCharacterDataProperties"),
  nameHash("TftSkinCharacterDataProperties"),
]);

/** Where a material's own file stands on the question of which skin draws it. */
export type LinkingSkin =
  | { readonly status: "reading" }
  /** A skin of the same file draws with the material, by its entry hash. */
  | { readonly status: "skin"; readonly entry: string }
  /** No skin of the file draws with it, which is when the preview takes a shape. */
  | { readonly status: "none" };

/**
 * The skin of `document` that draws with the material `entry`, if one does.
 *
 * The file's objects are read under the `bin-file-roots` root, so a patch reads them again,
 * and each skin is the same read the skin view makes.
 */
export function useLinkingSkin(document: BinDocumentId, entry: string | null): LinkingSkin {
  const objects = useQuery(materialQueries.objects(document));
  const skins = useMemo(
    () =>
      (objects.data ?? []).flatMap((row) =>
        row.value.type === "struct" && SKIN_CLASSES.has(row.value.classHash) ? [row.entry] : [],
      ),
    [objects.data],
  );
  const models = useQueries({
    queries: skins.map((skin) => skinQueries.skin(document, skin)),
  });

  if (entry === null) return NONE;
  if (objects.data === undefined && objects.error === null) return READING;

  let pending = false;
  for (const [at, model] of models.entries()) {
    if (model.data === undefined) {
      pending ||= model.error === null;
      continue;
    }
    const draws = materialReads(model.data).some((read) => read.hashes.includes(entry));
    if (draws) return { status: "skin", entry: skins[at] };
  }
  return pending ? READING : NONE;
}

const READING: LinkingSkin = { status: "reading" };
const NONE: LinkingSkin = { status: "none" };
