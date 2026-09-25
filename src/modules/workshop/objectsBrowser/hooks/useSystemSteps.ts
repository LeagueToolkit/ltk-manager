import { useQueryClient } from "@tanstack/react-query";
import { type KeyboardEvent, type RefObject, useCallback, useEffect, useRef } from "react";

import { objectTreeQueries } from "../api/queries";
import { type FocusMark, focusMark, restoreFocus } from "../utils/focusHandoff";
import { objectPreviewKind } from "../utils/objectPreview";
import {
  ancestorPrefixes,
  objectListingNodes,
  type ObjectRowNode,
  type ObjectTreeNode,
} from "../utils/objectTree";
import { useLayerDeclarations } from "./useLayerDeclarations";
import { objectNodeDocument, useOpenObjectNode } from "./useOpenObjectNode";

/** How long a step's focus handoff waits for the tab it opens, in milliseconds. */
const HANDOFF_MS = 10_000;

/** The focus a step passes to the tab it opens. */
interface FocusHandoff {
  readonly documentId: string;
  readonly mark: FocusMark | null;
  readonly at: number;
}

/* One step is in flight at a time, since a step moves focus into the tab it opens. */
const pending: { handoff: FocusHandoff | null } = { handoff: null };

/** Take the handoff a step left for `documentId`, and null when it left none or it expired. */
function takeHandoff(documentId: string): FocusHandoff | null {
  const handoff = pending.handoff;
  if (handoff === null || handoff.documentId !== documentId) return null;

  pending.handoff = null;
  return Date.now() - handoff.at > HANDOFF_MS ? null : handoff;
}

/**
 * The particle system `direction` steps to from `objectHash` among a folder's `nodes`.
 *
 * Null at either end of the folder, and when `objectHash` is not in it.
 */
export function siblingSystem(
  nodes: readonly ObjectTreeNode[],
  objectHash: string,
  direction: -1 | 1,
): ObjectRowNode | null {
  const hash = objectHash.toLowerCase();
  const at = nodes.findIndex(
    (node) => node.type === "object" && node.objectHash.toLowerCase() === hash,
  );
  if (at < 0) return null;

  for (let index = at + direction; index >= 0 && index < nodes.length; index += direction) {
    const node = nodes[index]!;
    if (node.type === "object" && objectPreviewKind(node) === "vfx") return node;
  }

  return null;
}

/** Whether `target` takes typed text, where Alt and an arrow belong to the field. */
function isTextEntry(target: EventTarget): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest("input, textarea, select") !== null;
}

interface SystemStepsOptions {
  /** Whether the tab is a particle system's. Every other tab steps nowhere. */
  readonly enabled: boolean;
  readonly documentId: string;
  readonly objectHash: string;
  readonly objectPath: string;
  /** Whether the tab is the one its group shows. */
  readonly active: boolean;
}

interface SystemSteps {
  /** The tab's root, which the keys are read on and which a step's focus returns to. */
  readonly root: RefObject<HTMLDivElement | null>;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

/**
 * `Alt+Up` and `Alt+Down` in a particle system's tab: the previous or next particle system
 * of its folder, in the Objects browser's order.
 *
 * A step opens the sibling the way a click on its tile does, and does nothing at either end
 * of the folder or while the object index has no listing for it. Focus moves into the tab
 * it opens, onto the element that matches the one it left, so the run's keys keep working.
 * A step from focus on the tab itself leaves focus to the tab it opens. A key another
 * handler took, or one typed into a text field, is left alone.
 */
export function useSystemSteps({
  enabled,
  documentId,
  objectHash,
  objectPath,
  active,
}: SystemStepsOptions): SystemSteps {
  const root = useRef<HTMLDivElement>(null);
  const client = useQueryClient();
  const layers = useLayerDeclarations();
  const open = useOpenObjectNode();

  useEffect(() => {
    const element = root.current;
    if (!enabled || !active || element === null) return;

    const handoff = takeHandoff(documentId);
    if (handoff === null) return;

    return restoreFocus(element, handoff.mark);
  }, [enabled, active, documentId]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (!enabled || event.defaultPrevented) return;
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      if (isTextEntry(event.target)) return;

      event.preventDefault();
      const direction = event.key === "ArrowUp" ? -1 : 1;
      const mark = root.current === null ? null : focusMark(root.current, document.activeElement);
      const folder = ancestorPrefixes(objectPath).at(-1) ?? "";

      void client.fetchQuery(objectTreeQueries.dir(folder)).then(
        (listing) => {
          if (listing.status !== "ready") return;

          const next = siblingSystem(objectListingNodes(listing, layers), objectHash, direction);
          const opened = next === null ? null : objectNodeDocument(next);
          if (next === null || opened === null) return;

          pending.handoff = { documentId: opened.id, mark, at: Date.now() };
          open(next, "default");
        },
        () => {},
      );
    },
    [enabled, client, layers, objectHash, objectPath, open],
  );

  return { root, onKeyDown };
}
