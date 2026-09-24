import { useCallback } from "react";

import { useToast } from "@/components";
import { m } from "@/i18n";
import {
  api,
  type DeclaredEntry,
  type DeclaredKey,
  type DeclaredModule,
  type DeclaredObjects,
  type ObjectDeclaration,
} from "@/lib/tauri";

import { rowKey } from "../../bin/tree/utils/binRows";
import { objectDocument } from "../../documents/utils/contentDocument";
import type { OpenIntent } from "../../palette/utils/types";
import { useOpenDocumentAs, useRevealRow } from "../../state";

/** What a key or an entry of the outline goes to. */
export interface DeclaredRowTarget {
  module: DeclaredModule;
  entry: DeclaredEntry;
  /** The key whose row is revealed, or null for the object itself. */
  key: DeclaredKey | null;
}

/**
 * The declaration a go-to opens: the chunk a `target` module names where the game declares
 * the object there, else the first chunk in the index's order.
 */
export function declaringChunk(
  declared: DeclaredObjects,
  target: DeclaredRowTarget,
): { path: string; declaration: ObjectDeclaration } | null {
  const object = declared.objects[target.entry.hash];
  if (!object) return null;

  const chunks = object.declarations.filter(
    (declaration) => declaration.asset.kind === "gameChunk",
  );
  const named = chunks.find(
    (declaration) =>
      declaration.asset.kind === "gameChunk" &&
      declaration.asset.pathHash === target.module.targetHash,
  );
  const declaration = named ?? chunks[0];
  if (!declaration) return null;

  return { path: object.path, declaration };
}

/**
 * Open the game bin that declares an outline entry, on the row its key reaches.
 *
 * The object index answers which chunk declares the entry, and a cold index is warmed
 * first. The bin opens declared, because the object tab adds the open project to a game
 * chunk. A key whose path runs through a map key reveals the map's own row.
 */
export function useGoToDeclaredRow(): (target: DeclaredRowTarget, intent: OpenIntent) => void {
  const open = useOpenDocumentAs();
  const revealRow = useRevealRow();
  const toast = useToast();

  return useCallback(
    (target, intent) => {
      void (async () => {
        let result = await api.objects.declared([target.entry.hash]);
        if (result.ok && result.value.index.status === "absent") {
          await api.objects.warm();
          result = await api.objects.declared([target.entry.hash]);
        }

        const found = result.ok ? declaringChunk(result.value, target) : null;
        if (!found) {
          toast.error(
            m.workshop_declarations_go_to_missing_title(),
            m.workshop_declarations_go_to_missing_description({ entry: target.entry.name }),
          );
          return;
        }

        const { path, declaration } = found;
        const document = objectDocument(
          declaration.asset,
          target.entry.hash,
          path,
          declaration.file,
          declaration.class,
        );
        open(document, intent);
        if (target.key !== null && target.key.row.length > 0) {
          revealRow(document.id, rowKey({ entry: target.entry.hash, path: target.key.row }));
        }
      })();
    },
    [open, revealRow, toast],
  );
}
